import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emptyCharacter } from '../../../shared/character'
import type { JsonStoreFailure } from '../../jsonStore'
import {
  CHARACTERS_FILE,
  createCharacterStore,
  emptyCharacterFile,
  withCharacter,
  withoutCharacter
} from '../characterStore'

describe('withCharacter', () => {
  it('adds a character', () => {
    const record = emptyCharacter('Sabrael', 1000)
    expect(withCharacter(emptyCharacterFile(), record).characters['Sabrael']).toEqual(record)
  })

  it('replaces a character of the same name', () => {
    const first = { ...emptyCharacter('Sabrael', 1000), title: 'Novice' }
    const second = { ...emptyCharacter('Sabrael', 5000), title: 'Grand Master' }
    const file = withCharacter(withCharacter(emptyCharacterFile(), first), second)
    expect(file.characters['Sabrael']?.title).toBe('Grand Master')
    expect(Object.keys(file.characters)).toEqual(['Sabrael'])
  })

  it('keeps the earliest first-seen time across sessions', () => {
    // Each login starts a fresh reducer, so a later session reports its own
    // start time. The record must remember when the character was first met.
    const first = emptyCharacter('Sabrael', 1000)
    const later = emptyCharacter('Sabrael', 90000)
    const file = withCharacter(withCharacter(emptyCharacterFile(), first), later)
    expect(file.characters['Sabrael']?.firstSeenMs).toBe(1000)
  })

  it('does not change the file it was given', () => {
    const file = emptyCharacterFile()
    withCharacter(file, emptyCharacter('Sabrael', 1))
    expect(file.characters).toEqual({})
  })
})

describe('withoutCharacter', () => {
  it('removes a character', () => {
    const file = withCharacter(emptyCharacterFile(), emptyCharacter('Sabrael', 1))
    expect(withoutCharacter(file, 'Sabrael').characters).toEqual({})
  })

  it('returns the same file when the name is absent', () => {
    const file = withCharacter(emptyCharacterFile(), emptyCharacter('Sabrael', 1))
    expect(withoutCharacter(file, 'Nobody')).toBe(file)
  })
})

describe('createCharacterStore', () => {
  let directory: string
  let path: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-store-'))
    path = join(directory, CHARACTERS_FILE)
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('starts empty', async () => {
    expect(await createCharacterStore(directory).load()).toEqual(emptyCharacterFile())
  })

  it('writes and reads a character back', async () => {
    const record = { ...emptyCharacter('Sabrael', 1000), title: 'Grand Master' }
    const store = createCharacterStore(directory)
    await store.update((file) => withCharacter(file, record))

    const reopened = createCharacterStore(directory)
    expect((await reopened.load()).characters['Sabrael']?.title).toBe('Grand Master')
  })

  it('writes readable JSON', async () => {
    const store = createCharacterStore(directory)
    await store.update((file) => withCharacter(file, emptyCharacter('Sabrael', 1)))
    expect(await readFile(path, 'utf8')).toContain('\n  ')
  })

  it('applies changes one after another', async () => {
    const store = createCharacterStore(directory)
    await Promise.all([
      store.update((file) => withCharacter(file, emptyCharacter('One', 1))),
      store.update((file) => withCharacter(file, emptyCharacter('Two', 2))),
      store.update((file) => withCharacter(file, emptyCharacter('Three', 3)))
    ])
    expect(Object.keys((await createCharacterStore(directory).load()).characters).sort()).toEqual([
      'One',
      'Three',
      'Two'
    ])
  })

  it('keeps a backup, and heals from it when the primary is corrupt', async () => {
    const store = createCharacterStore(directory)
    await store.update((file) => withCharacter(file, emptyCharacter('Sabrael', 1)))
    // A second write is what creates the backup from the first.
    await store.update((file) => withCharacter(file, emptyCharacter('Fintan', 2)))

    await writeFile(path, '{ this is not json', 'utf8')

    const failures: JsonStoreFailure[] = []
    const healed = createCharacterStore(directory, (failure) => failures.push(failure))
    const recovered = await healed.load()

    expect(Object.keys(recovered.characters)).toContain('Sabrael')
    expect(failures.some((failure) => failure.stage === 'parse')).toBe(true)
  })

  it('moves a corrupt file aside rather than discarding it', async () => {
    await writeFile(path, 'not json at all', 'utf8')
    const failures: JsonStoreFailure[] = []
    const store = createCharacterStore(directory, (failure) => failures.push(failure))

    expect(await store.load()).toEqual(emptyCharacterFile())
    const quarantined = failures.find((failure) => failure.stage === 'quarantine')
    expect(quarantined?.message).toMatch(/moved aside to /)
  })

  it('rejects a file whose shape is wrong, rather than trusting it', async () => {
    await writeFile(path, JSON.stringify({ version: 1, characters: { a: { name: 5 } } }), 'utf8')
    const store = createCharacterStore(directory)
    expect(await store.load()).toEqual(emptyCharacterFile())
  })

  it('rejects a file from a version it does not know', async () => {
    await writeFile(path, JSON.stringify({ version: 99, characters: {} }), 'utf8')
    expect(await createCharacterStore(directory).load()).toEqual(emptyCharacterFile())
  })
})
