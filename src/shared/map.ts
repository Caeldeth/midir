// The map viewer's contract (WP30). Pure types and channel names; no
// electron or node imports, so main, preload, and the renderer share it.

/** What a warp needs beyond the step, when it needs anything. */
export type MapHopKind = 'fieldMap' | 'prompt' | 'dialog'

/**
 * Where an edge of the route graph came from (WP29): the imported
 * `WorldMap.dat`, the wire, a hand edit on the Map tab (WP30), or a later
 * world import.
 */
export type EdgeSource = 'authored' | 'learned' | 'curated' | 'ceridwen'

/**
 * Whether the walker uses a warp now. A `candidate` is a learned edge the
 * wire has not seen often enough; a `rejected` one was turned off by hand
 * and can be restored.
 */
export type WarpState = 'active' | 'candidate' | 'rejected'

/** One map the viewer can list. */
export interface MapSummary {
  mapId: number
  /** The name from the world graph, else from the wire, else empty. */
  name: string
  /** True when a size is known, so the map can be drawn. */
  drawable: boolean
}

/** One warp tile on the map, and where it leads. */
export interface MapWarp {
  x: number
  y: number
  toMapId: number
  toMapName: string
  /** Absent for a warp that fires on the step. */
  via?: MapHopKind
  source: EdgeSource
  /** How many clean walk-warps the wire saw cross it, when any did. */
  observations?: number
  state: WarpState
}

/**
 * One hand edit to a warp (WP30). `accept` turns a candidate on, `reject`
 * turns a warp off, `restore` withdraws either, and `place` puts a warp on a
 * tile by hand, in place of the one in `replace` when it edits an existing
 * warp: the old one is rejected and the new one accepted. Every edit writes
 * to the learned layer, never to the imported file.
 */
export type WarpEdit =
  | {
      action: 'accept' | 'reject' | 'restore'
      fromMapId: number
      x: number
      y: number
      toMapId: number
    }
  | {
      action: 'place'
      fromMapId: number
      x: number
      y: number
      toMapId: number
      replace?: { x: number; y: number; toMapId: number }
    }

/**
 * A map's passability and warps, sent to the renderer to draw.
 *
 * `collision` is one blocked-direction nibble per tile, row-major, as SOTP
 * gives it: 0x08 North, 0x04 East, 0x02 South, 0x01 West. A tile with any bit
 * set draws as a wall. The door overlay is applied before it is built, so an
 * opened door is open here too.
 */
export interface MapView {
  mapId: number
  mapName: string
  width: number
  height: number
  collision: number[]
  warps: MapWarp[]
  /** Where the size came from, for the caption. */
  sizeSource: 'wire' | 'graph' | 'live'
}

/** Why a map could not be drawn. */
export type MapViewFailure =
  { kind: 'noFolder' } | { kind: 'noSize' } | { kind: 'noCache' } | { kind: 'unknownMap' }

export type MapViewResult = { ok: true; view: MapView } | { ok: false; failure: MapViewFailure }

/** Where a live character stands, for the dot. */
export interface MapPosition {
  connectionId: string
  name: string
  mapId: number
  x: number
  y: number
  confidence: 'confirmed' | 'predicted' | 'unknown'
}

export const MAP_LIST_CHANNEL = 'map:list'
export const MAP_VIEW_CHANNEL = 'map:view'
export const MAP_POSITIONS_CHANNEL = 'map:positions'
export const MAP_EDIT_WARP_CHANNEL = 'map:editWarp'

export function mapViewFailureMessage(failure: MapViewFailure): string {
  switch (failure.kind) {
    case 'noFolder':
      return 'Set the Dark Ages folder in Settings. The map is read from its map cache.'
    case 'noSize':
      return 'The size of this map is not known yet. Visit it once with capture on, and Midir learns it.'
    case 'noCache':
      return 'The client has no cache of this map. Visit it once and the client writes one.'
    case 'unknownMap':
      return 'No map has that id.'
  }
}
