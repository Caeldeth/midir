import { describe, expect, it } from 'vitest'
import { hostileMaps, isHostileName, HOSTILE_PATTERNS } from '../hostile'

/**
 * The hostile-map list (WP41). It is a prior the player keeps, not a
 * measurement: nothing on the wire says a map holds monsters.
 */
const node = (mapId: number, name: string): { mapId: number; name: string } => ({ mapId, name })

describe('the hostile map list', () => {
  it('names the places Sabrael named', () => {
    // 2026-09-27: "Mileth Crypt, Abel Crypt, Piet Crypt, Mehadi, East Woodlands,
    // West Woodlands".
    expect(isHostileName(node(1, 'Mileth Crypt 1-1'))).toBe(true)
    expect(isHostileName(node(2, 'Abel Crypt 3-2'))).toBe(true)
    expect(isHostileName(node(3, 'Piet Dungeon 2-1'))).toBe(true)
    expect(isHostileName(node(4, 'Mehadi Entrance'))).toBe(true)
    expect(isHostileName(node(5, 'East Woodland 4-1'))).toBe(true)
    expect(isHostileName(node(6, 'West Woodland 10-1'))).toBe(true)
  })

  it('names the mines, Astrid and Veltain, which Sabrael added', () => {
    // 2026-09-27. Counted first: `mine` takes 47 known names and every one is a
    // mine, and all 8 Veltain maps say "Veltain Mines".
    expect(isHostileName(node(624, 'Mine 1-1'))).toBe(true)
    expect(isHostileName(node(660, 'Mine Entrance'))).toBe(true)
    expect(isHostileName(node(2901, 'Veltain Mines 1'))).toBe(true)
    expect(isHostileName(node(3062, 'Astrid South'))).toBe(true)
    expect(isHostileName(node(3060, 'Astrid Entrance'))).toBe(true)
  })

  it('leaves a town and its shops alone', () => {
    for (const name of [
      'Mileth Village',
      'Mileth Bank',
      'Rucesion Commons',
      'Abel Port',
      'Oren Island City',
      'Oren Island Shop 1',
      'Mileth Inn',
      'Suomi Village',
      // `mine` is a whole word, so a name that merely contains those letters is
      // not a mine.
      'Determined Hall'
    ]) {
      expect(isHostileName(node(9, name))).toBe(false)
    }
  })

  it('matches any name a node answers to, so an imported name is enough', () => {
    expect(hostileMaps([{ mapId: 1, name: '', seedName: 'Mileth Crypt 4-1' }])).toEqual(
      new Set([1])
    )
    expect(hostileMaps([{ mapId: 2, name: '', gameName: 'Shinewood Forest 5' }])).toEqual(
      new Set([2])
    )
  })

  it('takes the ids of the nodes it is given, and only those', () => {
    const hostile = hostileMaps([
      node(500, 'Mileth Village'),
      node(1, 'Mileth Crypt 1-1'),
      node(452, 'West Woodland 10-1')
    ])
    expect([...hostile].sort((a, b) => a - b)).toEqual([1, 452])
  })

  it('reads a pattern against the whole name, not the start of it', () => {
    expect(isHostileName(node(1, "Red Dragon Plamit's Cave 2-1"))).toBe(true)
    expect(isHostileName(node(2, 'Mount Giragan 13 hunting zone'))).toBe(true)
  })

  it('keeps every pattern case-insensitive, so a wire name in caps still matches', () => {
    expect(HOSTILE_PATTERNS.every((pattern) => pattern.flags.includes('i'))).toBe(true)
    expect(isHostileName(node(1, 'MILETH CRYPT 1-1'))).toBe(true)
  })
})
