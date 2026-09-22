import { describe, expect, it } from 'vitest'
import { occupantAt, reduceEntities, solidTiles, type EntityState } from '../entities'
import type { DecodedPacket, WorldObject } from '../../protocol/decode'

/**
 * What stands on the map (WP35): the reducer is fed decoded-packet literals,
 * as the position reducer is. The walker reads `solidTiles` so a right-click
 * never aims at a tile something living stands on.
 */

const OWN = 'Gabrael'

const mapInfo = (mapId: number): DecodedPacket => ({
  kind: 'mapInfo',
  mapId,
  width: 15,
  height: 15,
  flags: 0,
  name: 'Mileth'
})
const human = (entityId: number, name: string, x: number, y: number): DecodedPacket => ({
  kind: 'drawHumanObjects',
  x,
  y,
  direction: 0,
  entityId,
  name,
  nameStyle: 0,
  groupAdText: ''
})
const objects = (...list: WorldObject[]): DecodedPacket => ({
  kind: 'addWorldObjects',
  objects: list
})
const monster = (id: number, x: number, y: number, type = 0) =>
  ({ kind: 'creature', id, x, y, sprite: 1, direction: 0, type }) as const
const npc = (id: number, name: string, x: number, y: number) =>
  ({ kind: 'creature', id, x, y, sprite: 56, direction: 0, type: 2, name }) as const
const item = (id: number, x: number, y: number) =>
  ({ kind: 'item', id, x, y, sprite: 9, color: 0 }) as const
const move = (id: number, fromX: number, fromY: number, direction: number): DecodedPacket => ({
  kind: 'creatureMove',
  id,
  fromX,
  fromY,
  direction
})
const remove = (id: number): DecodedPacket => ({ kind: 'removeWorldObject', id })

let clock = 1000
function feed(
  state: EntityState | null,
  packet: DecodedPacket,
  extra: { sawLoss?: boolean } = {}
): EntityState | null {
  return reduceEntities(state, {
    packet,
    timestampMs: ++clock,
    sawLoss: extra.sawLoss,
    ownName: OWN
  })
}

const tiles = (state: EntityState | null): string[] => [...solidTiles(state)].sort()

describe('the entities on the map (WP35)', () => {
  it('keeps a player, an NPC, and a solid monster as taken tiles, and not an item or a walk-through monster', () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, human(7, 'Bran', 5, 5))
    state = feed(
      state,
      objects(npc(8, 'Antonio', 3, 4), monster(9, 6, 6), monster(10, 7, 7, 1), item(11, 8, 8))
    )
    expect(tiles(state)).toEqual(['3,4', '5,5', '6,6'])
    expect(occupantAt(state, 3, 4)?.name).toBe('Antonio')
    expect(occupantAt(state, 7, 7)).toBeNull()
    expect(occupantAt(state, 8, 8)).toBeNull()
  })

  it("keeps the character's own draw apart, so its old tile is never taken", () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, human(1, OWN, 2, 2))
    state = feed(state, human(7, 'Bran', 5, 5))
    expect(state?.ownId).toBe(1)
    expect(tiles(state)).toEqual(['5,5'])
  })

  it('moves a creature from the tile the server names', () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, objects(monster(9, 6, 6)))
    state = feed(state, move(9, 6, 6, 1))
    expect(tiles(state)).toEqual(['7,6'])
    // The server's source wins over what was remembered.
    state = feed(state, move(9, 10, 10, 2))
    expect(tiles(state)).toEqual(['10,11'])
    // A move of something never drawn changes nothing.
    expect(feed(state, move(99, 0, 0, 0))).toBe(state)
  })

  it('takes a thing off the map on its remove', () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, objects(monster(9, 6, 6), monster(10, 7, 7)))
    state = feed(state, remove(9))
    expect(tiles(state)).toEqual(['7,7'])
    expect(feed(state, remove(9))).toBe(state)
  })

  it('clears everything on a new map, and keeps it on the same map again', () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, objects(monster(9, 6, 6)))
    expect(feed(state, mapInfo(3025))).toBe(state)
    state = feed(state, mapInfo(3048))
    expect(state?.mapId).toBe(3048)
    expect(tiles(state)).toEqual([])
  })

  it('clears everything after a loss, since a draw or a remove may have been dropped', () => {
    let state = feed(null, mapInfo(3025))
    state = feed(state, objects(monster(9, 6, 6)))
    state = feed(state, remove(12345), { sawLoss: true })
    expect(tiles(state)).toEqual([])
    expect(state?.mapId).toBe(3025)
  })

  it('does not change the old state', () => {
    const state = feed(feed(null, mapInfo(3025)), objects(monster(9, 6, 6)))
    const before = new Map(state!.byId)
    feed(state, move(9, 6, 6, 0))
    feed(state, remove(9))
    expect(state!.byId).toEqual(before)
  })

  it('reads nothing into an unmodelled packet before any map', () => {
    expect(feed(null, remove(9))).toBeNull()
    expect(feed(null, { kind: 'removeInventory', slot: 3 })).toBeNull()
  })
})
