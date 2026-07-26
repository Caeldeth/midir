import { describe, expect, it } from 'vitest'
import { createRouteGraph, worldGraph, type RouteNode } from '../graph'

/**
 * A small, hand-made graph:
 *
 *   1 "Town" --(3,4)--> 2 "Field" --(7,8)--> 3 "Cave"
 *                        \--(1,1)--> 4 "Lake"  (dead end)
 *   Town has two doors to Field, at (3,4) and (5,4).
 */
const NODES: RouteNode[] = [
  {
    mapId: 1,
    name: 'Town',
    exits: [
      { toMapId: 2, x: 3, y: 4 },
      { toMapId: 2, x: 5, y: 4 }
    ]
  },
  {
    mapId: 2,
    name: 'Field',
    exits: [
      { toMapId: 1, x: 0, y: 0 },
      { toMapId: 3, x: 7, y: 8 },
      { toMapId: 4, x: 1, y: 1 }
    ]
  },
  { mapId: 3, name: 'Cave', exits: [{ toMapId: 2, x: 9, y: 9 }] },
  { mapId: 4, name: 'Lake', exits: [{ toMapId: 2, x: 2, y: 2 }] },
  { mapId: 5, name: 'Island', exits: [] }
]

describe('resolveDestination', () => {
  const graph = createRouteGraph(NODES)

  it('resolves a map id that exists', () => {
    expect(graph.resolveDestination(3)).toBe(3)
  })

  it('rejects a map id that does not exist', () => {
    expect(graph.resolveDestination(99)).toBeNull()
  })

  it('resolves a numeric string as a map id', () => {
    expect(graph.resolveDestination('4')).toBe(4)
  })

  it('resolves a name, ignoring case', () => {
    expect(graph.resolveDestination('cave')).toBe(3)
  })

  it('resolves a unique partial name', () => {
    expect(graph.resolveDestination('isl')).toBe(5)
  })

  it('prefers an exact name over a partial one', () => {
    const graphWithOverlap = createRouteGraph([
      { mapId: 10, name: 'Mileth', exits: [] },
      { mapId: 11, name: 'Mileth Bank', exits: [] }
    ])
    expect(graphWithOverlap.resolveDestination('Mileth')).toBe(10)
  })

  it('refuses an ambiguous partial name', () => {
    const graphWithOverlap = createRouteGraph([
      { mapId: 10, name: 'West Woods 1', exits: [] },
      { mapId: 11, name: 'West Woods 2', exits: [] }
    ])
    expect(graphWithOverlap.resolveDestination('West Woods')).toBeNull()
  })

  it('rejects an empty string', () => {
    expect(graph.resolveDestination('  ')).toBeNull()
  })
})

describe('planRoute', () => {
  const graph = createRouteGraph(NODES)

  it('returns an empty plan when already on the destination map', () => {
    const plan = graph.planRoute(2, 2)
    expect(plan).toEqual({ fromMapId: 2, toMapId: 2, legs: [] })
  })

  it('plans a single warp to an adjacent map', () => {
    const plan = graph.planRoute(1, 2)
    expect(plan?.legs).toHaveLength(1)
    expect(plan?.legs[0].fromMapId).toBe(1)
    expect(plan?.legs[0].toMapId).toBe(2)
  })

  it('carries every warp tile to the next map, so the walker can pick', () => {
    const plan = graph.planRoute(1, 2)
    expect(plan?.legs[0].warps).toEqual([
      { x: 3, y: 4 },
      { x: 5, y: 4 }
    ])
  })

  it('plans a route two maps away, in order', () => {
    const plan = graph.planRoute(1, 3)
    expect(plan?.legs.map((l) => [l.fromMapId, l.toMapId])).toEqual([
      [1, 2],
      [2, 3]
    ])
  })

  it('returns null when no route exists', () => {
    // Island (5) is disconnected from the rest.
    expect(graph.planRoute(1, 5)).toBeNull()
  })

  it('returns null when either map is unknown', () => {
    expect(graph.planRoute(1, 99)).toBeNull()
    expect(graph.planRoute(99, 1)).toBeNull()
  })
})

describe('the imported world graph', () => {
  it('knows Mileth, Abel, and the Mileth Bank', () => {
    expect(worldGraph.node(500)?.name).toBe('Mileth Altar')
    expect(worldGraph.resolveDestination('Abel')).toBe(502)
    expect(worldGraph.resolveDestination('Mileth Bank')).toBe(135)
  })

  it('routes from Mileth to Abel', () => {
    const plan = worldGraph.planRoute(500, 502)
    expect(plan).not.toBeNull()
    expect(plan!.legs.length).toBeGreaterThan(0)
    expect(plan!.legs[0].fromMapId).toBe(500)
    expect(plan!.legs[plan!.legs.length - 1].toMapId).toBe(502)
  })
})
