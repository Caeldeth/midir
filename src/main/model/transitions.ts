import type { DecodedPacket } from '../protocol/decode'
import { DIRECTION_DELTA, isWalkDirection } from '../protocol/decode'

/**
 * Learn a map transition from the wire: the tile a walk stepped onto, and the
 * map that step led to (WP29).
 *
 * This is a third reducer beside the character and the position, and just as
 * pure. It watches the same packets the position reducer does and says, at a
 * map change, whether the change was the reply to the player's own step and
 * which tile that step landed on. The walker's graph is hand-made and is
 * sometimes a tile off (`scripts/worldmap-overrides.json` holds the first
 * corrections, found by hand); this learns the same corrections from play.
 *
 * The one way to get this wrong is to learn a teleport as a walk, so the rule
 * is positive: an edge is learned only when the map change is the server's
 * reply to a step. What that looks like on the wire, from 339 walk-warps in
 * the recordings of 2026-07-23 to 2026-09-22:
 *
 *   C 0x06 Walk (the step onto the warp tile)
 *   S 0x32 StaticObjectState, no records (the walk acknowledged)
 *   S 0x67, S 0x15 MapInfo (the new map), S 0x04 UserPosition (the arrival)
 *
 * The server sends no `SMove 0x0B` for the step that warps: the map change is
 * that step's reply. So at the change the newest walk the server has not
 * answered is the warp step, the tile before it is the last one the server
 * confirmed plus every answered step since, and the origin is that tile plus
 * the step's own delta. Two walks are often in flight (the client sends the
 * next before the reply to the last), and the server answers in order, so the
 * **oldest** unanswered walk is the one the change replies to; the live check
 * of 2026-09-21 (Rucesion Commons, (4,6) not (5,6)) is the case.
 *
 * A teleport fails the rule by construction: a spell, an item, a death, or a
 * trap moves the character from wherever it stands, with every walk already
 * answered, so there is no unanswered step at the change. Three more checks
 * are belt and braces, not the rule: the walk must have been acknowledged
 * (the empty `0x32` that answers every accepted step and no teleport), a
 * spell, item, skill, or dialog answer inside `ACTION_WINDOW_MS` before the
 * change drops the candidate, and a lost packet forgets everything until the
 * server speaks again.
 *
 * A world-map hop is learned too, because the walker needs the click to use
 * the edge: the step onto the edge tile is answered by `SFieldMap 0x2E` in
 * place of a move, the click is `CFieldMapClick 0x3F`, and the map change
 * follows the click. The edge carries the point's screen position from the
 * pane, which is what the walker clicks (WP33).
 */

/** A walk older than this at the change got no reply, and is not the step. */
export const WALK_WINDOW_MS = 1500
/** An action inside this window before a change makes the change not a walk. */
export const ACTION_WINDOW_MS = 2000

/** One clean observation of a walk-caused transition. */
export interface TransitionObservation {
  fromMapId: number
  /** The tile the step landed on. */
  x: number
  y: number
  toMapId: number
  /** The first confirmed tile on the new map, when the wire gave one. */
  arrivalX?: number
  arrivalY?: number
  /** A world-map hop: the point the client clicked, on the 640 x 480 pane. */
  via?: { kind: 'fieldMap'; screenX: number; screenY: number }
  /** Capture time of the map change. */
  atMs: number
}

interface PendingWalk {
  direction: number
  atMs: number
  /** True once the server acknowledged the step with an empty 0x32. */
  acked: boolean
}

/** A world-map pane open from a step onto an edge tile. */
interface OpenFieldMap {
  x: number
  y: number
  points: { mapId: number; screenX: number; screenY: number }[]
  /** The point the client clicked, when it has. */
  clicked?: { mapId: number; x: number; y: number }
}

export interface TransitionState {
  mapId: number
  /** The tile the server last confirmed on this map, or null before the first. */
  confirmed: { x: number; y: number } | null
  /** The client's walks the server has not answered, oldest first. */
  pending: PendingWalk[]
  /** Capture time of the newest spell, item, skill, or dialog answer. */
  actionAtMs?: number
  fieldMap?: OpenFieldMap
  /** A transition waiting for its arrival tile: the first 0x04 on the new map. */
  arriving?: Omit<TransitionObservation, 'arrivalX' | 'arrivalY'>
}

export interface TransitionInput {
  packet: DecodedPacket
  timestampMs: number
  sawLoss?: boolean | undefined
}

export interface TransitionStep {
  state: TransitionState | null
  /** A clean walk-warp, complete with its arrival when the wire gave one. */
  observed?: TransitionObservation
}

const ACTION_KINDS: ReadonlySet<DecodedPacket['kind']> = new Set<DecodedPacket['kind']>([
  'useSpell',
  'useItem',
  'useSkill',
  'merchantResponse',
  'pursuitResponse'
])

/** The tile `pending[0]` stepped onto from `confirmed`. */
function originOf(state: TransitionState, atMs: number): { x: number; y: number } | null {
  if (state.confirmed === null) return null
  const step = state.pending.find((walk) => atMs - walk.atMs < WALK_WINDOW_MS)
  if (step === undefined || !step.acked) return null
  const [dx, dy] = DIRECTION_DELTA[step.direction]!
  return { x: state.confirmed.x + dx, y: state.confirmed.y + dy }
}

/** The observation still waiting, sent out without its arrival. */
function release(state: TransitionState): TransitionObservation | undefined {
  return state.arriving === undefined ? undefined : { ...state.arriving }
}

/** The state with the pane and the waiting transition dropped, the tile and the walks kept. */
function bare(state: TransitionState): TransitionState {
  return {
    mapId: state.mapId,
    confirmed: state.confirmed,
    pending: state.pending,
    ...(state.actionAtMs !== undefined ? { actionAtMs: state.actionAtMs } : {})
  }
}

function step(state: TransitionState, observed: TransitionObservation | undefined): TransitionStep {
  return observed === undefined ? { state } : { state, observed }
}

/**
 * Apply one packet. Returns the next state, never the old one changed, and
 * an observation when a map change has been proven a walk and its arrival
 * has been read (or given up on).
 */
export function reduceTransitions(
  state: TransitionState | null,
  input: TransitionInput
): TransitionStep {
  const { packet, timestampMs } = input

  // A loss makes the tile and every walk doubtful. The map stays, because the
  // next 0x04 or 0x0B on it re-establishes the tile.
  if (input.sawLoss === true && state !== null) {
    state = { mapId: state.mapId, confirmed: null, pending: [] }
  }

  switch (packet.kind) {
    case 'mapInfo': {
      if (state === null) return { state: { mapId: packet.mapId, confirmed: null, pending: [] } }
      if (state.mapId === packet.mapId) return { state }
      const observed = release(state)
      const next: TransitionState = { mapId: packet.mapId, confirmed: null, pending: [] }
      const tainted =
        state.actionAtMs !== undefined && timestampMs - state.actionAtMs < ACTION_WINDOW_MS
      if (tainted) return step(next, observed)

      const pane = state.fieldMap
      if (pane !== undefined) {
        // The pane was open: only its click leads anywhere, and the edge is
        // the point that names the new map.
        const point =
          pane.clicked?.mapId === packet.mapId
            ? pane.points.find((p) => p.mapId === packet.mapId)
            : undefined
        if (point !== undefined) {
          next.arriving = {
            fromMapId: state.mapId,
            x: pane.x,
            y: pane.y,
            toMapId: packet.mapId,
            via: { kind: 'fieldMap', screenX: point.screenX, screenY: point.screenY },
            atMs: timestampMs
          }
        }
        return step(next, observed)
      }

      const origin = originOf(state, timestampMs)
      if (origin !== null) {
        next.arriving = {
          fromMapId: state.mapId,
          x: origin.x,
          y: origin.y,
          toMapId: packet.mapId,
          atMs: timestampMs
        }
      }
      return step(next, observed)
    }
    case 'userPosition': {
      if (state === null) return { state }
      const next = { ...bare(state), confirmed: { x: packet.x, y: packet.y }, pending: [] }
      if (state.arriving === undefined) return { state: next }
      return step(next, { ...state.arriving, arrivalX: packet.x, arrivalY: packet.y })
    }
    case 'userMove': {
      if (state === null) return { state }
      const observed = release(state)
      if (!isWalkDirection(packet.direction)) {
        // A correction: the server puts the character on the source tile and
        // answers nothing else, so every walk in flight is void.
        const confirmed = { x: packet.fromX, y: packet.fromY }
        return step({ ...bare(state), confirmed, pending: [] }, observed)
      }
      const [dx, dy] = DIRECTION_DELTA[packet.direction]!
      const confirmed = { x: packet.fromX + dx, y: packet.fromY + dy }
      // The reply answers the oldest walk. A reply with no walk in flight is
      // a step Midir did not see sent; there is nothing to drop.
      return step({ ...bare(state), confirmed, pending: state.pending.slice(1) }, observed)
    }
    case 'walk': {
      if (state === null || !isWalkDirection(packet.direction)) return { state }
      const walk: PendingWalk = { direction: packet.direction, atMs: timestampMs, acked: false }
      return step({ ...bare(state), pending: [...state.pending, walk] }, release(state))
    }
    case 'staticObjectState': {
      // The empty form answers a step; a door's form arrives with one too. It
      // acknowledges the oldest walk not yet acknowledged.
      if (state === null) return { state }
      const index = state.pending.findIndex((walk) => !walk.acked)
      if (index < 0) return { state }
      const pending = state.pending.map((walk, i) =>
        i === index ? { ...walk, acked: true } : walk
      )
      return { state: { ...state, pending } }
    }
    case 'fieldMap': {
      // The pane answers the step onto the edge tile in place of a move, so
      // the character stands on that tile while the pane is open.
      if (state === null) return { state }
      const origin = originOf(state, timestampMs)
      const next = { ...bare(state), pending: [] }
      if (origin === null) return { state: next }
      const points = packet.points.map((p) => ({
        mapId: p.mapId,
        screenX: p.screenX,
        screenY: p.screenY
      }))
      return {
        state: { ...next, confirmed: origin, fieldMap: { x: origin.x, y: origin.y, points } }
      }
    }
    case 'fieldMapClick': {
      if (state === null || state.fieldMap === undefined) return { state }
      return {
        state: {
          ...state,
          fieldMap: {
            ...state.fieldMap,
            clicked: { mapId: packet.mapId, x: packet.x, y: packet.y }
          }
        }
      }
    }
    default: {
      if (state === null || !ACTION_KINDS.has(packet.kind)) return { state }
      return { state: { ...state, actionAtMs: timestampMs } }
    }
  }
}
