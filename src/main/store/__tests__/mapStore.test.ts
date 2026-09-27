import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createMapStore, emptyMapFile, MAPS_FILE, withMapMusic, withMapSize } from '../mapStore'

/** The maps the wire named and sized (WP30), and their music (WP40). */

const size = { name: 'Rucesion Village', width: 50, height: 50 }

describe('withMapSize', () => {
  it('keeps a music track that is already stored', () => {
    // The track arrives once and the size arrives on every visit, so a spread
    // of the size alone would wipe the track at the next map change.
    const withMusic = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    const revisited = withMapSize(withMusic, 505, size, 5000)
    expect(revisited.maps['505']?.music).toEqual({ track: 16, seenAtMs: 1100 })
  })

  it('keeps the track when the size itself changed', () => {
    const withMusic = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    const resized = withMapSize(withMusic, 505, { ...size, width: 60 }, 5000)
    expect(resized.maps['505']).toEqual({
      ...size,
      width: 60,
      seenAtMs: 5000,
      music: { track: 16, seenAtMs: 1100 }
    })
  })
})

describe('withMapMusic (WP40)', () => {
  it('stores the track against the map', () => {
    const file = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    expect(file.maps['505']?.music).toEqual({ track: 16, seenAtMs: 1100 })
  })

  it('writes nothing for a map it has no record of', () => {
    const file = emptyMapFile()
    expect(withMapMusic(file, 505, 16, 1100)).toBe(file)
  })

  it('writes nothing when the track has not changed', () => {
    const file = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    expect(withMapMusic(file, 505, 16, 9000)).toBe(file)
  })

  it('a newer reading replaces an older one', () => {
    const file = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    expect(withMapMusic(file, 505, 18, 2000).maps['505']?.music).toEqual({
      track: 18,
      seenAtMs: 2000
    })
  })

  it('an older reading does not replace a newer one, which is what a replay sends', () => {
    const file = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 5000)
    expect(withMapMusic(file, 505, 18, 2000)).toBe(file)
  })

  it('leaves the name and the size alone', () => {
    const file = withMapMusic(withMapSize(emptyMapFile(), 505, size, 1000), 505, 16, 1100)
    expect(file.maps['505']).toMatchObject({ ...size, seenAtMs: 1000 })
  })
})

describe('createMapStore', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-maps-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('round-trips the music track through the schema', async () => {
    // A field the schema does not name is dropped on load, silently. This is
    // the test that catches the next field added without its schema line.
    const store = createMapStore(directory)
    await store.update((file) => withMapMusic(withMapSize(file, 505, size, 1000), 505, 16, 1100))
    const raw = JSON.parse(await readFile(join(directory, MAPS_FILE), 'utf-8'))
    expect(raw.maps['505'].music).toEqual({ track: 16, seenAtMs: 1100 })
    const reopened = createMapStore(directory)
    expect((await reopened.load()).maps['505']?.music).toEqual({ track: 16, seenAtMs: 1100 })
  })

  it('loads a map that has no music, which is most of them', async () => {
    const store = createMapStore(directory)
    await store.update((file) => withMapSize(file, 505, size, 1000))
    const reopened = createMapStore(directory)
    const loaded = await reopened.load()
    expect(loaded.maps['505']?.name).toBe('Rucesion Village')
    expect(loaded.maps['505']?.music).toBeUndefined()
  })
})
