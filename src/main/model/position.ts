import type { DecodedPacket } from '../protocol/decode'
import { DIRECTION_DELTA, isWalkDirection } from '../protocol/decode'

/**
 * Turn a stream of decoded packets into one position.
 *
 * This is a second reducer, beside the character reducer and just as pure. It
 * takes a state and a packet and returns the next state, so a whole walk can be
 * replayed through it in a test. It replaces DA Walker's memory reads: the map,
 * the tile, and every step come off the wire.
 *
 * The one rule that shapes it: **the client moves before the server confirms
 * it.** The client draws a step and sends CWalk 0x06 at once, so a position
 * that waits for the server lags every step, and a position that trusts only
 * the client drifts through every refusal. This reducer does what the client
 * does: it steps on the client's own walk (a `predicted` move) and snaps to the
 * server whenever the server speaks (a `confirmed` move).
 */

/** Where the character stands, and how sure Midir is of it. */
export interface Position {
  mapId: number
  mapName?: string
  x: number
  y: number
  /** 0 North, 1 East, 2 South, 3 West. */
  facing: number
  /** Capture time of the packet that last moved it. */
  asOfMs: number
  /**
   * `confirmed` when the server just spoke, `predicted` when only the client's
   * own walk has moved it, `unknown` after a gap or before the first map.
   */
  confidence: 'confirmed' | 'predicted' | 'unknown'
}

/** One packet, with what the capture layer knows about it. */
export interface PositionInput {
  packet: DecodedPacket
  /** Capture time of the packet. */
  timestampMs: number
  /**
   * True when bytes were lost on this connection since the previous packet.
   *
   * A walk that has lost its place cannot be trusted, so a loss makes the
   * position `unknown`. A later server word re-establishes it.
   */
  sawLoss?: boolean | undefined
}

/**
 * Apply one packet. Returns a new state and never changes the old one.
 *
 * Returns null while nothing is known yet: before the first SMapSize, there is
 * no map to place a tile on, so SUserPosition and SMove on their own produce
 * nothing.
 */
export function reducePosition(state: Position | null, input: PositionInput): Position | null {
  // A loss makes the last position doubtful. Mark it unknown first, then let a
  // packet that carries an absolute tile (SUserPosition, SMove) override it.
  const base = input.sawLoss === true ? toUnknown(state) : state
  const { packet, timestampMs } = input

  switch (packet.kind) {
    case 'mapInfo':
      return applyMap(base, packet.mapId, packet.name, timestampMs)
    case 'userPosition':
      return confirmTile(base, packet.x, packet.y, timestampMs)
    case 'userMove':
      return applyServerMove(base, packet.direction, packet.fromX, packet.fromY, timestampMs)
    case 'walk':
      return predictStep(base, packet.direction, timestampMs)
    default:
      return base
  }
}

/** Mark a position doubtful without forgetting where it was. */
function toUnknown(state: Position | null): Position | null {
  if (state === null || state.confidence === 'unknown') return state
  return { ...state, confidence: 'unknown' }
}

/**
 * Apply SMapSize 0x15.
 *
 * A new map clears the tile: the map is known but the tile is not, so the
 * position is `unknown` until the first SUserPosition confirms it. The same map
 * again only refreshes the name and keeps the tile.
 */
function applyMap(
  state: Position | null,
  mapId: number,
  name: string,
  timestampMs: number
): Position {
  if (state !== null && state.mapId === mapId) {
    return { ...state, mapName: name }
  }
  return {
    mapId,
    mapName: name,
    x: 0,
    y: 0,
    facing: state?.facing ?? 0,
    asOfMs: timestampMs,
    confidence: 'unknown'
  }
}

/**
 * Apply SUserPosition 0x04, the server's word on the exact tile.
 *
 * It needs a map to place the tile on. Before the first SMapSize there is none,
 * so it produces nothing.
 */
function confirmTile(
  state: Position | null,
  x: number,
  y: number,
  timestampMs: number
): Position | null {
  if (state === null) return null
  return { ...state, x, y, asOfMs: timestampMs, confidence: 'confirmed' }
}

/**
 * Apply SMove 0x0B, the server's confirmation of a step.
 *
 * The packet carries the source tile and the direction, so the destination is
 * the source plus the direction's delta. This is an absolute answer, so it wins
 * over any prediction. A direction above 3 is a correction that moves no tile:
 * the server is asserting the source itself is where the player stands.
 */
function applyServerMove(
  state: Position | null,
  direction: number,
  fromX: number,
  fromY: number,
  timestampMs: number
): Position | null {
  if (state === null) return null
  if (!isWalkDirection(direction)) {
    return { ...state, x: fromX, y: fromY, asOfMs: timestampMs, confidence: 'confirmed' }
  }
  const [dx, dy] = DIRECTION_DELTA[direction]!
  return {
    ...state,
    x: fromX + dx,
    y: fromY + dy,
    facing: direction,
    asOfMs: timestampMs,
    confidence: 'confirmed'
  }
}

/**
 * Apply CWalk 0x06, the client's own step.
 *
 * The client draws the step at once, so the position moves one tile ahead of
 * the server and is only `predicted`. It moves nothing while the position is
 * `unknown`: a predicted step from a tile Midir is unsure of would be a guess
 * on a guess.
 */
function predictStep(
  state: Position | null,
  direction: number,
  timestampMs: number
): Position | null {
  if (state === null || state.confidence === 'unknown') return state
  if (!isWalkDirection(direction)) return state
  const [dx, dy] = DIRECTION_DELTA[direction]!
  return {
    ...state,
    x: state.x + dx,
    y: state.y + dy,
    facing: direction,
    asOfMs: timestampMs,
    confidence: 'predicted'
  }
}
