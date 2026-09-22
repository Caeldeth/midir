import type { IpcMain } from 'electron'
import { z } from 'zod'
import type { LiveConnection } from '../actionLayer'
import type { Position } from '../model/position'
import type { DoorState } from '../model/doors'
import type { RouteExit, RouteGraph, RouteNode } from '../route/graph'
import type { MapProvider } from '../route/mapSource'
import type { MapStore } from '../store/mapStore'
import {
  edgeKey,
  withCuration,
  type Curation,
  type TransitionStore
} from '../store/transitionStore'
import {
  MAP_EDIT_WARP_CHANNEL,
  MAP_LIST_CHANNEL,
  MAP_POSITIONS_CHANNEL,
  MAP_VIEW_CHANNEL,
  type MapPosition,
  type MapSummary,
  type MapView,
  type MapViewResult,
  type MapWarp,
  type WarpEdit
} from '../../shared/map'

/**
 * The map viewer's handlers (WP30).
 *
 * A view is the walker's own grid: the map cache and SOTP through
 * `MapProvider`, with the door overlay (WP31) of whichever connection stands
 * on the map, so the viewer draws what the walker plans on. The size comes from
 * the wire's `maps.json` first, then the imported graph, then a live position
 * on the map; a map with no size cannot be read, because the cache has no
 * header. The warps are the graph's exits for the map, plus what the learned
 * layer holds for it and the graph does not use: a candidate the wire has not
 * seen often enough, and a warp the user rejected (WP30).
 *
 * An edit writes a curation to the transition store, never to the imported
 * file or a client file, and rebuilds the graph before it answers with the
 * map as it now stands.
 */
export interface MapHandlerContext {
  graph: RouteGraph
  maps: MapProvider
  mapStore: MapStore
  transitionStore: TransitionStore
  /** Rebuild the live graph from the stores. Awaited after an edit. */
  graphChanged: () => Promise<void>
  gameFolder: () => string | undefined
  liveConnections: () => LiveConnection[]
  positionFor: (connectionId: string) => Position | null
  doorsFor: (connectionId: string) => DoorState | null
}

export async function listMaps(ctx: MapHandlerContext): Promise<MapSummary[]> {
  const learned = (await ctx.mapStore.load()).maps
  const byId = new Map<number, MapSummary>()
  for (const node of ctx.graph.nodes()) {
    const size = learned[String(node.mapId)]
    byId.set(node.mapId, {
      mapId: node.mapId,
      name: node.name !== '' ? node.name : (size?.name ?? ''),
      drawable: size !== undefined || node.width !== undefined
    })
  }
  for (const [key, size] of Object.entries(learned)) {
    const mapId = Number(key)
    if (!byId.has(mapId)) byId.set(mapId, { mapId, name: size.name, drawable: true })
  }
  return [...byId.values()].sort((a, b) => a.mapId - b.mapId)
}

/** The live position of a character on `mapId`, if one stands there. */
function liveOn(
  ctx: MapHandlerContext,
  mapId: number
): { connectionId: string; position: Position } | null {
  for (const live of ctx.liveConnections()) {
    const position = ctx.positionFor(live.connectionId)
    if (position !== null && position.mapId === mapId) {
      return { connectionId: live.connectionId, position }
    }
  }
  return null
}

export async function mapView(ctx: MapHandlerContext, mapId: unknown): Promise<MapViewResult> {
  if (typeof mapId !== 'number' || !Number.isInteger(mapId) || mapId < 0) {
    return { ok: false, failure: { kind: 'unknownMap' } }
  }
  if (ctx.gameFolder() === undefined) return { ok: false, failure: { kind: 'noFolder' } }

  const node = ctx.graph.node(mapId)
  const learned = (await ctx.mapStore.load()).maps[String(mapId)]
  const live = liveOn(ctx, mapId)

  let size: { width: number; height: number; source: MapView['sizeSource'] } | null = null
  if (learned !== undefined) size = { width: learned.width, height: learned.height, source: 'wire' }
  else if (node?.width !== undefined && node.height !== undefined) {
    size = { width: node.width, height: node.height, source: 'graph' }
  } else if (live?.position.mapWidth !== undefined && live.position.mapHeight !== undefined) {
    size = { width: live.position.mapWidth, height: live.position.mapHeight, source: 'live' }
  }
  if (size === null) {
    return {
      ok: false,
      failure: { kind: node === null && learned === undefined ? 'unknownMap' : 'noSize' }
    }
  }

  const doors = live === null ? null : ctx.doorsFor(live.connectionId)
  const overlay = doors !== null && doors.mapId === mapId ? doors.states : undefined
  const grid = await ctx.maps.gridFor(mapId, size.width, size.height, overlay)
  if (grid === null) return { ok: false, failure: { kind: 'noCache' } }
  const layer = await ctx.transitionStore.load()

  // The game's own name first, then the .dat's, then the wire's reading.
  const nameOf = (id: number): string => {
    const known = ctx.graph.node(id)
    return known?.gameName ?? (known?.name !== undefined && known.name !== '' ? known.name : '')
  }
  const mapName = nameOf(mapId)
  return {
    ok: true,
    view: {
      mapId,
      mapName: mapName !== '' ? mapName : (learned?.name ?? ''),
      width: grid.width,
      height: grid.height,
      collision: Array.from(grid.collision),
      warps: warpsOf(mapId, node, layer, nameOf),
      sizeSource: size.source
    }
  }
}

/**
 * The map's warps: the graph's exits, its candidates (a learned edge the
 * wire has not seen twice, a world XML edge nothing has confirmed), and the
 * rejected ones from the hand edits, each keyed apart.
 */
function warpsOf(
  mapId: number,
  node: RouteNode | null,
  layer: Awaited<ReturnType<TransitionStore['load']>>,
  nameOf: (id: number) => string
): MapWarp[] {
  const toWarp = (exit: RouteExit, state: MapWarp['state']): MapWarp => ({
    x: exit.x,
    y: exit.y,
    toMapId: exit.toMapId,
    toMapName: nameOf(exit.toMapId),
    ...(exit.via !== undefined ? { via: exit.via.kind } : {}),
    source: exit.source ?? 'authored',
    ...(exit.observations !== undefined ? { observations: exit.observations } : {}),
    state
  })
  const warps: MapWarp[] = [
    ...(node?.exits ?? []).map((exit) => toWarp(exit, 'active')),
    ...(node?.candidates ?? []).map((exit) => toWarp(exit, 'candidate'))
  ]
  const shown = new Set(warps.map((w) => edgeKey({ fromMapId: mapId, ...w })))
  for (const curation of Object.values(layer.curations)) {
    if (curation.fromMapId !== mapId || curation.verdict !== 'rejected') continue
    const key = edgeKey(curation)
    if (shown.has(key)) continue
    const learned = layer.edges[key]
    warps.push({
      x: curation.x,
      y: curation.y,
      toMapId: curation.toMapId,
      toMapName: nameOf(curation.toMapId),
      ...(curation.via !== undefined ? { via: curation.via.kind } : {}),
      source: learned !== undefined ? 'learned' : 'authored',
      ...(learned !== undefined ? { observations: learned.observations } : {}),
      state: 'rejected'
    })
  }
  return warps
}

const tile = z.number().int().min(0).max(255)
const mapId = z.number().int().nonnegative()
const editSchema = z.union([
  z.object({
    action: z.enum(['accept', 'reject', 'restore']),
    fromMapId: mapId,
    x: tile,
    y: tile,
    toMapId: mapId
  }),
  z.object({
    action: z.literal('place'),
    fromMapId: mapId,
    x: tile,
    y: tile,
    toMapId: mapId,
    replace: z.object({ x: tile, y: tile, toMapId: mapId }).optional()
  })
])

/**
 * Apply one hand edit to a warp (WP30 decision 4) and answer with the map as
 * it now stands. The edit goes to the learned layer; the imported file and
 * the client's files are never written.
 */
export async function editWarp(
  ctx: MapHandlerContext,
  edit: unknown,
  now: () => number = Date.now
): Promise<MapViewResult> {
  const parsed = editSchema.safeParse(edit)
  if (!parsed.success) return { ok: false, failure: { kind: 'unknownMap' } }
  const request: WarpEdit = parsed.data
  // A hop keeps its gesture when it moves: the graph's exit or the learned
  // edge of the warp being edited or replaced has it.
  const subject =
    request.action === 'place' && request.replace !== undefined
      ? { fromMapId: request.fromMapId, ...request.replace }
      : request
  const exit = ctx.graph
    .node(subject.fromMapId)
    ?.exits.find((e) => e.toMapId === subject.toMapId && e.x === subject.x && e.y === subject.y)
  const learned = (await ctx.transitionStore.load()).edges[edgeKey(subject)]
  const via: Curation['via'] | undefined = exit?.via ?? learned?.via
  await ctx.transitionStore.update((file) => withCuration(file, request, now(), via))
  await ctx.graphChanged()
  return mapView(ctx, request.fromMapId)
}

export function mapPositions(ctx: MapHandlerContext): MapPosition[] {
  const out: MapPosition[] = []
  for (const live of ctx.liveConnections()) {
    const position = ctx.positionFor(live.connectionId)
    if (position === null) continue
    out.push({
      connectionId: live.connectionId,
      name: live.name,
      mapId: position.mapId,
      x: position.x,
      y: position.y,
      confidence: position.confidence
    })
  }
  return out
}

export function registerMapHandlers(ipcMain: IpcMain, ctx: MapHandlerContext): void {
  ipcMain.handle(MAP_LIST_CHANNEL, () => listMaps(ctx))
  ipcMain.handle(MAP_VIEW_CHANNEL, (_, mapId) => mapView(ctx, mapId))
  ipcMain.handle(MAP_POSITIONS_CHANNEL, () => mapPositions(ctx))
  ipcMain.handle(MAP_EDIT_WARP_CHANNEL, (_, edit) => editWarp(ctx, edit))
}
