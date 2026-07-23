import type { IpcMain, Shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseLogLine, type LogEntry, type LogFileInfo, type RecordingInfo } from '../../shared/log'
import type { CaptureService } from '../captureService'
import { LOG_FILE_PATTERN, messageOf, type Logger } from '../log'
import { assertInsideDir } from '../paths'
import { deleteAllRecordings, deleteRecording, listRecordings } from '../recordings'

/**
 * Everything Midir writes for diagnosis: the log and the session recordings.
 *
 * The renderer supplies a file name and never a path. Each name is checked
 * against the pattern its writer produces, then resolved with
 * `assertInsideDir`. A name is refused twice, because a name that escapes the
 * folder has no correct reading.
 */

export interface DiagnosticsHandlerContext {
  log: Logger
  logsPath: string
  recordingsPath: string
  captureService: CaptureService
}

/** How many entries a read returns. The newest are kept. */
export const MAX_LOG_ENTRIES = 2000

/** The channel main uses to push a new log entry to the renderer. */
export const LOG_APPENDED_CHANNEL = 'logs:appended'

/** Every log file, newest first. */
export async function listLogs(ctx: DiagnosticsHandlerContext): Promise<LogFileInfo[]> {
  let names: string[]
  try {
    names = await fs.readdir(ctx.logsPath)
  } catch {
    return []
  }

  const found: LogFileInfo[] = []
  for (const name of names.filter((candidate) => LOG_FILE_PATTERN.test(candidate))) {
    try {
      const stats = await fs.stat(join(ctx.logsPath, name))
      found.push({
        name,
        sizeBytes: stats.size,
        modifiedMs: stats.mtimeMs,
        current: join(ctx.logsPath, name) === ctx.log.filePath
      })
    } catch {
      /* the file went away between readdir and stat */
    }
  }
  return found.sort((a, b) => b.name.localeCompare(a.name))
}

/**
 * Read one log file.
 *
 * A line this version cannot parse is left out rather than shown raw, and a
 * file cut short by a crash still returns every line before the damage.
 */
export async function readLog(ctx: DiagnosticsHandlerContext, name: unknown): Promise<LogEntry[]> {
  if (typeof name !== 'string' || !LOG_FILE_PATTERN.test(name)) throw new Error('Invalid log name')
  const full = assertInsideDir(ctx.logsPath, name)

  let text: string
  try {
    text = await fs.readFile(full, 'utf-8')
  } catch {
    return []
  }

  const entries: LogEntry[] = []
  for (const line of text.split('\n')) {
    const entry = parseLogLine(line)
    if (entry !== null) entries.push(entry)
  }
  return entries.slice(-MAX_LOG_ENTRIES)
}

/**
 * Put a renderer error in the same file the main process writes.
 *
 * One file has to answer "why did it fail", whichever process broke. The
 * lengths only stop an absurd payload; a real one is far smaller.
 */
export function reportRendererError(ctx: DiagnosticsHandlerContext, payload: unknown): void {
  const error = payload as { source?: unknown; message?: unknown; stack?: unknown }
  const source = typeof error?.source === 'string' ? error.source.slice(0, 40) : 'renderer'
  const message = typeof error?.message === 'string' ? error.message.slice(0, 10_000) : ''
  const stack = typeof error?.stack === 'string' ? error.stack.slice(0, 50_000) : ''
  ctx.log.error(`renderer:${source}`, stack === '' ? message : `${message} ${stack}`)
}

/** Every session recording, newest first. */
export async function listAllRecordings(ctx: DiagnosticsHandlerContext): Promise<RecordingInfo[]> {
  return listRecordings(ctx.recordingsPath, ctx.captureService.status().recordingPath)
}

/** Delete one recording. The one capture is writing is refused. */
export async function removeRecording(
  ctx: DiagnosticsHandlerContext,
  name: unknown
): Promise<void> {
  if (typeof name !== 'string') throw new Error('Invalid recording name')
  await deleteRecording(ctx.recordingsPath, name, ctx.captureService.status().recordingPath)
  ctx.log.info('recordings', `Deleted ${name} at the user's request.`)
}

/** Delete every recording except the one being written. */
export async function removeAllRecordings(ctx: DiagnosticsHandlerContext): Promise<number> {
  const removed = await deleteAllRecordings(
    ctx.recordingsPath,
    ctx.captureService.status().recordingPath
  )
  ctx.log.info('recordings', `Deleted ${removed} recordings at the user's request.`)
  return removed
}

/** Open a folder Midir owns. The path is Midir's own and never the renderer's. */
async function openFolder(shell: Shell, log: Logger, path: string): Promise<void> {
  try {
    await fs.mkdir(path, { recursive: true })
  } catch {
    /* the open below reports the real problem */
  }
  const failure = await shell.openPath(path)
  if (failure !== '') log.warn('diagnostics', `Could not open ${path}: ${failure}`)
}

export function registerDiagnosticsHandlers(
  ipcMain: IpcMain,
  shell: Shell,
  ctx: DiagnosticsHandlerContext
): void {
  ipcMain.handle('logs:list', () => listLogs(ctx))
  ipcMain.handle('logs:read', (_, name) => readLog(ctx, name))
  ipcMain.handle('logs:report', (_, payload) => {
    try {
      reportRendererError(ctx, payload)
    } catch (error) {
      // Reporting a failure must never become a second failure.
      ctx.log.warn('diagnostics', `Could not record a renderer error: ${messageOf(error)}`)
    }
  })
  ipcMain.handle('logs:openFolder', () => openFolder(shell, ctx.log, ctx.logsPath))

  ipcMain.handle('recordings:list', () => listAllRecordings(ctx))
  ipcMain.handle('recordings:delete', (_, name) => removeRecording(ctx, name))
  ipcMain.handle('recordings:deleteAll', () => removeAllRecordings(ctx))
  ipcMain.handle('recordings:openFolder', () => openFolder(shell, ctx.log, ctx.recordingsPath))
}
