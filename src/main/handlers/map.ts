import type { IpcMain } from 'electron'
import type { LiveConnection } from '../actionLayer'
import type { Position } from '../model/position'
import type { DoorState } from '../model/doors'
import type { RouteGraph } from '../route/graph'
import type { MapProvider } from '../route/mapSource'
import type { MapStore } from '../store/mapStore'
import {
  MAP_LIST_CHANNEL,
  MAP_POSITIONS_CHANNEL,
  MAP_VIEW_CHANNEL,
  type MapPosition,
  type MapSummary,
  type MapView,
  type MapViewResult
} from '../../shared/map'

/**
 * The map viewer's handlers (WP30).
 *
 * A view is the walker's own grid: the map cache and SOTP through
 * `MapProvider`, with the door overlay (WP31) of whichever connection stands
 * on the map, so the viewer draws what the walker plans on. The size comes from
 * the wire's `maps.json` first, then the imported graph, then a live position
 * on the map; a map with no size cannot be read, because the cache has no
 * header. The warps are the graph's exits for the map.
 */
export interface MapHandlerContext {
  graph: RouteGraph
  maps: MapProvider
  mapStore: MapStore
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

  const nameOf = (id: number): string => ctx.graph.node(id)?.name ?? ''
  return {
    ok: true,
    view: {
      mapId,
      mapName: node?.name !== undefined && node.name !== '' ? node.name : (learned?.name ?? ''),
      width: grid.width,
      height: grid.height,
      collision: Array.from(grid.collision),
      warps: (node?.exits ?? []).map((exit) => ({
        x: exit.x,
        y: exit.y,
        toMapId: exit.toMapId,
        toMapName: nameOf(exit.toMapId),
        ...(exit.via !== undefined ? { via: exit.via.kind } : {})
      })),
      sizeSource: size.source
    }
  }
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
}
