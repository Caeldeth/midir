import { DIRECTION_DELTA } from '../protocol/decode'
import type { MapGrid } from './mapGrid'

/**
 * The within-map planner: A* over a map's passability to reach a tile.
 *
 * This is the second of the walker's two levels of planning (WP15 decision 2).
 * The between-maps graph (route/graph.ts) says which warp tile to reach; this
 * finds the tiles that lead to it, around walls. It is pure: a grid and two
 * tiles in, a list of steps out.
 *
 * The result is the list of tiles to stand on, in order, from the tile after the
 * start up to and including the goal. The walker walks it one step at a time and
 * re-plans when a step does not confirm, so the path is advice, not a script.
 */

/** One tile. */
export interface Tile {
  x: number
  y: number
}

/** A step the walker takes: the direction to press, and the tile it reaches. */
export interface PathStep {
  /** 0 North, 1 East, 2 South, 3 West, matching the walk keys. */
  direction: number
  x: number
  y: number
}

function key(x: number, y: number): number {
  // Map ids stay well under 16 bits, so this packs a tile into one number.
  return (y << 16) | x
}

function manhattan(ax: number, ay: number, bx: number, by: number): number {
  return Math.abs(ax - bx) + Math.abs(ay - by)
}

/**
 * Find a path from `start` to `goal`, or null when none exists.
 *
 * Movement is four-connected and obeys the grid's `canMove`. The goal tile does
 * not need to be enterable from every side; the search stops as soon as it is
 * reached. A start that equals the goal returns an empty path.
 */
export function findPath(grid: MapGrid, start: Tile, goal: Tile): PathStep[] | null {
  if (!grid.inBounds(goal.x, goal.y)) return null
  if (start.x === goal.x && start.y === goal.y) return []

  const startKey = key(start.x, start.y)
  const goalKey = key(goal.x, goal.y)

  // A* with a Manhattan heuristic. The open set is kept as a small array and
  // scanned for the lowest f; maps are small enough that a heap is not worth it.
  const gScore = new Map<number, number>([[startKey, 0]])
  const cameFrom = new Map<number, { from: number; direction: number; x: number; y: number }>()
  const open = new Set<number>([startKey])
  const openXY = new Map<number, Tile>([[startKey, { x: start.x, y: start.y }]])

  while (open.size > 0) {
    // Pick the open tile with the lowest f = g + h.
    let currentKey = -1
    let bestF = Infinity
    for (const k of open) {
      const tile = openXY.get(k)!
      const f = (gScore.get(k) ?? Infinity) + manhattan(tile.x, tile.y, goal.x, goal.y)
      if (f < bestF) {
        bestF = f
        currentKey = k
      }
    }
    const current = openXY.get(currentKey)!
    if (currentKey === goalKey) return reconstruct(cameFrom, goalKey)

    open.delete(currentKey)
    openXY.delete(currentKey)

    for (let direction = 0; direction < 4; direction++) {
      if (!grid.canMove(current.x, current.y, direction)) continue
      const [dx, dy] = DIRECTION_DELTA[direction]!
      const nx = current.x + dx
      const ny = current.y + dy
      const neighbourKey = key(nx, ny)
      const tentative = (gScore.get(currentKey) ?? Infinity) + 1
      if (tentative < (gScore.get(neighbourKey) ?? Infinity)) {
        cameFrom.set(neighbourKey, { from: currentKey, direction, x: nx, y: ny })
        gScore.set(neighbourKey, tentative)
        open.add(neighbourKey)
        openXY.set(neighbourKey, { x: nx, y: ny })
      }
    }
  }
  return null
}

function reconstruct(
  cameFrom: Map<number, { from: number; direction: number; x: number; y: number }>,
  goalKey: number
): PathStep[] {
  const steps: PathStep[] = []
  let k = goalKey
  while (cameFrom.has(k)) {
    const step = cameFrom.get(k)!
    steps.push({ direction: step.direction, x: step.x, y: step.y })
    k = step.from
  }
  steps.reverse()
  return steps
}
