import { describe, expect, it } from 'vitest'
import { DOOR_PAIRS, doorTileFor, isDoorTile } from '../doorTable'
import { buildMapGrid, type Collision, type DoorOverlay } from '../mapGrid'
import { doorKey } from '../../model/doors'
import { findPath } from '../pathfind'

/**
 * The door table and the overlay over the grid (WP31).
 *
 * The collision here is a stand-in for SOTP with the shape the real rows have:
 * the closed form of a door blocks every direction, the open form none.
 */
const CLOSED = 2898 // Rucesion Village's door at (42, 11), row [2898, 2904]
const OPEN = 2904
const WALL = 100
const COLLISION: Collision = {
  collisionFor: (id) => (id === WALL || id === CLOSED ? 0x0f : 0)
}

/** A 3x1 map: ground, a door in `slot`, ground. */
function corridor(doorTile: number, slot: 'first' | 'second', doors?: DoorOverlay) {
  const bytes = new Uint8Array(3 * 6)
  const view = new DataView(bytes.buffer)
  view.setUint16(1 * 6 + (slot === 'first' ? 2 : 4), doorTile, true)
  return buildMapGrid(bytes, 3, 1, COLLISION, doors)
}

describe('the client door table', () => {
  it('is the 66 rows read from the executable, with the rows the house page cites', () => {
    expect(DOOR_PAIRS).toHaveLength(66)
    expect(DOOR_PAIRS[2]).toEqual([2163, 4519])
    expect(DOOR_PAIRS).toContainEqual([3159, 3151])
    expect(DOOR_PAIRS).toContainEqual([2898, 2904])
  })

  it('every id sits in exactly one row', () => {
    const ids = DOOR_PAIRS.flat()
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('state 0 selects column 1 and any other state column 0, from either column', () => {
    expect(doorTileFor(CLOSED, 0)).toBe(OPEN)
    expect(doorTileFor(OPEN, 0)).toBe(OPEN)
    expect(doorTileFor(CLOSED, 1)).toBe(CLOSED)
    expect(doorTileFor(OPEN, 1)).toBe(CLOSED)
    expect(doorTileFor(OPEN, 0xff)).toBe(CLOSED)
  })

  it('an id in no row is not a door, and the packet changes nothing', () => {
    expect(isDoorTile(WALL)).toBe(false)
    expect(doorTileFor(WALL, 0)).toBeUndefined()
  })
})

describe('the door overlay over the grid', () => {
  it('a cached closed door is a wall until the wire opens it', () => {
    const shut = corridor(CLOSED, 'first')
    expect(shut.canMove(0, 0, 1)).toBe(false)
    expect(findPath(shut, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull()

    const opened = corridor(CLOSED, 'first', new Map([[doorKey(1, 0, 1), 0]]))
    expect(opened.canMove(0, 0, 1)).toBe(true)
    expect(opened.canMove(1, 0, 1)).toBe(true)
    expect(findPath(opened, { x: 0, y: 0 }, { x: 2, y: 0 })).not.toBeNull()
  })

  it('a door the cache stores open is a wall once the wire closes it', () => {
    expect(corridor(OPEN, 'first').canMove(0, 0, 1)).toBe(true)
    const closed = corridor(OPEN, 'first', new Map([[doorKey(1, 0, 1), 1]]))
    expect(closed.canMove(0, 0, 1)).toBe(false)
  })

  it('side 1 is the first static and side 0 the second: a state on the other slot is not this door', () => {
    const wrongSlot = corridor(CLOSED, 'first', new Map([[doorKey(1, 0, 0), 0]]))
    expect(wrongSlot.canMove(0, 0, 1)).toBe(false)
    const secondSlot = corridor(CLOSED, 'second', new Map([[doorKey(1, 0, 0), 0]]))
    expect(secondSlot.canMove(0, 0, 1)).toBe(true)
  })

  it('a state for a tile the client does not know as a door changes nothing', () => {
    const wall = corridor(WALL, 'first', new Map([[doorKey(1, 0, 1), 0]]))
    expect(wall.canMove(0, 0, 1)).toBe(false)
  })

  it('an empty overlay is the cache', () => {
    expect(corridor(CLOSED, 'first', new Map()).canMove(0, 0, 1)).toBe(false)
  })
})
