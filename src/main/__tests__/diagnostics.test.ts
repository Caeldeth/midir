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
  buildReport,
  copyReport,
  openIssue,
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
    status: () => status,
    liveCharacterEntries: () => [],
    positionFor: () => null,
    dialogFor: () => null,
    noticeFor: () => null,
    answerFor: () => null,
    fieldMapFor: () => null,
    exchangeFor: () => null,
    recordFor: () => null,
    entitiesFor: () => null,
    boardFor: () => null,
    doorsFor: () => null
  }
  return {
    log: fakeLogger(currentLogFile),
    logsPath,
    recordingsPath,
    captureService: service,
    appGetVersion: () => '0.1.0',
    diagnosticsIo: { writeClipboard: () => undefined, openExternal: () => undefined }
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

describe('the report (the house Report Issue module)', () => {
  it('builds the block from the version and the newest warnings and errors, scrubbed', () => {
    const ctx = context()
    ctx.log.info('capture', 'Capture started on adapter 3.')
    ctx.log.warn(
      'settings',
      [
        'Could not read C:',
        'Users',
        'alice',
        'AppData',
        'Local',
        'Erisco',
        'Midir',
        'settings.json'
      ].join(String.fromCharCode(92))
    )
    ctx.log.error('renderer:react', 'boom at one')
    const block = buildReport(ctx)
    expect(block).toContain('App: Midir 0.1.0')
    expect(block).toMatch(/^OS: /m)
    expect(block).toContain('[warn] settings :: Could not read')
    expect(block).toContain('[error] renderer:react :: boom at one')
    // The info line is not an error, and the path lost its account name.
    expect(block).not.toContain('Capture started')
    expect(block).not.toContain('alice')
    expect(block).toContain('settings.json')
  })

  it('says so when the session had no error', () => {
    const ctx = context()
    ctx.log.info('app', 'Midir started.')
    expect(buildReport(ctx)).toContain('No errors captured this session.')
  })

  it('copies the full body before it opens the issue, with the app label', () => {
    const calls: string[] = []
    const ctx = context()
    ctx.diagnosticsIo = {
      writeClipboard: (text) => calls.push(`copy:${text.length}`),
      openExternal: (url) => calls.push(`open:${url}`)
    }
    const body = ['What happened', '', '```', 'App: Midir 0.1.0', '```'].join(
      String.fromCharCode(10)
    )
    const result = openIssue(ctx, 'It broke', body)
    expect(result).toEqual({ ok: true, truncated: false })
    expect(calls[0]).toBe(`copy:${body.length}`)
    expect(calls[1]).toMatch(/^open:https:\/\/github\.com\/hybrasyl\/cernunnos\/issues\/new\?/)
    expect(calls[1]).toContain('labels=app%3Amidir')
  })

  it('refuses an invalid payload before it touches the clipboard', () => {
    const calls: string[] = []
    const ctx = context()
    ctx.diagnosticsIo = {
      writeClipboard: () => calls.push('copy'),
      openExternal: () => calls.push('open')
    }
    expect(() => openIssue(ctx, 42, 'body')).toThrow('Invalid issue payload')
    expect(() => copyReport(ctx, null)).toThrow('Invalid report payload')
    expect(calls).toEqual([])
    expect(copyReport(ctx, 'the report')).toEqual({ ok: true })
    expect(calls).toEqual(['copy'])
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
