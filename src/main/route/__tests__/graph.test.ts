import { describe, expect, it } from 'vitest'
import { createRouteGraph, mergeLearned, worldGraph, type RouteNode } from '../graph'
import { createLiveGraph } from '../liveGraph'
import type { LearnedEdge } from '../../store/transitionStore'
import { builtinErrands } from '../../laborer/errands'

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

  it('leaves out a map the caller says is not passable, and fails when it was the only way', () => {
    // WP32: the walker passes the gated maps its character cannot enter.
    // Town -> Field -> Cave has no way round Field.
    expect(graph.planRoute(1, 3, { passable: (mapId) => mapId !== 2 })).toBeNull()
    // The destination itself may be the gated map.
    expect(graph.planRoute(1, 2, { passable: (mapId) => mapId !== 2 })).toBeNull()
    // The start map is never asked, and an open route is unchanged.
    const plan = graph.planRoute(2, 3, { passable: (mapId) => mapId !== 2 })
    expect(plan?.legs.map((l) => l.toMapId)).toEqual([3])
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

  it('crosses the world map from Mileth to Abel through a click', () => {
    // Mileth Inn -> Mileth -> MilethEnt -> (world map) -> Abel Outskirts -> Abel.
    // The MilethEnt leg is the hop: its warps open the pane, and the click DA
    // Walker recorded for Abel Outskirts is (306, 77).
    const plan = worldGraph.planRoute(136, 502)!
    expect(plan.legs.map((l) => l.toMapId)).toEqual([500, 3006, 3014, 502])
    const hop = plan.legs.find((l) => l.fromMapId === 3006)!
    expect(hop.warps.every((w) => w.via?.kind === 'fieldMap')).toBe(true)
    expect(hop.warps[0].via).toEqual({ kind: 'fieldMap', screenX: 306, screenY: 77 })
    // The plain legs carry no hop.
    expect(plan.legs[0].warps.every((w) => w.via === undefined)).toBe(true)
  })

  it('reaches every Mileth and Rucesion errand building', () => {
    // Sabrael's captures of 2026-09-21, through scripts/worldmap-overrides.json.
    expect(worldGraph.planRoute(136, 3026)!.legs.map((l) => l.toMapId)).toEqual([
      500, 3006, 3025, 3026
    ])
    expect(worldGraph.planRoute(136, 134)!.legs.map((l) => l.toMapId)).toEqual([500, 134])
    for (const name of [
      'Rucesion Inn',
      'Rucesion Bank',
      'Rucesion Town Hall',
      'Mileth Inn',
      'Mileth Tavern',
      'Mileth Town Hall'
    ]) {
      const id = worldGraph.resolveDestination(name)
      expect(id, name).not.toBeNull()
      expect(worldGraph.planRoute(498, id!), name).not.toBeNull()
    }
  })

  it("resolves and routes every built-in errand's destination", () => {
    // WP33 acceptance criterion 1. Piet, Abel, and Undine banks come from the
    // Hybrasyl world xml; the rest from Sabrael's captures.
    for (const errand of builtinErrands()) {
      const id = worldGraph.resolveDestination(errand.destination)
      expect(id, errand.name).not.toBeNull()
      expect(worldGraph.planRoute(498, id!), errand.name).not.toBeNull()
    }
    expect(worldGraph.planRoute(498, 148)!.legs.map((l) => l.toMapId)).toEqual([
      505, 3012, 3020, 501, 148
    ])
  })

  it('reaches Piet and Undine, the other bank towns, across the world map', () => {
    expect(worldGraph.planRoute(505, 3020)).not.toBeNull()
    expect(worldGraph.planRoute(505, 504)).not.toBeNull()
  })
})

describe('hops', () => {
  // Town's only way to Cave is a prompt; Field to Cave needs an NPC dialog.
  const HOPS: RouteNode[] = [
    {
      mapId: 1,
      name: 'Town',
      exits: [
        { toMapId: 2, x: 3, y: 4, via: { kind: 'fieldMap', screenX: 100, screenY: 200 } },
        { toMapId: 3, x: 9, y: 9, via: { kind: 'prompt' } }
      ]
    },
    { mapId: 2, name: 'Field', exits: [{ toMapId: 3, x: 7, y: 8, via: { kind: 'dialog' } }] },
    { mapId: 3, name: 'Cave', exits: [] },
    { mapId: 4, name: 'Ship', exits: [{ toMapId: 3, x: 1, y: 1, via: { kind: 'dialog' } }] }
  ]
  const graph = createRouteGraph(HOPS)

  it('carries the hop on the leg', () => {
    expect(graph.planRoute(1, 2)!.legs[0].warps).toEqual([
      { x: 3, y: 4, via: { kind: 'fieldMap', screenX: 100, screenY: 200 } }
    ])
  })

  it('routes through a prompt but never through an NPC dialog', () => {
    expect(graph.planRoute(1, 3)!.legs.map((l) => l.toMapId)).toEqual([3])
    expect(graph.planRoute(2, 3)).toBeNull()
    expect(graph.planRoute(4, 3)).toBeNull()
  })
})

describe('the learned layer (WP29)', () => {
  const learned = (
    fromMapId: number,
    x: number,
    y: number,
    toMapId: number,
    over: Partial<LearnedEdge> = {}
  ): LearnedEdge => ({
    fromMapId,
    x,
    y,
    toMapId,
    observations: 2,
    firstSeenMs: 1,
    lastSeenMs: 2,
    ...over
  })

  it('confirms an authored edge with its count and adds one the file lacks as learned', () => {
    const nodes = mergeLearned(NODES, [
      learned(1, 3, 4, 2),
      learned(1, 4, 4, 2, { observations: 3 })
    ])
    const town = nodes.find((n) => n.mapId === 1)!
    expect(town.exits).toEqual([
      { toMapId: 2, x: 3, y: 4, observations: 2 },
      { toMapId: 2, x: 5, y: 4 },
      { toMapId: 2, x: 4, y: 4, source: 'learned', observations: 3 }
    ])
  })

  it('adds a map the file does not know, named and sized by the wire', () => {
    const nodes = mergeLearned(NODES, [learned(1, 0, 9, 1978), learned(1978, 10, 8, 1)], {
      '1978': { name: 'Tagor Pet Store', width: 12, height: 10 }
    })
    const shop = nodes.find((n) => n.mapId === 1978)!
    expect(shop).toEqual({
      mapId: 1978,
      name: '',
      gameName: 'Tagor Pet Store',
      width: 12,
      height: 10,
      exits: [{ toMapId: 1, x: 10, y: 8, source: 'learned', observations: 2 }]
    })
    const graph = createRouteGraph(nodes)
    expect(graph.planRoute(2, 1978)?.legs.map((l) => l.toMapId)).toEqual([1, 1978])
    expect(graph.resolveDestination('tagor pet')).toBe(1978)
    expect(graph.destinations().find((d) => d.mapId === 1978)).toEqual({
      mapId: 1978,
      name: '',
      gameName: 'Tagor Pet Store'
    })
  })

  it('lays the game name over a node and keeps the .dat name for resolving', () => {
    const nodes = mergeLearned(NODES, [], { '2': { name: 'Green Field', width: 9, height: 9 } })
    const graph = createRouteGraph(nodes)
    expect(graph.node(2)).toMatchObject({ name: 'Field', gameName: 'Green Field', width: 9 })
    expect(graph.resolveDestination('Field')).toBe(2)
    expect(graph.resolveDestination('Green Field')).toBe(2)
    expect(graph.resolveDestination('green')).toBe(2)
    // The .dat's size wins over the wire's for a map it has.
    const sized = mergeLearned([{ mapId: 7, name: 'Sized', width: 3, height: 3, exits: [] }], [], {
      '7': { name: 'Sized', width: 30, height: 30 }
    })
    expect(sized[0]).toMatchObject({ width: 3, height: 3 })
  })

  it('carries a learned world-map hop with its click', () => {
    const via = { kind: 'fieldMap' as const, screenX: 306, screenY: 77 }
    const nodes = mergeLearned(NODES, [learned(5, 0, 0, 1, { via })])
    const graph = createRouteGraph(nodes)
    expect(graph.planRoute(5, 1)?.legs[0]?.warps).toEqual([{ x: 0, y: 0, via }])
  })

  it('never changes the imported nodes', () => {
    const frozen = JSON.stringify(NODES)
    mergeLearned(NODES, [learned(1, 4, 4, 2), learned(1, 3, 4, 2)], {
      '1': { name: 'Town Square', width: 5, height: 5 }
    })
    expect(JSON.stringify(NODES)).toBe(frozen)
  })

  it('the live graph answers from the newest merge', () => {
    const live = createLiveGraph(NODES)
    expect(live.planRoute(1, 5)).toBeNull()
    live.update([learned(2, 8, 8, 5)], { '5': { name: 'The Island', width: 4, height: 4 } })
    expect(live.planRoute(1, 5)?.legs.map((l) => l.toMapId)).toEqual([2, 5])
    expect(live.resolveDestination('the island')).toBe(5)
    expect(live.nodes().find((n) => n.mapId === 5)?.gameName).toBe('The Island')
    live.update([], {})
    expect(live.planRoute(1, 5)).toBeNull()
  })
})
