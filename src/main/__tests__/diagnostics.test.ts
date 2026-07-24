import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { formatLogLine } from '../../shared/log'
import type { CaptureStatus } from '../../shared/types'
import type { CaptureService } from '../captureService'
import {
  listAllRecordings,
  listLogs,
  MAX_LOG_ENTRIES,
  readLog,
  removeRecording,
  reportRendererError,
  type DiagnosticsHandlerContext
} from '../handlers/diagnostics'
import { logFileName } from '../log'
import { fakeLogger } from './handlers.test'

let root = ''
let logsPath = ''
let recordingsPath = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'midir-diag-'))
  logsPath = join(root, 'logs')
  recordingsPath = join(root, 'recordings')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const STOPPED: CaptureStatus = {
  running: false,
  state: 'stopped',
  characters: [],
  connections: 0,
  decodedCount: 0,
  unreadableCount: 0,
  missedHandshake: false
}

function context(
  status: CaptureStatus = STOPPED,
  currentLogFile = ''
): DiagnosticsHandlerContext & { log: ReturnType<typeof fakeLogger> } {
  const service: CaptureService = {
    start: async () => undefined,
    stop: async () => undefined,
    flush: async () => undefined,
    status: () => status
  }
  return {
    log: fakeLogger(currentLogFile),
    logsPath,
    recordingsPath,
    captureService: service
  }
}

/** Write a log file with the given lines. */
function writeLog(timeMs: number, lines: string[] = []): string {
  const name = logFileName(timeMs)
  writeFileSync(join(logsPath, name), lines.join('\n'))
  return name
}

/** Both folders, so a test can write into either. */
function mkdirs(): void {
  mkdirSync(logsPath, { recursive: true })
  mkdirSync(recordingsPath, { recursive: true })
}

describe('listLogs', () => {
  it('is empty when nothing has been written', async () => {
    expect(await listLogs(context())).toEqual([])
  })

  it('lists log files newest first, and marks this launch', async () => {
    mkdirs()
    const older = writeLog(Date.UTC(2026, 0, 1))
    const current = writeLog(Date.UTC(2026, 0, 2))

    const found = await listLogs(context(STOPPED, join(logsPath, current)))
    expect(found.map((file) => file.name)).toEqual([current, older])
    expect(found[0]!.current).toBe(true)
    expect(found[1]!.current).toBe(false)
  })

  it('leaves a file it did not write out of the list', async () => {
    mkdirs()
    writeLog(Date.UTC(2026, 0, 1))
    writeFileSync(join(logsPath, 'notes.txt'), 'keep me')
    expect(await listLogs(context())).toHaveLength(1)
  })
})

describe('readLog', () => {
  it('returns the entries a file holds', async () => {
    mkdirs()
    const name = writeLog(Date.UTC(2026, 0, 1), [
      formatLogLine({ timeMs: 1000, level: 'info', scope: 'app', message: 'Midir started.' }),
      formatLogLine({ timeMs: 2000, level: 'error', scope: 'capture', message: 'It broke.' })
    ])

    const entries = await readLog(context(), name)
    expect(entries).toEqual([
      { timeMs: 1000, level: 'info', scope: 'app', message: 'Midir started.' },
      { timeMs: 2000, level: 'error', scope: 'capture', message: 'It broke.' }
    ])
  })

  it('skips a line it cannot read rather than showing it raw', async () => {
    mkdirs()
    const name = writeLog(Date.UTC(2026, 0, 1), [
      formatLogLine({ timeMs: 1000, level: 'info', scope: 'app', message: 'good' }),
      'half a line written before the cra'
    ])
    expect(await readLog(context(), name)).toHaveLength(1)
  })

  it('returns the newest entries when a file is long', async () => {
    mkdirs()
    const lines = Array.from({ length: MAX_LOG_ENTRIES + 10 }, (_, index) =>
      formatLogLine({ timeMs: index, level: 'info', scope: 'app', message: `line ${index}` })
    )
    const name = writeLog(Date.UTC(2026, 0, 1), lines)

    const entries = await readLog(context(), name)
    expect(entries).toHaveLength(MAX_LOG_ENTRIES)
    expect(entries[entries.length - 1]!.message).toBe(`line ${MAX_LOG_ENTRIES + 9}`)
  })

  it('refuses a name that is not a log file', async () => {
    // The name is checked before anything touches disk.
    for (const name of ['../settings.json', 'settings.json', 'session-nope.log', 42]) {
      await expect(readLog(context(), name)).rejects.toThrow('Invalid log name')
    }
  })

  it('is empty for a file that is not there', async () => {
    mkdirs()
    expect(await readLog(context(), logFileName(Date.UTC(2026, 0, 1)))).toEqual([])
  })
})

describe('reportRendererError', () => {
  it('writes a renderer failure to the same log', () => {
    const ctx = context()
    reportRendererError(ctx, { source: 'react', message: 'boom', stack: 'at one' })

    expect(ctx.log.entries[0]).toMatchObject({
      level: 'error',
      scope: 'renderer:react',
      message: 'boom at one'
    })
  })

  it('records something even when the payload is nonsense', () => {
    const ctx = context()
    reportRendererError(ctx, null)
    expect(ctx.log.entries[0]).toMatchObject({ level: 'error', scope: 'renderer:renderer' })
  })
})

describe('the recording handlers', () => {
  it('refuses to delete the recording capture is writing', async () => {
    mkdirs()
    const name = 'session-2026-01-01T00-00-00-000Z.ndjson'
    writeFileSync(join(recordingsPath, name), 'x')

    const ctx = context({ ...STOPPED, running: true, recordingPath: join(recordingsPath, name) })
    await expect(removeRecording(ctx, name)).rejects.toThrow('being written')

    const found = await listAllRecordings(ctx)
    expect(found[0]!.active).toBe(true)
  })

  it('refuses a name that leaves the folder', async () => {
    mkdirs()
    await expect(removeRecording(context(), '../settings.json')).rejects.toThrow(
      'Invalid recording name'
    )
  })
})
