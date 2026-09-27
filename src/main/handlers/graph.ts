import type { IpcMain } from 'electron'
import type { LiveConnection } from '../actionLayer'
import type { Position } from '../model/position'
import type { RouteExit, RouteGraph } from '../route/graph'
import { describeGraph } from '../route/graphReport'
import { hostileMaps } from '../route/hostile'
import type { MapStore } from '../store/mapStore'
import {
  GRAPH_VIEW_CHANNEL,
  type GraphViewEdge,
  type GraphViewNode,
  type WorldGraphView
} from '../../shared/graph'
import type { EdgeSource } from '../../shared/map'

/**
 * The world graph view's handler (WP43).
 *
 * One read of the live graph: every map, every warp as a map-to-map pair, and
 * the report over the whole thing. The renderer scopes what it draws, so a
 * change of scope costs nothing and needs no round trip.
 *
 * It holds no state and writes nothing. An edit from this view goes through
 * `map:editWarp`, which is the one write path for a warp (WP30).
 */
export interface GraphHandlerContext {
  graph: RouteGraph
  mapStore: MapStore
  liveConnections: () => LiveConnection[]
  positionFor: (connectionId: string) => Position | null
}

/**
 * Which source a pair shows when its tiles disagree.
 *
 * A pair is often several tiles, and two of them can come from different
 * layers: the imported file for one door and the wire for another. The view
 * shows the strongest, because the pair is as confirmed as its best tile.
 */
const SOURCE_RANK: Record<EdgeSource, number> = { curated: 0, learned: 1, authored: 2, xml: 3 }

function strongest(left: EdgeSource, right: EdgeSource): EdgeSource {
  return SOURCE_RANK[left] <= SOURCE_RANK[right] ? left : right
}

function sourceOf(exit: RouteExit): EdgeSource {
  return exit.source ?? 'authored'
}

/** Collapse a node's tiles into one row for each destination. */
function pairsOf(
  fromMapId: number,
  exits: readonly RouteExit[],
  candidate: boolean,
  into: Map<string, GraphViewEdge>
): void {
  for (const exit of exits) {
    const key = `${fromMapId}:${exit.toMapId}`
    const held = into.get(key)
    const source = sourceOf(exit)
    if (held === undefined) {
      into.set(key, {
        fromMapId,
        toMapId: exit.toMapId,
        source,
        candidate,
        tiles: 1,
        ...(exit.observations !== undefined ? { observations: exit.observations } : {})
      })
      continue
    }
    // A routed tile outranks a candidate one: the pair is routed.
    held.candidate = held.candidate && candidate
    held.source = strongest(held.source, source)
    held.tiles += 1
    if (exit.observations !== undefined) {
      held.observations = Math.max(held.observations ?? 0, exit.observations)
    }
  }
}

export async function graphView(ctx: GraphHandlerContext): Promise<WorldGraphView> {
  const nodes = ctx.graph.nodes()
  const read = (await ctx.mapStore.load()).maps
  const hostile = hostileMaps(nodes)

  const viewNodes: GraphViewNode[] = []
  const edges = new Map<string, GraphViewEdge>()
  const named = new Set<number>()

  for (const node of nodes) {
    const wire = read[String(node.mapId)]
    viewNodes.push({
      mapId: node.mapId,
      name: node.name !== '' ? node.name : (node.gameName ?? wire?.name ?? ''),
      read: wire !== undefined,
      hostile: hostile.has(node.mapId)
    })
    named.add(node.mapId)
    pairsOf(node.mapId, node.exits, false, edges)
    pairsOf(node.mapId, node.candidates ?? [], true, edges)
  }

  // A map only other maps mention still belongs in the picture: an exit leads
  // there, so the view must be able to draw the other end of that warp.
  for (const edge of edges.values()) {
    if (named.has(edge.toMapId)) continue
    named.add(edge.toMapId)
    const wire = read[String(edge.toMapId)]
    viewNodes.push({
      mapId: edge.toMapId,
      name: wire?.name ?? '',
      read: wire !== undefined,
      hostile: hostile.has(edge.toMapId)
    })
  }

  const positions: WorldGraphView['positions'] = []
  for (const live of ctx.liveConnections()) {
    const position = ctx.positionFor(live.connectionId)
    if (position === null) continue
    positions.push({ connectionId: live.connectionId, name: live.name, mapId: position.mapId })
  }

  return {
    nodes: viewNodes.sort((a, b) => a.mapId - b.mapId),
    edges: [...edges.values()],
    report: describeGraph(nodes),
    positions
  }
}

export function registerGraphHandlers(ipcMain: IpcMain, ctx: GraphHandlerContext): void {
  ipcMain.handle(GRAPH_VIEW_CHANNEL, () => graphView(ctx))
}
