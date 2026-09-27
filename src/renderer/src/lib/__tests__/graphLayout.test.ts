import { describe, expect, it } from 'vitest'
import { boundsOf, layoutGraph, type LayoutNode } from '../graphLayout'

/**
 * The world graph's layout (WP43): rings of hops from the root, deterministic,
 * and fast enough for the real graph at every scope.
 */

function neighboursOf(pairs: readonly [number, number][]): Map<number, number[]> {
  const map = new Map<number, number[]>()
  const add = (from: number, to: number): void => {
    const held = map.get(from)
    if (held === undefined) map.set(from, [to])
    else held.push(to)
  }
  for (const [from, to] of pairs) {
    add(from, to)
    add(to, from)
  }
  return map
}

function radius(node: LayoutNode): number {
  return Math.hypot(node.x, node.y)
}

describe('layoutGraph', () => {
  it('puts the root in the middle', () => {
    const placed = layoutGraph({
      nodes: [1, 2, 3],
      neighbours: neighboursOf([
        [1, 2],
        [2, 3]
      ]),
      root: 1
    })
    expect(placed.get(1)).toMatchObject({ x: 0, y: 0, depth: 0 })
  })

  it('puts a map one warp out on the first ring, and two warps out on the second', () => {
    const placed = layoutGraph({
      nodes: [1, 2, 3],
      neighbours: neighboursOf([
        [1, 2],
        [2, 3]
      ]),
      root: 1
    })
    expect(placed.get(2)?.depth).toBe(1)
    expect(placed.get(3)?.depth).toBe(2)
    expect(radius(placed.get(3)!)).toBeGreaterThan(radius(placed.get(2)!))
  })

  it('places every map of the scope, edges or none', () => {
    const placed = layoutGraph({ nodes: [1, 2, 50], neighbours: neighboursOf([[1, 2]]), root: 1 })
    expect([...placed.keys()].sort((a, b) => a - b)).toEqual([1, 2, 50])
  })

  it('keeps a piece of its own away from the root piece', () => {
    // 333 of the real graph's pieces are one map. They have to go somewhere,
    // and it must not be on top of the middle.
    const placed = layoutGraph({
      nodes: [1, 2, 7, 8],
      neighbours: neighboursOf([
        [1, 2],
        [7, 8]
      ]),
      root: 1
    })
    // The second piece goes below the first, so the root keeps the middle and
    // nothing lands on anything.
    const rootPiece = [1, 2].map((mapId) => placed.get(mapId)!)
    const apart = [7, 8].map((mapId) => placed.get(mapId)!)
    const lowest = Math.max(...rootPiece.map((node) => node.y))
    for (const node of apart) expect(node.y).toBeGreaterThan(lowest)
    const spots = new Set([...rootPiece, ...apart].map((node) => `${node.x},${node.y}`))
    expect(spots.size).toBe(4)
  })

  it('never places two maps of one ring on the same spot', () => {
    const pairs: [number, number][] = [
      [1, 2],
      [1, 3],
      [1, 4],
      [1, 5],
      [1, 6]
    ]
    const placed = layoutGraph({
      nodes: [1, 2, 3, 4, 5, 6],
      neighbours: neighboursOf(pairs),
      root: 1
    })
    const spots = new Set(
      [2, 3, 4, 5, 6].map((mapId) => {
        const node = placed.get(mapId)!
        return `${node.x.toFixed(3)},${node.y.toFixed(3)}`
      })
    )
    expect(spots.size).toBe(5)
  })

  it('ignores an edge that leaves the scope', () => {
    const placed = layoutGraph({
      nodes: [1, 2],
      neighbours: neighboursOf([
        [1, 2],
        [2, 99]
      ]),
      root: 1
    })
    expect(placed.has(99)).toBe(false)
    expect(placed.size).toBe(2)
  })

  it('draws the same graph the same way every time', () => {
    const input = {
      nodes: [1, 2, 3, 4, 5],
      neighbours: neighboursOf([
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
        [4, 5]
      ]),
      root: 1
    }
    const first = layoutGraph(input)
    const again = layoutGraph(input)
    for (const [mapId, node] of first) expect(again.get(mapId)).toEqual(node)
  })

  it('takes the lowest id as the root when the one it is given is out of scope', () => {
    const placed = layoutGraph({ nodes: [4, 9], neighbours: neighboursOf([[4, 9]]), root: 500 })
    expect(placed.get(4)).toMatchObject({ x: 0, y: 0 })
  })

  it('places nothing for an empty scope', () => {
    expect(layoutGraph({ nodes: [], neighbours: new Map() }).size).toBe(0)
  })

  it('settles a graph the size of the real world well inside a second', () => {
    // 718 maps and a warp chain through all of them, plus a hub, which is more
    // connected than the real graph at any one scope.
    const nodes = Array.from({ length: 718 }, (_, index) => index + 1)
    const pairs: [number, number][] = []
    for (let index = 1; index < nodes.length; index++) pairs.push([index, index + 1])
    for (let index = 2; index < 60; index++) pairs.push([1, index])
    const neighbours = neighboursOf(pairs)
    const started = Date.now()
    const placed = layoutGraph({ nodes, neighbours, root: 1 })
    expect(placed.size).toBe(718)
    expect(Date.now() - started).toBeLessThan(1000)
  })
})

describe('boundsOf', () => {
  it('holds every placed node', () => {
    const placed = layoutGraph({
      nodes: [1, 2, 3],
      neighbours: neighboursOf([
        [1, 2],
        [2, 3]
      ]),
      root: 1
    })
    const box = boundsOf(placed)
    for (const node of placed.values()) {
      expect(node.x).toBeGreaterThanOrEqual(box.minX)
      expect(node.x).toBeLessThanOrEqual(box.maxX)
      expect(node.y).toBeGreaterThanOrEqual(box.minY)
      expect(node.y).toBeLessThanOrEqual(box.maxY)
    }
  })

  it('is a point for one node', () => {
    expect(boundsOf(layoutGraph({ nodes: [5], neighbours: new Map() }))).toEqual({
      minX: 0,
      minY: 0,
      maxX: 0,
      maxY: 0
    })
  })
})
