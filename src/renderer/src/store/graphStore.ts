import {
  DEFAULT_NEAR_HOPS,
  type GraphScope,
  type GraphViewEdge,
  type WorldGraphView
} from '@shared/graph'
import { create } from 'zustand'

/**
 * The world graph, as the World tab draws it (WP43).
 *
 * Main sends the whole graph once — every map, every warp as a pair, and the
 * report over it — and the scope is applied here. A change of scope is then a
 * recomputation and not a round trip, which is what makes the picker usable.
 */

interface GraphState {
  view: WorldGraphView | null
  loading: boolean
  error: string | null
  scope: GraphScope
  /** How far the `near` scope reaches. */
  nearHops: number
  /** The map the picture centres on. Null follows the live character. */
  focus: number | null
  /** The map the side panel describes. */
  selected: number | null
  refresh: () => Promise<void>
  setScope: (scope: GraphScope) => void
  setNearHops: (hops: number) => void
  setFocus: (mapId: number | null) => void
  select: (mapId: number | null) => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export const useGraphStore = create<GraphState>((set) => ({
  view: null,
  loading: false,
  error: null,
  scope: 'component',
  nearHops: DEFAULT_NEAR_HOPS,
  focus: null,
  selected: null,

  refresh: async () => {
    set({ loading: true })
    try {
      set({ view: await window.api.graph.view(), error: null })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ loading: false })
    }
  },

  setScope: (scope) => set({ scope }),
  setNearHops: (nearHops) => set({ nearHops }),
  setFocus: (focus) => set({ focus }),
  select: (selected) => set({ selected })
}))

/** Every map each map touches, whichever way the warp leads and whatever its state. */
export function neighboursOf(edges: readonly GraphViewEdge[]): Map<number, number[]> {
  const map = new Map<number, number[]>()
  const add = (from: number, to: number): void => {
    const held = map.get(from)
    if (held === undefined) map.set(from, [to])
    else if (!held.includes(to)) held.push(to)
  }
  for (const edge of edges) {
    add(edge.fromMapId, edge.toMapId)
    add(edge.toMapId, edge.fromMapId)
  }
  return map
}

/**
 * The maps the picture holds, for one scope.
 *
 * `component` is the piece the middle map belongs to, however far it reaches.
 * `near` is a radius in warps, which is the scope for reading one town. `all`
 * is every map, pieces and singletons alike.
 */
export function scopedMaps(
  scope: GraphScope,
  every: readonly number[],
  neighbours: ReadonlyMap<number, readonly number[]>,
  root: number | null,
  nearHops: number
): number[] {
  if (scope === 'all' || root === null) return [...every]
  const depth = new Map<number, number>([[root, 0]])
  const queue = [root]
  const limit = scope === 'near' ? nearHops : Number.POSITIVE_INFINITY
  for (let at = 0; at < queue.length; at++) {
    const here = queue[at]!
    const next = depth.get(here)! + 1
    if (next > limit) continue
    for (const other of neighbours.get(here) ?? []) {
      if (depth.has(other)) continue
      depth.set(other, next)
      queue.push(other)
    }
  }
  return queue
}

/**
 * The map the picture centres on: the user's pick, else where a character
 * stands, else the first map of the largest piece.
 */
export function rootOf(view: WorldGraphView | null, focus: number | null): number | null {
  if (focus !== null) return focus
  if (view === null) return null
  const live = view.positions[0]
  if (live !== undefined) return live.mapId
  return view.report.components[0]?.mapIds[0] ?? view.nodes[0]?.mapId ?? null
}
