import { describe, expect, it } from 'vitest'
import { buildMapGrid, type Collision } from '../mapGrid'
import { findPath } from '../pathfind'

/** A wall static tile id, and the collision table that blocks it in every direction. */
const WALL = 100
const COLLISION: Collision = { collisionFor: (id) => (id === WALL ? 0x0f : 0) }

/**
 * Build a map-cache buffer from an ASCII grid.
 *
 *   '#' is a wall (its left static tile blocks all four directions),
 *   anything else is open ground.
 *
 * Rows are given top to bottom, so grid[y][x] is row y, column x.
 */
function gridFromAscii(rows: string[]): ReturnType<typeof buildMapGrid> {
  const height = rows.length
  const width = rows[0].length
  const bytes = new Uint8Array(width * height * 6)
  const view = new DataView(bytes.buffer)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = (y * width + x) * 6
      const leftStatic = rows[y][x] === '#' ? WALL : 0
      view.setUint16(base + 2, leftStatic, true)
    }
  }
  return buildMapGrid(bytes, width, height, COLLISION)
}

describe('buildMapGrid', () => {
  it('rejects a buffer that is too short for the dimensions', () => {
    expect(() => buildMapGrid(new Uint8Array(6), 2, 2, COLLISION)).toThrow(/too short/)
  })

  it('accepts a buffer with extra trailing bytes', () => {
    const grid = buildMapGrid(new Uint8Array(2 * 2 * 6 + 10), 2, 2, COLLISION)
    expect(grid.width).toBe(2)
    expect(grid.height).toBe(2)
  })

  it('blocks a move off the map edge', () => {
    const grid = gridFromAscii(['..', '..'])
    // 0 North from the top row leaves the map.
    expect(grid.canMove(0, 0, 0)).toBe(false)
    // 1 East from the right column leaves the map.
    expect(grid.canMove(1, 0, 1)).toBe(false)
  })

  it('blocks a move into a wall and out of one', () => {
    const grid = gridFromAscii(['.#.'])
    // East from (0,0) into the wall at (1,0) is blocked.
    expect(grid.canMove(0, 0, 1)).toBe(false)
    // West from (2,0) into the wall at (1,0) is blocked.
    expect(grid.canMove(2, 0, 3)).toBe(false)
  })

  it('allows a move between two open tiles', () => {
    const grid = gridFromAscii(['..'])
    expect(grid.canMove(0, 0, 1)).toBe(true)
  })
})

describe('findPath', () => {
  it('returns an empty path when already on the goal', () => {
    const grid = gridFromAscii(['..', '..'])
    expect(findPath(grid, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([])
  })

  it('walks a straight open corridor', () => {
    const grid = gridFromAscii(['....'])
    const path = findPath(grid, { x: 0, y: 0 }, { x: 3, y: 0 })
    expect(path).toEqual([
      { direction: 1, x: 1, y: 0 },
      { direction: 1, x: 2, y: 0 },
      { direction: 1, x: 3, y: 0 }
    ])
  })

  it('routes around a wall that a greedy walk would hit', () => {
    // A vertical wall down the middle with a gap at the bottom row.
    const grid = gridFromAscii(['.#.', '.#.', '...'])
    const path = findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })
    expect(path).not.toBeNull()
    // The last step lands on the goal.
    expect(path![path!.length - 1]).toEqual({ direction: 0, x: 2, y: 0 })
    // Every step is a legal single move.
    let x = 0
    let y = 0
    for (const step of path!) {
      expect(grid.canMove(x, y, step.direction)).toBe(true)
      x = step.x
      y = step.y
    }
    expect([x, y]).toEqual([2, 0])
  })

  it('returns null when the goal is walled off', () => {
    // The goal (2,0) is boxed in by walls on its only open sides.
    const grid = gridFromAscii(['.#o', '.##', '...'])
    expect(findPath(grid, { x: 0, y: 0 }, { x: 2, y: 0 })).toBeNull()
  })

  it('returns null when the goal is off the map', () => {
    const grid = gridFromAscii(['..'])
    expect(findPath(grid, { x: 0, y: 0 }, { x: 5, y: 0 })).toBeNull()
  })
})
