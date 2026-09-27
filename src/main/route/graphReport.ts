import type { GraphComponent, GraphReport, OneWayEdge } from '../../shared/graph'
import type { RouteNode } from './graph'

/**
 * What the shape of the route graph says about itself (WP43).
 *
 * The Map tab answers questions about one map. These are the questions a walk
 * fails on, and every one of them is about more than one map: whether a map is
 * joined to the rest of the world, whether a character can get back out of it,
 * and which maps hang off a warp nobody has crossed.
 *
 * Pure over the nodes, so the same numbers come out of the imported files, out
 * of a session's learned layer, and out of a test.
 */

interface Links {
  out: Set<number>
  in: Set<number>
  candidateOut: Set<number>
  candidateIn: Set<number>
}

function links(): Links {
  return { out: new Set(), in: new Set(), candidateOut: new Set(), candidateIn: new Set() }
}

/**
 * The pieces of one undirected view of the graph, largest first.
 *
 * A warp leads one way, but a piece is about what a player can reach on foot
 * over the whole set, so the walk is taken as undirected here. The directions
 * are what `oneWay` and `noWayOut` are for.
 */
function componentsOf(
  ids: readonly number[],
  neighbours: (mapId: number) => Iterable<number>
): GraphComponent[] {
  const seen = new Set<number>()
  const found: GraphComponent[] = []
  for (const id of ids) {
    if (seen.has(id)) continue
    const mapIds: number[] = []
    const stack = [id]
    seen.add(id)
    while (stack.length > 0) {
      const at = stack.pop()!
      mapIds.push(at)
      for (const next of neighbours(at)) {
        if (seen.has(next)) continue
        seen.add(next)
        stack.push(next)
      }
    }
    mapIds.sort((a, b) => a - b)
    found.push({ size: mapIds.length, mapIds })
  }
  // Largest first, then by the smallest map id, so the order is stable.
  return found.sort((a, b) => b.size - a.size || a.mapIds[0]! - b.mapIds[0]!)
}

export function describeGraph(nodes: readonly RouteNode[]): GraphReport {
  const byId = new Map<number, Links>()
  const of = (mapId: number): Links => {
    const held = byId.get(mapId)
    if (held !== undefined) return held
    const fresh = links()
    byId.set(mapId, fresh)
    return fresh
  }

  for (const node of nodes) {
    const from = of(node.mapId)
    for (const exit of node.exits) {
      from.out.add(exit.toMapId)
      of(exit.toMapId).in.add(node.mapId)
    }
    for (const exit of node.candidates ?? []) {
      // A candidate the graph already routes over is not a candidate pair: the
      // same hop can be both an authored warp and an XML one.
      if (from.out.has(exit.toMapId)) continue
      from.candidateOut.add(exit.toMapId)
      of(exit.toMapId).candidateIn.add(node.mapId)
    }
  }

  const ids = [...byId.keys()].sort((a, b) => a - b)
  const routedPairs = ids.reduce((total, id) => total + byId.get(id)!.out.size, 0)
  const candidatePairs = ids.reduce((total, id) => total + byId.get(id)!.candidateOut.size, 0)

  const oneWay: OneWayEdge[] = []
  for (const id of ids) {
    for (const to of byId.get(id)!.out) {
      if (!(byId.get(to)?.out.has(id) ?? false)) oneWay.push({ fromMapId: id, toMapId: to })
    }
  }

  const noWayIn = ids.filter((id) => {
    const held = byId.get(id)!
    return held.in.size === 0 && held.candidateIn.size === 0
  })
  const noWayOut = ids.filter((id) => {
    const held = byId.get(id)!
    return held.out.size === 0 && held.in.size > 0
  })
  const candidateOnly = ids.filter((id) => {
    const held = byId.get(id)!
    return held.in.size === 0 && held.candidateIn.size > 0
  })

  return {
    nodes: ids.length,
    routedPairs,
    candidatePairs,
    components: componentsOf(ids, (id) => {
      const held = byId.get(id)!
      return [...held.out, ...held.in]
    }),
    componentsWithCandidates: componentsOf(ids, (id) => {
      const held = byId.get(id)!
      return [...held.out, ...held.in, ...held.candidateOut, ...held.candidateIn]
    }),
    noWayIn,
    noWayOut,
    oneWay,
    candidateOnly
  }
}
