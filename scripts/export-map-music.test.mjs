import { describe, expect, it } from 'vitest'
import { csvField, defaultMapsPath, musicRows, toCsv } from './export-map-music.mjs'

/**
 * The map music export (WP40). The store's own shape, including the maps that
 * carry no reading, which is most of them.
 */
const FILE = {
  maps: {
    505: {
      name: 'Rucesion Village',
      width: 50,
      height: 50,
      seenAtMs: 1000,
      music: { track: 16, seenAtMs: 1100 }
    },
    3049: { name: 'Rucesion Hall', width: 20, height: 20, seenAtMs: 1200 },
    502: {
      name: 'Abel Port, the "docks"',
      width: 30,
      height: 30,
      seenAtMs: 1300,
      music: { track: 17, seenAtMs: 1400 }
    }
  }
}

describe('musicRows', () => {
  it('takes the maps that have a reading, in map id order', () => {
    expect(musicRows(FILE).map((row) => [row.mapId, row.track])).toEqual([
      [502, 17],
      [505, 16]
    ])
  })

  it('leaves out a map that stayed silent, rather than exporting a zero', () => {
    expect(musicRows(FILE).some((row) => row.mapId === 3049)).toBe(false)
  })

  it('states the time the track was read', () => {
    expect(musicRows(FILE)[1]).toMatchObject({
      name: 'Rucesion Village',
      seenAtMs: 1100,
      seenAt: '1970-01-01T00:00:01.100Z'
    })
  })

  it('reads an empty store as no rows', () => {
    expect(musicRows({ maps: {} })).toEqual([])
    expect(musicRows({})).toEqual([])
  })
})

describe('toCsv', () => {
  it('quotes a name that holds a comma, and doubles a quote inside it', () => {
    const csv = toCsv(musicRows(FILE))
    expect(csv.split('\n')[0]).toBe('mapId,name,track,seenAt')
    expect(csv).toContain('502,"Abel Port, the ""docks""",17,')
    expect(csv).toContain('505,Rucesion Village,16,')
  })

  it('leaves a plain field alone', () => {
    expect(csvField('Mileth')).toBe('Mileth')
    expect(csvField(16)).toBe('16')
  })
})

describe('defaultMapsPath', () => {
  it('names the store under LOCALAPPDATA on Windows', () => {
    expect(
      defaultMapsPath({ LOCALAPPDATA: String.raw`C:\Users\a\AppData\Local` }, 'win32')
    ).toContain('Erisco')
  })

  it('names nothing anywhere else, so the caller has to pass --maps', () => {
    expect(defaultMapsPath({ LOCALAPPDATA: '' }, 'win32')).toBeNull()
    expect(defaultMapsPath({}, 'linux')).toBeNull()
  })
})
