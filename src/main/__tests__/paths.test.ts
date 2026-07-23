import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertInsideDir } from '../paths'

const ROOT = resolve('C:', 'midir', 'recordings')

describe('assertInsideDir', () => {
  it('resolves a plain file name inside the folder', () => {
    expect(assertInsideDir(ROOT, 'session-1.ndjson')).toBe(join(ROOT, 'session-1.ndjson'))
  })

  it('refuses a name that leaves the folder', () => {
    // A name that crosses a boundary has no correct reading, so it is refused
    // rather than corrected.
    for (const name of [
      '..',
      '../settings.json',
      '..\\settings.json',
      'sub/file.ndjson',
      'sub\\file.ndjson',
      '/etc/passwd',
      'C:\\Windows\\System32\\config',
      '.',
      ''
    ]) {
      expect(() => assertInsideDir(ROOT, name)).toThrow('Invalid file name')
    }
  })

  it('refuses a value that is not a string', () => {
    expect(() => assertInsideDir(ROOT, undefined as unknown as string)).toThrow('Invalid file name')
    expect(() => assertInsideDir(ROOT, 42 as unknown as string)).toThrow('Invalid file name')
  })
})
