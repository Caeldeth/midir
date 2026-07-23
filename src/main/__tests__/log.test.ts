import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { flattenMessage, formatLogLine, parseLogLine } from '../../shared/log'
import { createLogger, logFileName } from '../log'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'midir-log-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** A clock that advances a millisecond at a time, so names never collide. */
function ticker(start = Date.UTC(2026, 6, 23, 16, 42, 15, 123)): () => number {
  let time = start
  return () => time++
}

describe('the log line format', () => {
  it('survives a round trip', () => {
    const entry = {
      timeMs: Date.UTC(2026, 6, 23, 16, 42, 15, 123),
      level: 'warn',
      scope: 'capture',
      message: 'The adapter went away.'
    } as const
    expect(parseLogLine(formatLogLine(entry))).toEqual(entry)
  })

  it('puts a stack on one line, so one entry stays one line', () => {
    const stack = 'Error: boom\n    at one (a.ts:1:1)\n    at two (b.ts:2:2)'
    expect(flattenMessage(stack)).toBe('Error: boom | at one (a.ts:1:1) | at two (b.ts:2:2)')

    const line = formatLogLine({ timeMs: 0, level: 'error', scope: 'window', message: stack })
    expect(line.split('\n')).toHaveLength(1)
    expect(parseLogLine(line)?.message).toBe(flattenMessage(stack))
  })

  it('returns null for a line it cannot read', () => {
    // A file cut short by a crash still shows every line before the damage.
    expect(parseLogLine('')).toBeNull()
    expect(parseLogLine('not a log line at all')).toBeNull()
    expect(parseLogLine('not-a-date [INFO] (app) hello')).toBeNull()
  })

  it('reads a line whose message is empty', () => {
    const line = formatLogLine({ timeMs: 0, level: 'info', scope: 'app', message: '' })
    expect(parseLogLine(line)).toMatchObject({ scope: 'app', message: '' })
  })
})

describe('createLogger', () => {
  it('writes what it is told, in the order it was told', () => {
    const log = createLogger(dir, { now: ticker() })
    log.info('app', 'Midir started.')
    log.warn('capture', 'No adapter was chosen.')
    log.error('settings', 'The save failed.')

    const lines = readFileSync(log.filePath, 'utf-8').trim().split('\n')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('[INFO] (app) Midir started.')
    expect(lines[1]).toContain('[WARN] (capture) No adapter was chosen.')
    expect(lines[2]).toContain('[ERROR] (settings) The save failed.')
  })

  it('creates the file even when the launch writes nothing', () => {
    // A silent launch still counts as a launch, so rotation and the view both
    // see it.
    const log = createLogger(dir, { now: ticker() })
    expect(readdirSync(dir)).toEqual([log.filePath.split(/[\\/]/).pop()])
  })

  it('keeps the newest files and deletes the rest', () => {
    for (let i = 0; i < 6; i++) {
      writeFileSync(join(dir, logFileName(Date.UTC(2026, 0, 1, 0, 0, i, 0))), '')
    }
    expect(readdirSync(dir)).toHaveLength(6)

    // This launch opens a seventh, so three of the seven must go.
    createLogger(dir, { keep: 4, now: ticker() })

    const kept = readdirSync(dir).sort()
    expect(kept).toHaveLength(4)
    // The name sorts chronologically, so the survivors are the last names.
    expect(kept[kept.length - 1]).toBe(logFileName(Date.UTC(2026, 6, 23, 16, 42, 15, 123)))
  })

  it('leaves a file it did not write alone', () => {
    writeFileSync(join(dir, 'notes.txt'), 'keep me')
    createLogger(dir, { keep: 1, now: ticker() })
    expect(readdirSync(dir)).toContain('notes.txt')
  })

  it('holds the most recent entries in memory, and no more', () => {
    const log = createLogger(dir, { ringMax: 3, now: ticker() })
    for (const message of ['one', 'two', 'three', 'four']) log.info('app', message)

    expect(log.recent().map((entry) => entry.message)).toEqual(['two', 'three', 'four'])
  })

  it('reports each entry as it is written', () => {
    const seen: string[] = []
    const log = createLogger(dir, { now: ticker(), onEntry: (entry) => seen.push(entry.message) })
    log.info('app', 'first')
    log.error('app', 'second')
    expect(seen).toEqual(['first', 'second'])
  })

  it('keeps working when no file can be opened', () => {
    // A logging failure must never stop a capture the user asked for. The ring
    // still fills, so the view has something to show.
    const blocked = join(dir, 'a-file-not-a-folder')
    writeFileSync(blocked, 'in the way')

    const log = createLogger(join(blocked, 'logs'), { now: ticker() })
    expect(log.filePath).toBe('')
    expect(() => log.error('capture', 'still fine')).not.toThrow()
    expect(log.recent()).toHaveLength(1)
  })
})
