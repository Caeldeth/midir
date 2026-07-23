import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RecordingInfo } from '../../shared/log'
import {
  BYTES_PER_MB,
  deleteAllRecordings,
  deleteRecording,
  listRecordings,
  pruneRecordings,
  selectForPrune,
  startedAtFromName
} from '../recordings'

let dir = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'midir-rec-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** The name the recorder builds from a start time. */
function nameFor(startedAtMs: number): string {
  return `session-${new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')}.ndjson`
}

/** Write a recording of `sizeBytes` that started at `startedAtMs`. */
function write(startedAtMs: number, sizeBytes: number): string {
  const name = nameFor(startedAtMs)
  writeFileSync(join(dir, name), 'x'.repeat(sizeBytes))
  return name
}

function info(name: string, sizeBytes: number, startedAtMs: number): RecordingInfo {
  return { name, sizeBytes, startedAtMs, active: false }
}

describe('startedAtFromName', () => {
  it('reads back the time the recorder wrote into the name', () => {
    const startedAtMs = Date.UTC(2026, 6, 23, 16, 42, 15, 123)
    expect(startedAtFromName(nameFor(startedAtMs))).toBe(startedAtMs)
  })

  it('is NaN for a name it does not recognise', () => {
    expect(Number.isNaN(startedAtFromName('session-nonsense.ndjson'))).toBe(true)
  })
})

describe('selectForPrune', () => {
  const files = [info('a', 100, 1000), info('b', 100, 2000), info('c', 100, 3000)]

  it('chooses nothing when the folder already fits', () => {
    expect(selectForPrune(files, 300)).toEqual([])
    expect(selectForPrune(files, 1000)).toEqual([])
  })

  it('chooses the oldest, and stops as soon as the rest fit', () => {
    expect(selectForPrune(files, 200)).toEqual(['a'])
    expect(selectForPrune(files, 100)).toEqual(['a', 'b'])
  })

  it('never chooses the file capture is writing', () => {
    // Deleting the file under the recorder would leave the running session
    // with nowhere to go.
    expect(selectForPrune(files, 100, 'a')).toEqual(['b', 'c'])
  })

  it('chooses nothing when there is no limit', () => {
    expect(selectForPrune(files, 0)).toEqual([])
    expect(selectForPrune(files, -1)).toEqual([])
  })

  it('stops rather than delete the only file left', () => {
    expect(selectForPrune([info('a', 500, 1000)], 100, 'a')).toEqual([])
  })
})

describe('listRecordings', () => {
  it('is empty when the folder does not exist', async () => {
    expect(await listRecordings(join(dir, 'nothing-here'))).toEqual([])
  })

  it('lists recordings newest first, with their size and start time', async () => {
    const older = write(Date.UTC(2026, 0, 1), 10)
    const newer = write(Date.UTC(2026, 0, 2), 20)

    const found = await listRecordings(dir)
    expect(found.map((file) => file.name)).toEqual([newer, older])
    expect(found[0]).toMatchObject({ sizeBytes: 20, startedAtMs: Date.UTC(2026, 0, 2) })
  })

  it('leaves a file it did not write out of the list', async () => {
    write(Date.UTC(2026, 0, 1), 10)
    writeFileSync(join(dir, 'settings.json'), '{}')
    writeFileSync(join(dir, 'notes.ndjson'), 'x')

    expect(await listRecordings(dir)).toHaveLength(1)
  })

  it('marks the recording capture is writing', async () => {
    const name = write(Date.UTC(2026, 0, 1), 10)
    const found = await listRecordings(dir, join(dir, name))
    expect(found[0]!.active).toBe(true)
  })
})

describe('deleteRecording', () => {
  it('deletes the file it is given', async () => {
    const name = write(Date.UTC(2026, 0, 1), 10)
    await deleteRecording(dir, name)
    expect(readdirSync(dir)).toEqual([])
  })

  it('refuses the recording capture is writing', async () => {
    const name = write(Date.UTC(2026, 0, 1), 10)
    await expect(deleteRecording(dir, name, join(dir, name))).rejects.toThrow('being written')
    expect(readdirSync(dir)).toEqual([name])
  })

  it('refuses a name that leaves the folder', async () => {
    writeFileSync(join(dir, 'settings.json'), '{}')
    await expect(deleteRecording(dir, '../settings.json')).rejects.toThrow('Invalid recording name')
    await expect(deleteRecording(dir, 'settings.json')).rejects.toThrow('Invalid recording name')
  })
})

describe('deleteAllRecordings', () => {
  it('deletes every recording and says how many went', async () => {
    write(Date.UTC(2026, 0, 1), 10)
    write(Date.UTC(2026, 0, 2), 10)
    expect(await deleteAllRecordings(dir)).toBe(2)
    expect(readdirSync(dir)).toEqual([])
  })

  it('keeps the one capture is writing', async () => {
    const active = write(Date.UTC(2026, 0, 1), 10)
    write(Date.UTC(2026, 0, 2), 10)

    expect(await deleteAllRecordings(dir, join(dir, active))).toBe(1)
    expect(readdirSync(dir)).toEqual([active])
  })
})

describe('pruneRecordings', () => {
  it('deletes the oldest until the folder fits under the cap', async () => {
    const oldest = write(Date.UTC(2026, 0, 1), BYTES_PER_MB)
    write(Date.UTC(2026, 0, 2), BYTES_PER_MB)

    expect(await pruneRecordings(dir, 1)).toEqual([oldest])
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('keeps the recording that is starting, however far over the cap', async () => {
    // The new file is the newest, so a plain oldest-first pass would reach it
    // last. This proves it is skipped rather than merely reached late.
    const first = write(Date.UTC(2026, 0, 1), BYTES_PER_MB * 2)
    const second = write(Date.UTC(2026, 0, 2), BYTES_PER_MB * 2)
    const starting = write(Date.UTC(2026, 0, 3), 0)

    expect((await pruneRecordings(dir, 1, join(dir, starting))).sort()).toEqual(
      [first, second].sort()
    )
    expect(readdirSync(dir)).toEqual([starting])
  })

  it('deletes nothing when there is no limit', async () => {
    write(Date.UTC(2026, 0, 1), BYTES_PER_MB * 5)
    expect(await pruneRecordings(dir, 0)).toEqual([])
    expect(readdirSync(dir)).toHaveLength(1)
  })
})
