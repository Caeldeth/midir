import {
  createRouteGraph,
  mergeLearned,
  type LearnedLayer,
  type PlanOptions,
  type RouteDestination,
  type RouteGraph,
  type RouteNode,
  type RoutePlan
} from './graph'

/**
 * The route graph the app runs on: the imported nodes with the learned layer
 * over them, rebuilt whenever the layer changes (WP29).
 *
 * The walker, the Laborer, the map viewer, and the pane watcher all hold one
 * `RouteGraph` for the life of the process. This one delegates every call to
 * the newest merge, so an edge the wire proved during a session is on the
 * next plan without a restart, and the callers never learn that the graph
 * moved under them: a plan in hand stays what it was, and the next plan
 * reads the new one.
 */
export interface LiveGraph extends RouteGraph {
  /** Rebuild from the imported nodes with this layer over them. */
  update(layer: LearnedLayer): void
}

export function createLiveGraph(base: RouteNode[]): LiveGraph {
  let current: RouteGraph = createRouteGraph(base)
  return {
    node: (mapId: number): RouteNode | null => current.node(mapId),
    nodes: (): RouteNode[] => current.nodes(),
    destinations: (): RouteDestination[] => current.destinations(),
    resolveDestination: (destination: string | number): number | null =>
      current.resolveDestination(destination),
    planRoute: (fromMapId: number, toMapId: number, options?: PlanOptions): RoutePlan | null =>
      current.planRoute(fromMapId, toMapId, options),
    update(layer): void {
      current = createRouteGraph(mergeLearned(base, layer))
    }
  }
}
