import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { editWarp, listMaps, mapPositions, mapView, type MapHandlerContext } from '../handlers/map'
import { createRouteGraph, type RouteNode } from '../route/graph'
import { createLiveGraph } from '../route/liveGraph'
import { buildMapGrid, type Collision, type MapGrid } from '../route/mapGrid'
import { createMapStore, withMapSize, type MapStore } from '../store/mapStore'
import {
  createTransitionStore,
  promotedEdges,
  withObservation,
  type TransitionStore
} from '../store/transitionStore'
import type { Position } from '../model/position'
import { doorKey, type DoorState } from '../model/doors'

/** The map viewer's handlers over a known grid, graph, and size store (WP30). */

const WALL = 100
const COLLISION: Collision = { collisionFor: (id) => (id === WALL ? 0x0f : 0) }

/** A 4x3 map: a wall at (1,1). */
function grid(): MapGrid {
  const bytes = new Uint8Array(4 * 3 * 6)
  new DataView(bytes.buffer).setUint16((1 * 4 + 1) * 6 + 2, WALL, true)
  return buildMapGrid(bytes, 4, 3, COLLISION)
}

const NODES: RouteNode[] = [
  { mapId: 1, name: 'Town', width: 4, height: 3, exits: [{ toMapId: 2, x: 3, y: 0 }] },
  { mapId: 2, name: 'Field', exits: [{ toMapId: 1, x: 0, y: 0, via: { kind: 'prompt' } }] },
  { mapId: 3, name: '', exits: [] }
]
const graph = createRouteGraph(NODES)

const position = (mapId: number, x: number, y: number): Position => ({
  mapId,
  x,
  y,
  facing: 0,
  confidence: 'confirmed',
  asOfMs: 0,
  mapWidth: 4,
  mapHeight: 3
})

describe('the map viewer handlers', () => {
  let directory: string
  let mapStore: MapStore
  let transitionStore: TransitionStore
  let requested: { mapId: number; width: number; height: number; doors: number }[]
  let ctx: MapHandlerContext
  let positions: Record<string, Position>
  let doors: Record<string, DoorState>

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-maps-'))
    mapStore = createMapStore(directory)
    transitionStore = createTransitionStore(directory)
    requested = []
    positions = {}
    doors = {}
    ctx = {
      graph,
      mapStore,
      transitionStore,
      graphChanged: async () => undefined,
      gameFolder: () => 'E:/Games/Dark Ages',
      liveConnections: () =>
        Object.keys(positions).map((id) => ({ connectionId: id, name: 'Fintan' })),
      positionFor: (id) => positions[id] ?? null,
      doorsFor: (id) => doors[id] ?? null,
      maps: {
        gridFor: async (mapId, width, height, overlay) => {
          requested.push({ mapId, width, height, doors: overlay?.size ?? 0 })
          return mapId === 9 ? null : grid()
        }
      }
    }
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('lists the graph and the learned maps, saying which can be drawn', async () => {
    await mapStore.update((file) =>
      withMapSize(file, 3, { name: 'Crypt', width: 5, height: 5 }, 10)
    )
    await mapStore.update((file) =>
      withMapSize(file, 7, { name: 'Wire Only', width: 2, height: 2 }, 10)
    )
    expect(await listMaps(ctx)).toEqual([
      { mapId: 1, name: 'Town', drawable: true },
      { mapId: 2, name: 'Field', drawable: false },
      { mapId: 3, name: 'Crypt', drawable: true },
      { mapId: 7, name: 'Wire Only', drawable: true }
    ])
  })

  it('draws a map from the graph size, with its collision and warps', async () => {
    const result = await mapView(ctx, 1)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.mapName).toBe('Town')
    expect(result.view.sizeSource).toBe('graph')
    expect(result.view.collision).toHaveLength(12)
    expect(result.view.collision[1 * 4 + 1]).toBe(0x0f)
    expect(result.view.warps).toEqual([
      { x: 3, y: 0, toMapId: 2, toMapName: 'Field', source: 'authored', state: 'active' }
    ])
  })

  it('prefers the wire size, and carries a warp hop kind', async () => {
    await mapStore.update((file) =>
      withMapSize(file, 2, { name: 'Field', width: 4, height: 3 }, 10)
    )
    const result = await mapView(ctx, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.sizeSource).toBe('wire')
    expect(requested).toEqual([{ mapId: 2, width: 4, height: 3, doors: 0 }])
    expect(result.view.warps[0]?.via).toBe('prompt')
  })

  it('falls back to a live character standing on the map', async () => {
    positions['c1'] = position(2, 1, 1)
    const result = await mapView(ctx, 2)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.view.sizeSource).toBe('live')
  })

  it('passes the live connection’s door overlay for this map, and not another map’s (WP31)', async () => {
    positions['c1'] = position(1, 1, 1)
    doors['c1'] = { mapId: 1, states: new Map([[doorKey(2, 0, 1), 0]]), asOfMs: 0 }
    await mapView(ctx, 1)
    expect(requested.at(-1)?.doors).toBe(1)
    doors['c1'] = { mapId: 9, states: new Map([[doorKey(2, 0, 1), 0]]), asOfMs: 0 }
    await mapView(ctx, 1)
    expect(requested.at(-1)?.doors).toBe(0)
  })

  it('says why a map cannot be drawn', async () => {
    expect(await mapView(ctx, 2)).toEqual({ ok: false, failure: { kind: 'noSize' } })
    expect(await mapView(ctx, 404)).toEqual({ ok: false, failure: { kind: 'unknownMap' } })
    expect(await mapView(ctx, 'x')).toEqual({ ok: false, failure: { kind: 'unknownMap' } })
    await mapStore.update((file) => withMapSize(file, 9, { name: 'Gone', width: 4, height: 3 }, 10))
    expect(await mapView(ctx, 9)).toEqual({ ok: false, failure: { kind: 'noCache' } })
    ctx.gameFolder = () => undefined
    expect(await mapView(ctx, 1)).toEqual({ ok: false, failure: { kind: 'noFolder' } })
  })

  it('reports where every live character stands', () => {
    positions['c1'] = position(1, 2, 2)
    positions['c2'] = { ...position(2, 0, 0), confidence: 'predicted' }
    expect(mapPositions(ctx)).toEqual([
      { connectionId: 'c1', name: 'Fintan', mapId: 1, x: 2, y: 2, confidence: 'confirmed' },
      { connectionId: 'c2', name: 'Fintan', mapId: 2, x: 0, y: 0, confidence: 'predicted' }
    ])
  })
})

describe('the map size store', () => {
  it('keeps the newest reading and ignores a repeat', () => {
    const first = withMapSize({ maps: {} }, 505, { name: 'Rucesion', width: 50, height: 50 }, 100)
    expect(first.maps['505']).toEqual({ name: 'Rucesion', width: 50, height: 50, seenAtMs: 100 })
    expect(withMapSize(first, 505, { name: 'Rucesion', width: 50, height: 50 }, 200)).toBe(first)
    const older = withMapSize(first, 505, { name: 'Old', width: 1, height: 1 }, 50)
    expect(older).toBe(first)
    const renamed = withMapSize(
      first,
      505,
      { name: 'Rucesion Village', width: 50, height: 50 },
      200
    )
    expect(renamed.maps['505']?.name).toBe('Rucesion Village')
  })
})

describe('the warp edit (WP30)', () => {
  let directory: string
  let transitionStore: TransitionStore
  let live: ReturnType<typeof createLiveGraph>
  let ctx: MapHandlerContext

  /** The graph the app holds, rebuilt from the store the way main does. */
  async function rebuild(): Promise<void> {
    const file = await transitionStore.load()
    live.update(promotedEdges(file), {}, file.curations)
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-maps-'))
    transitionStore = createTransitionStore(directory)
    live = createLiveGraph(NODES)
    ctx = {
      graph: live,
      mapStore: createMapStore(directory),
      transitionStore,
      graphChanged: rebuild,
      gameFolder: () => 'E:/Games/Dark Ages',
      liveConnections: () => [],
      positionFor: () => null,
      doorsFor: () => null,
      maps: { gridFor: async () => grid() }
    }
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const warpsOf = async (mapId: number): Promise<unknown[]> => {
    const result = await mapView(ctx, mapId)
    if (!result.ok) throw new Error(result.failure.kind)
    return result.view.warps.map((w) => ({
      x: w.x,
      y: w.y,
      to: w.toMapId,
      state: w.state,
      source: w.source
    }))
  }

  it('shows a learned candidate the graph does not use yet, and accepts it into the graph', async () => {
    await transitionStore.update((file) =>
      withObservation(file, { fromMapId: 1, x: 2, y: 2, toMapId: 3, atMs: 5 })
    )
    expect(await warpsOf(1)).toEqual([
      { x: 3, y: 0, to: 2, state: 'active', source: 'authored' },
      { x: 2, y: 2, to: 3, state: 'candidate', source: 'learned' }
    ])
    expect(live.planRoute(1, 3)).toBeNull()

    const result = await editWarp(
      ctx,
      { action: 'accept', fromMapId: 1, x: 2, y: 2, toMapId: 3 },
      () => 99
    )
    expect(result.ok && result.view.warps.map((w) => w.state)).toEqual(['active', 'active'])
    expect(live.planRoute(1, 3)?.legs[0]?.warps).toEqual([{ x: 2, y: 2 }])
    expect((await transitionStore.load()).curations['1:2,2>3']).toMatchObject({
      verdict: 'accepted',
      atMs: 99
    })
  })

  it('rejects an authored warp out of the graph, shows it rejected, and restores it', async () => {
    await editWarp(ctx, { action: 'reject', fromMapId: 1, x: 3, y: 0, toMapId: 2 })
    expect(await warpsOf(1)).toEqual([{ x: 3, y: 0, to: 2, state: 'rejected', source: 'authored' }])
    expect(live.planRoute(1, 2)).toBeNull()
    // The imported nodes are untouched.
    expect(NODES[0]!.exits).toEqual([{ toMapId: 2, x: 3, y: 0 }])

    await editWarp(ctx, { action: 'restore', fromMapId: 1, x: 3, y: 0, toMapId: 2 })
    expect(await warpsOf(1)).toEqual([{ x: 3, y: 0, to: 2, state: 'active', source: 'authored' }])
    expect((await transitionStore.load()).curations).toEqual({})
  })

  it('nudges a warp to another tile: the old one rejected, the new one curated', async () => {
    await editWarp(ctx, { action: 'nudge', fromMapId: 1, x: 3, y: 0, toMapId: 2, toX: 3, toY: 1 })
    expect(await warpsOf(1)).toEqual([
      { x: 3, y: 1, to: 2, state: 'active', source: 'curated' },
      { x: 3, y: 0, to: 2, state: 'rejected', source: 'authored' }
    ])
    expect(live.planRoute(1, 2)?.legs[0]?.warps).toEqual([{ x: 3, y: 1 }])
  })

  it('a nudged hop keeps its click', async () => {
    await editWarp(ctx, { action: 'nudge', fromMapId: 2, x: 0, y: 0, toMapId: 1, toX: 1, toY: 0 })
    expect(live.node(2)?.exits).toEqual([
      { toMapId: 1, x: 1, y: 0, via: { kind: 'prompt' }, source: 'curated' }
    ])
  })

  it('refuses an edit that is not one', async () => {
    const result = await editWarp(ctx, { action: 'delete', fromMapId: 1 })
    expect(result).toEqual({ ok: false, failure: { kind: 'unknownMap' } })
    expect((await transitionStore.load()).curations).toEqual({})
  })
})
