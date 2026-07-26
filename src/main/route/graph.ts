import worldmapData from './worldmap.json'

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
 * scripts/import-worldmap.mjs for the import.
 */

/** One map in the graph, and the warp tiles that leave it. */
export interface RouteNode {
  mapId: number
  /** The map name, or an empty string when WorldMap.dat had none. */
  name: string
  /** Where this map warps to, and the tile that does it. */
  exits: { toMapId: number; x: number; y: number }[]
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
  warps: { x: number; y: number }[]
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
  name: string
}

export interface RouteGraph {
  /** The node for a map id, or null when the graph does not know it. */
  node(mapId: number): RouteNode | null
  /** Every named map, sorted by name, for the destination picker. */
  destinations(): RouteDestination[]
  /**
   * Resolve a destination given as a name or a map id to a map id in the graph,
   * or null when nothing matches. A name match is case-insensitive: an exact
   * name first, then the only node whose name contains the text.
   */
  resolveDestination(destination: string | number): number | null
  /**
   * Plan a route from one map to another, or null when none exists.
   *
   * The search is a breadth-first walk over the map graph, so the plan crosses
   * the fewest maps. A same-map request returns a plan with no legs.
   */
  planRoute(fromMapId: number, toMapId: number): RoutePlan | null
}

export function createRouteGraph(nodes: RouteNode[]): RouteGraph {
  const byId = new Map<number, RouteNode>(nodes.map((n) => [n.mapId, n]))

  function node(mapId: number): RouteNode | null {
    return byId.get(mapId) ?? null
  }

  function destinations(): RouteDestination[] {
    return nodes
      .filter((n) => n.name !== '')
      .map((n) => ({ mapId: n.mapId, name: n.name }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

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
    const exact = nodes.find((n) => n.name.toLowerCase() === text)
    if (exact !== undefined) return exact.mapId
    const partial = nodes.filter((n) => n.name !== '' && n.name.toLowerCase().includes(text))
    return partial.length === 1 ? partial[0].mapId : null
  }

  function planRoute(fromMapId: number, toMapId: number): RoutePlan | null {
    if (!byId.has(fromMapId) || !byId.has(toMapId)) return null
    if (fromMapId === toMapId) return { fromMapId, toMapId, legs: [] }

    // Breadth-first search, keeping each map's predecessor so the path can be
    // walked back once the goal is reached.
    const predecessor = new Map<number, number>()
    const queue: number[] = [fromMapId]
    const visited = new Set<number>([fromMapId])
    let found = false
    while (queue.length > 0 && !found) {
      const current = queue.shift()!
      for (const exit of byId.get(current)!.exits) {
        if (visited.has(exit.toMapId) || !byId.has(exit.toMapId)) continue
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
        .exits.filter((e) => e.toMapId === to)
        .map((e) => ({ x: e.x, y: e.y }))
      legs.push({ fromMapId: from, toMapId: to, warps })
    }
    return { fromMapId, toMapId, legs }
  }

  return { node, destinations, resolveDestination, planRoute }
}

/** The world graph, built from the imported WorldMap.dat. */
export const worldGraph: RouteGraph = createRouteGraph(worldmapData.nodes as RouteNode[])
