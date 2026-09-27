// The world graph view's contract (WP43). Pure types and one channel name; no
// electron or node imports, so main, preload, and the renderer share it.
import type { EdgeSource } from './map'

/** One piece of the graph: the maps that reach each other, smallest id first. */
export interface GraphComponent {
  size: number
  mapIds: number[]
}

/** A warp that leads one way only. */
export interface OneWayEdge {
  fromMapId: number
  toMapId: number
}

/**
 * What the shape of the graph says about itself.
 *
 * Every number here is about more than one map, which is why the Map tab
 * cannot show it: the pieces, the maps nothing can enter, the maps a character
 * cannot leave, and the maps that hang off a warp no walk has crossed.
 */
export interface GraphReport {
  nodes: number
  /** Map-to-map pairs the graph routes over. Several tiles to one map count once. */
  routedPairs: number
  /** Pairs only a candidate proposes, and no routed warp holds (WP24). */
  candidatePairs: number
  /** The pieces over the routed warps, largest first. */
  components: GraphComponent[]
  /** The pieces once the candidates count too, largest first. */
  componentsWithCandidates: GraphComponent[]
  /** Maps with no way in on any layer. Nothing Midir holds can enter them. */
  noWayIn: number[]
  /** Maps with a routed way in and no routed way out. A run that arrives is stranded. */
  noWayOut: number[]
  /** Routed warps with no routed warp back. */
  oneWay: OneWayEdge[]
  /** Maps whose only way in is a candidate. Crossing one is what confirms it. */
  candidateOnly: number[]
}

/** One map, as the graph view draws it. */
export interface GraphViewNode {
  mapId: number
  /** The name the app shows: the graph's, else the wire's, else empty. */
  name: string
  /** True when the stores hold a reading for the map (WP40, WP30). */
  read: boolean
  /** True when the map is on the explorer's hostile list (WP41). */
  hostile: boolean
}

/** One warp, as the graph view draws it: a map-to-map pair, however many tiles it has. */
export interface GraphViewEdge {
  fromMapId: number
  toMapId: number
  /** Where the warp came from. A pair with more than one source shows the strongest. */
  source: EdgeSource
  /** True while no walk has crossed it and nobody has accepted it (WP24). */
  candidate: boolean
  /** How many warp tiles on the from-map lead to the to-map. */
  tiles: number
  /** How many clean walk-warps the wire saw cross it, when any did. */
  observations?: number
}

/** The whole graph, with the report over it. The renderer scopes what it draws. */
export interface WorldGraphView {
  nodes: GraphViewNode[]
  edges: GraphViewEdge[]
  report: GraphReport
  /** Where a live character stands, so the view can open on its own piece. */
  positions: { connectionId: string; name: string; mapId: number }[]
}

/**
 * What the view draws: one piece of the graph, or a radius, or everything.
 *
 * 718 maps and 4000 warps in one picture is a hairball nobody can use, so the
 * default is the piece the picked character stands in.
 */
export type GraphScope = 'component' | 'near' | 'all'

/** How many hops the `near` scope reaches. */
export const NEAR_HOPS_CHOICES = [1, 2, 3, 4, 5] as const
export const DEFAULT_NEAR_HOPS = 2

export function graphScopeLabel(scope: GraphScope): string {
  switch (scope) {
    case 'component':
      return 'This piece of the world'
    case 'near':
      return 'Near one map'
    case 'all':
      return 'Everything'
  }
}

export const GRAPH_VIEW_CHANNEL = 'graph:view'
