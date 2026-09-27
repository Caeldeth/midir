import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { graphView, type GraphHandlerContext } from '../handlers/graph'
import { createRouteGraph, type RouteNode } from '../route/graph'
import { createMapStore, withMapSize, type MapStore } from '../store/mapStore'
import type { Position } from '../model/position'

/**
 * The world graph view's handler (WP43).
 *
 * One read of the live graph, with the report over it. It writes nothing: an
 * edit from this view goes through `map:editWarp`, the one write path (WP30).
 */

const NODES: RouteNode[] = [
  {
    mapId: 1,
    name: 'Mileth',
    // Two doors to the same shop, and one of them the wire proved.
    exits: [
      { toMapId: 2, x: 3, y: 0 },
      { toMapId: 2, x: 4, y: 0, source: 'learned', observations: 3 }
    ],
    candidates: [{ toMapId: 9, x: 5, y: 0, source: 'xml' }]
  },
  { mapId: 2, name: 'Mileth Inn', exits: [{ toMapId: 1, x: 0, y: 0 }] },
  { mapId: 9, name: 'Mileth Crypt', exits: [] },
  { mapId: 30, name: '', exits: [] }
]

const position = (mapId: number): Position => ({
  mapId,
  x: 1,
  y: 1,
  facing: 0,
  confidence: 'confirmed',
  asOfMs: 0,
  mapWidth: 10,
  mapHeight: 10
})

describe('the graph view handler', () => {
  let directory: string
  let mapStore: MapStore
  let ctx: GraphHandlerContext
  let positions: Record<string, Position>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-graph-'))
    mapStore = createMapStore(directory)
    positions = {}
    ctx = {
      graph: createRouteGraph(NODES),
      mapStore,
      liveConnections: () =>
        Object.keys(positions).map((connectionId) => ({
          connectionId,
          name: 'Gabrael',
          windowHandle: 1,
          processId: 1,
          title: 'Dark Ages'
        })),
      positionFor: (connectionId) => positions[connectionId] ?? null
    }
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('draws one row for each map, with the name the app shows', async () => {
    const view = await graphView(ctx)
    expect(view.nodes.map((n) => n.mapId)).toEqual([1, 2, 9, 30])
    expect(view.nodes[0]?.name).toBe('Mileth')
  })

  it('takes a nameless map name from the wire, and says the map was read', async () => {
    await mapStore.update((file) =>
      withMapSize(file, 30, { name: 'Loures Garden', width: 20, height: 20 }, 1000)
    )
    const view = await graphView(ctx)
    const node = view.nodes.find((n) => n.mapId === 30)
    expect(node?.name).toBe('Loures Garden')
    expect(node?.read).toBe(true)
    expect(view.nodes.find((n) => n.mapId === 1)?.read).toBe(false)
  })

  it('collapses the tiles of one hop into one warp, and keeps the strongest source', async () => {
    const view = await graphView(ctx)
    const pair = view.edges.find((e) => e.fromMapId === 1 && e.toMapId === 2)
    expect(pair).toMatchObject({ tiles: 2, candidate: false, source: 'learned', observations: 3 })
  })

  it('marks a warp only the XML proposes as a candidate', async () => {
    const view = await graphView(ctx)
    expect(view.edges.find((e) => e.fromMapId === 1 && e.toMapId === 9)).toMatchObject({
      candidate: true,
      source: 'xml'
    })
  })

  it('marks the maps that hold monsters, from the name', async () => {
    const view = await graphView(ctx)
    expect(view.nodes.find((n) => n.mapId === 9)?.hostile).toBe(true)
    expect(view.nodes.find((n) => n.mapId === 1)?.hostile).toBe(false)
  })

  it('carries the report, so the panel needs no second call', async () => {
    const view = await graphView(ctx)
    expect(view.report.nodes).toBe(4)
    expect(view.report.components).toHaveLength(3)
    expect(view.report.candidateOnly).toEqual([9])
    // Map 2 warps back to Mileth, so Mileth has a way in. Map 30 has none.
    expect(view.report.noWayIn).toEqual([30])
  })

  it('says where a live character stands, so the view can open on its own piece', async () => {
    positions['c1'] = position(2)
    const view = await graphView(ctx)
    expect(view.positions).toEqual([{ connectionId: 'c1', name: 'Gabrael', mapId: 2 }])
  })

  it('holds a map that only another map mentions', async () => {
    const ctxWithGhost: GraphHandlerContext = {
      ...ctx,
      graph: createRouteGraph([{ mapId: 1, name: 'Mileth', exits: [{ toMapId: 77, x: 0, y: 0 }] }])
    }
    const view = await graphView(ctxWithGhost)
    expect(view.nodes.map((n) => n.mapId)).toEqual([1, 77])
    expect(view.nodes.find((n) => n.mapId === 77)?.name).toBe('')
  })
})
