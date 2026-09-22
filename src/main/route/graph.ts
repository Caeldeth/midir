import worldmapData from './worldmap.json'
import type { EdgeSource } from '../../shared/map'
import { edgeKey, promotedEdges, type TransitionFile } from '../store/transitionStore'

/**
 * The between-maps planner: the graph of how the world connects, and a search
 * over it that turns "take me to Abel" into an ordered list of warps to walk.
 *
 * This is the first of the walker's two levels of planning (WP15 decision 2).
 * It answers only "which maps, in what order, through which warp tile"; the
 * within-map A* (route/pathfind.ts) answers "how to reach that tile". They fail
 * differently, so they stay apart.
 *
 * The graph is data, imported once from DA Walker's WorldMap.dat and versioned
 * as route/worldmap.json (WP15 decision 1). It is not parsed at runtime; see
 * scripts/import-worldmap.mjs for the import. The wire adds to it at run
 * time: `mergeLearned` lays the edges the transition learner proved (WP29),
 * the names and sizes the wire gave (WP30), the hand edits (WP30), and the
 * world XML's provisional edges (WP24) over the imported nodes, and every
 * edge says which source it came from. The imported files are never written.
 */

/**
 * What a warp tile needs beyond a step onto it, when a step is not enough.
 *
 * Most warps fire on the step. Three kinds do not, and WorldMap.dat records
 * the gesture DA Walker performs for each (scripts/import-worldmap.mjs):
 *
 * - `fieldMap`: the tile opens the world map (SFieldMap 0x2E), and a click on
 *   one of its points picks the destination. `screenX`/`screenY` is the point
 *   DA Walker clicked, on the 640 x 480 pane. The walker prefers the position
 *   the wire gives for the point whose map id matches, and uses this when the
 *   wire has no such point.
 * - `prompt`: the tile opens a yes/no prompt, and Space accepts it.
 * - `dialog`: the tile needs an NPC conversation (a ship, a caravan). That is
 *   an errand, not a walk, so the planner never routes through it.
 */
export type RouteHop =
  { kind: 'fieldMap'; screenX: number; screenY: number } | { kind: 'prompt' } | { kind: 'dialog' }

/** One warp tile on a map, and where it leads. */
export interface RouteExit {
  toMapId: number
  x: number
  y: number
  /** Absent for a warp that fires on the step. */
  via?: RouteHop
  /**
   * Where the edge came from. Absent means `authored`: the imported file.
   * A learned edge is one the wire proved and the file lacks (WP29).
   */
  source?: EdgeSource
  /** How many clean walk-warps the wire saw cross this edge, when any did. */
  observations?: number
}

/** One map in the graph, and the warp tiles that leave it. */
export interface RouteNode {
  mapId: number
  /** The map name, or an empty string when WorldMap.dat had none. */
  name: string
  /**
   * The game's own name for the map, from `SMapSize 0x15`, when the wire has
   * given one (WP29). It differs from the .dat's for many maps ("Abel Port
   * Way" against "Abel Outskirts"); the errands and the pins use `name`.
   */
  gameName?: string
  /** The map size from WorldMap.dat's header, when it had one (47 maps do). */
  width?: number
  height?: number
  /** Where this map warps to, and the tile that does it. */
  exits: RouteExit[]
  /**
   * Warps the graph knows of but does not plan on: a learned edge the wire
   * has not seen often enough, or a world XML edge nothing has confirmed.
   * The Map tab shows them so the user can accept one (WP30).
   */
  candidates?: RouteExit[]
}

/** A warp tile of one leg: where it is, and what it needs beyond the step. */
export interface RouteWarp {
  x: number
  y: number
  via?: RouteHop
}

/** One step of a route: cross from one map to the next through a warp tile. */
export interface RouteLeg {
  fromMapId: number
  toMapId: number
  /**
   * Every warp tile on `fromMapId` that reaches `toMapId`. The walker picks the
   * nearest one it can actually path to, because a map often has more than one
   * door to the same place.
   */
  warps: RouteWarp[]
}

/** A full route between two maps. `legs` is empty when the goal is this map. */
export interface RoutePlan {
  fromMapId: number
  toMapId: number
  legs: RouteLeg[]
}

/** A place the walker can be asked to go: a named map. */
export interface RouteDestination {
  mapId: number
  /** The .dat's name, or empty when only the wire has named the map. */
  name: string
  /** The game's own name, when the wire has given one. */
  gameName?: string
}

export interface RouteGraph {
  /** The node for a map id, or null when the graph does not know it. */
  node(mapId: number): RouteNode | null
  /** Every named map, sorted by name, for the destination picker. Either name counts. */
  destinations(): RouteDestination[]
  /** Every node, named or not, sorted by map id. The map viewer lists them (WP30). */
  nodes(): RouteNode[]
  /**
   * Resolve a destination given as a name or a map id to a map id in the graph,
   * or null when nothing matches. A name match is case-insensitive and reads
   * both names: an exact name first, then the only node whose name contains
   * the text.
   */
  resolveDestination(destination: string | number): number | null
  /**
   * Plan a route from one map to another, or null when none exists.
   *
   * The search is a breadth-first walk over the map graph, so the plan crosses
   * the fewest maps. A same-map request returns a plan with no legs. An exit
   * that needs an NPC dialog (`via.kind === 'dialog'`) is not a walk, so the
   * search never uses it.
   */
  planRoute(fromMapId: number, toMapId: number, options?: PlanOptions): RoutePlan | null
}

/** What a plan may leave out. */
export interface PlanOptions {
  /**
   * Whether the walk may enter a map. A map this returns false for is never
   * crossed and never arrived at; the start map is not asked. The walker
   * passes the gated maps its character cannot enter (WP32).
   */
  passable?: (mapId: number) => boolean
}

/** True for an exit the walker can take: a step, a world-map click, or a prompt. */
function walkable(exit: RouteExit): boolean {
  return exit.via?.kind !== 'dialog'
}

export function createRouteGraph(nodes: RouteNode[]): RouteGraph {
  const byId = new Map<number, RouteNode>(nodes.map((n) => [n.mapId, n]))

  function node(mapId: number): RouteNode | null {
    return byId.get(mapId) ?? null
  }

  function destinations(): RouteDestination[] {
    return nodes
      .filter((n) => n.name !== '' || n.gameName !== undefined)
      .map((n) => ({
        mapId: n.mapId,
        name: n.name,
        ...(n.gameName !== undefined ? { gameName: n.gameName } : {})
      }))
      .sort((a, b) => (a.gameName ?? a.name).localeCompare(b.gameName ?? b.name))
  }

  /** The names a node answers to, lower-cased. */
  const namesOf = (n: RouteNode): string[] =>
    [n.name, n.gameName ?? ''].filter((name) => name !== '').map((name) => name.toLowerCase())

  function resolveDestination(destination: string | number): number | null {
    if (typeof destination === 'number') {
      return byId.has(destination) ? destination : null
    }
    const text = destination.trim().toLowerCase()
    if (text === '') return null
    // A bare number in a string is a map id.
    if (/^\d+$/.test(text)) {
      const id = Number(text)
      return byId.has(id) ? id : null
    }
    // An exact name wins over a partial one.
    const exact = nodes.find((n) => namesOf(n).includes(text))
    if (exact !== undefined) return exact.mapId
    const partial = nodes.filter((n) => namesOf(n).some((name) => name.includes(text)))
    return partial.length === 1 ? partial[0].mapId : null
  }

  function planRoute(fromMapId: number, toMapId: number, options?: PlanOptions): RoutePlan | null {
    if (!byId.has(fromMapId) || !byId.has(toMapId)) return null
    if (fromMapId === toMapId) return { fromMapId, toMapId, legs: [] }
    const passable = options?.passable ?? ((): boolean => true)

    // Breadth-first search, keeping each map's predecessor so the path can be
    // walked back once the goal is reached.
    const predecessor = new Map<number, number>()
    const queue: number[] = [fromMapId]
    const visited = new Set<number>([fromMapId])
    let found = false
    while (queue.length > 0 && !found) {
      const current = queue.shift()!
      for (const exit of byId.get(current)!.exits) {
        if (!walkable(exit)) continue
        if (visited.has(exit.toMapId) || !byId.has(exit.toMapId)) continue
        if (!passable(exit.toMapId)) continue
        visited.add(exit.toMapId)
        predecessor.set(exit.toMapId, current)
        if (exit.toMapId === toMapId) {
          found = true
          break
        }
        queue.push(exit.toMapId)
      }
    }
    if (!found) return null

    // Walk the predecessor chain back to the start, then reverse it.
    const path: number[] = [toMapId]
    for (let map = toMapId; map !== fromMapId;) {
      const prev = predecessor.get(map)!
      path.push(prev)
      map = prev
    }
    path.reverse()

    const legs: RouteLeg[] = []
    for (let i = 0; i < path.length - 1; i++) {
      const from = path[i]
      const to = path[i + 1]
      const warps = byId
        .get(from)!
        .exits.filter((e) => e.toMapId === to && walkable(e))
        .map((e) => ({ x: e.x, y: e.y, ...(e.via !== undefined ? { via: e.via } : {}) }))
      legs.push({ fromMapId: from, toMapId: to, warps })
    }
    return { fromMapId, toMapId, legs }
  }

  const sortedNodes = [...nodes].sort((a, b) => a.mapId - b.mapId)

  return { node, nodes: () => sortedNodes, destinations, resolveDestination, planRoute }
}

/** The imported nodes, as WorldMap.dat and the overrides give them. */
export const worldNodes: RouteNode[] = worldmapData.nodes as RouteNode[]

/** The world graph, built from the imported WorldMap.dat alone. */
export const worldGraph: RouteGraph = createRouteGraph(worldNodes)

/** What the wire has said about a map: its name and size from `SMapSize 0x15`. */
export interface WireMap {
  name: string
  width: number
  height: number
}

/** One map of the world XML (`route/xmlworld.json`), the provisional layer (WP24). */
export interface XmlNode {
  mapId: number
  name: string
  width: number
  height: number
  exits: { toMapId: number; x: number; y: number; arrivalX?: number; arrivalY?: number }[]
}

/** Crossings that confirm a world XML edge: the XML and the wire agreeing once is enough. */
export const XML_PROMOTION_OBSERVATIONS = 1

/** Everything laid over the imported nodes. */
export interface LearnedLayer {
  /** The learned edges and the hand edits, as `transitions.json` holds them. */
  transitions: TransitionFile
  /** The wire's names and sizes, as `maps.json` holds them. */
  wire?: Record<string, WireMap>
  /** The world XML, when it is in. */
  xml?: XmlNode[]
}

const sameTile = (
  a: { toMapId: number; x: number; y: number },
  b: { toMapId: number; x: number; y: number }
): boolean => a.toMapId === b.toMapId && a.x === b.x && a.y === b.y

/**
 * Lay the learned layer over the imported nodes (WP29, WP30, WP24).
 *
 * In order: a rejected edge leaves, whoever put it there. A learned edge the
 * file already holds confirms it, and one the file lacks is added with
 * `source: 'learned'` once promoted (two crossings, or an acceptance); below
 * that it is a candidate. A world XML edge is a candidate until the wire
 * crosses it once or the user accepts it, and then an exit with
 * `source: 'xml'`. An accepted edge no source holds is `curated`. A map no
 * source in the file knows is added as a node, named by the wire first and
 * the XML second, and sized by whichever has a size. The imported nodes are
 * never changed; the result is a new list.
 */
export function mergeLearned(nodes: RouteNode[], layer: LearnedLayer): RouteNode[] {
  const { transitions } = layer
  const wire = layer.wire ?? {}
  const curations = transitions.curations
  const verdictOf = (mapId: number, exit: { toMapId: number; x: number; y: number }) =>
    curations[edgeKey({ fromMapId: mapId, ...exit })]?.verdict
  const rejected = (mapId: number, exit: { toMapId: number; x: number; y: number }): boolean =>
    verdictOf(mapId, exit) === 'rejected'

  const byId = new Map<number, RouteNode>()
  for (const node of nodes) {
    byId.set(node.mapId, {
      ...node,
      exits: node.exits.filter((e) => !rejected(node.mapId, e)).map((e) => ({ ...e }))
    })
  }
  const ensure = (mapId: number): RouteNode => {
    const existing = byId.get(mapId)
    if (existing !== undefined) return existing
    const added: RouteNode = { mapId, name: '', exits: [] }
    byId.set(mapId, added)
    return added
  }
  const candidate = (node: RouteNode, exit: RouteExit): void => {
    if (node.exits.some((e) => sameTile(e, exit))) return
    node.candidates = node.candidates ?? []
    if (node.candidates.some((e) => sameTile(e, exit))) return
    node.candidates.push(exit)
  }

  // The wire's edges: promoted ones as exits, the rest as candidates.
  const promoted = new Set(promotedEdges(transitions).map(edgeKey))
  for (const edge of Object.values(transitions.edges)) {
    if (rejected(edge.fromMapId, edge)) continue
    const node = ensure(edge.fromMapId)
    ensure(edge.toMapId)
    const exit: RouteExit = {
      toMapId: edge.toMapId,
      x: edge.x,
      y: edge.y,
      ...(edge.via !== undefined ? { via: edge.via } : {}),
      source: 'learned',
      observations: edge.observations
    }
    const known = node.exits.find((e) => sameTile(e, edge))
    if (known !== undefined) {
      known.observations = edge.observations
      continue
    }
    if (promoted.has(edgeKey(edge))) node.exits.push(exit)
    else candidate(node, exit)
  }

  // The world XML: confirmed by one crossing or an acceptance, else a candidate.
  for (const xmlNode of layer.xml ?? []) {
    const node = ensure(xmlNode.mapId)
    if (node.name === '' && node.gameName === undefined && xmlNode.name !== '') {
      node.gameName = xmlNode.name
    }
    if (node.width === undefined) {
      node.width = xmlNode.width
      node.height = xmlNode.height
    }
    for (const exit of xmlNode.exits) {
      if (rejected(xmlNode.mapId, exit)) continue
      ensure(exit.toMapId)
      if (node.exits.some((e) => sameTile(e, exit))) continue
      const seen = transitions.edges[edgeKey({ fromMapId: xmlNode.mapId, ...exit })]
      const confirmed =
        (seen?.observations ?? 0) >= XML_PROMOTION_OBSERVATIONS ||
        verdictOf(xmlNode.mapId, exit) === 'accepted'
      const placed: RouteExit = {
        toMapId: exit.toMapId,
        x: exit.x,
        y: exit.y,
        source: 'xml',
        ...(seen !== undefined ? { observations: seen.observations } : {})
      }
      if (confirmed) {
        node.exits.push(placed)
        node.candidates = node.candidates?.filter((e) => !sameTile(e, exit))
      } else candidate(node, placed)
    }
  }

  // The hand edits: an accepted edge no source holds is placed by hand.
  for (const curation of Object.values(curations)) {
    if (curation.verdict !== 'accepted') continue
    const node = ensure(curation.fromMapId)
    ensure(curation.toMapId)
    if (node.exits.some((e) => sameTile(e, curation))) continue
    node.exits.push({
      toMapId: curation.toMapId,
      x: curation.x,
      y: curation.y,
      ...(curation.via !== undefined ? { via: curation.via } : {}),
      source: 'curated'
    })
  }

  // The wire's word on names and sizes wins over the XML's.
  for (const [key, size] of Object.entries(wire)) {
    const mapId = Number(key)
    if (!Number.isInteger(mapId)) continue
    const node = byId.get(mapId)
    if (node === undefined) continue
    if (size.name !== '') node.gameName = size.name
    if (node.width === undefined || byId.get(mapId)?.width === undefined) {
      node.width = size.width
      node.height = size.height
    }
  }
  for (const node of byId.values()) {
    if (node.candidates !== undefined && node.candidates.length === 0) delete node.candidates
  }

  return [...byId.values()]
}
