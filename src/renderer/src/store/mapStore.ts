import { create } from 'zustand'
import type { MapPosition, MapSummary, MapView, MapViewFailure, WarpEdit } from '@shared/map'
import type { WalkerState } from '@shared/types'

/**
 * The map viewer's state (WP30).
 *
 * The view is read once per pick. The positions are polled while the page is
 * open, because a character moves every few hundred milliseconds and the
 * capture service has no push for the position on its own; the walker polls
 * the same reading at the same pace. `follow` keeps the picked map on the
 * first live character's map, so the view changes maps with the character.
 */
export const POSITION_POLL_MS = 500

interface MapState {
  maps: MapSummary[]
  selected: number | null
  view: MapView | null
  failure: MapViewFailure | null
  loading: boolean
  positions: MapPosition[]
  /** The walkers running now, by connection, for the path and the stop. */
  walkers: Record<string, WalkerState>
  follow: boolean
  /** Load the map list. */
  refresh: () => Promise<void>
  /** Pick a map and load its view. */
  select: (mapId: number | null) => Promise<void>
  setFollow: (value: boolean) => void
  /** Accept, reject, restore, or nudge a warp on the picked map (WP30). The view follows. */
  editWarp: (edit: WarpEdit) => Promise<void>
  /** Read the positions once, and follow the live map when asked to. */
  pollPositions: () => Promise<void>
  /** Poll the positions and mirror the walker while the page is open. The result stops both. */
  subscribe: () => () => void
}

export const useMapStore = create<MapState>((set, get) => ({
  maps: [],
  selected: null,
  view: null,
  failure: null,
  loading: false,
  positions: [],
  walkers: {},
  follow: true,

  refresh: async () => {
    set({ maps: await window.api.map.list() })
  },

  select: async (mapId) => {
    if (mapId === null) {
      set({ selected: null, view: null, failure: null })
      return
    }
    set({ selected: mapId, loading: true })
    try {
      const result = await window.api.map.view(mapId)
      // A slower answer for an earlier pick must not replace the newer one.
      if (get().selected !== mapId) return
      if (result.ok) set({ view: result.view, failure: null })
      else set({ view: null, failure: result.failure })
    } finally {
      if (get().selected === mapId) set({ loading: false })
    }
  },

  setFollow: (value) => set({ follow: value }),

  editWarp: async (edit) => {
    const result = await window.api.map.editWarp(edit)
    if (get().selected !== edit.fromMapId) return
    if (result.ok) set({ view: result.view, failure: null })
    else set({ view: null, failure: result.failure })
  },

  pollPositions: async () => {
    const positions = await window.api.map.positions()
    set({ positions })
    const first = positions[0]
    if (get().follow && first !== undefined && first.mapId !== get().selected) {
      await get().select(first.mapId)
    }
  },

  subscribe: () => {
    void get().pollPositions()
    const timer = setInterval(() => void get().pollPositions(), POSITION_POLL_MS)
    void window.api.walker.state().then((states) => {
      set({ walkers: Object.fromEntries(states.map((s) => [s.connectionId, s])) })
    })
    const stopWalker = window.api.walker.onState((state) => {
      set({ walkers: { ...get().walkers, [state.connectionId]: state } })
    })
    return () => {
      clearInterval(timer)
      stopWalker()
    }
  }
}))
