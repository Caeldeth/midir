import { PacketReader } from '../reader'

/**
 * The packets that say where the player stands, and on which map.
 *
 * These replace DA Walker's memory reads. The map number, the tile, and every
 * step are on the wire. See model/position.ts for the reducer that joins them
 * into one position with a confidence.
 *
 * The client moves before the server confirms it. The player walks, the client
 * draws the step and sends CWalk 0x06, and the server answers with SMove 0x0B.
 * A position must follow the client's own step and then snap to the server, so
 * both directions are decoded here.
 *
 * Coordinates are big-endian, like the rest of the protocol. This was checked
 * against a live capture: SUserPosition `04 00 2b 00 28` is x=43, y=40, not the
 * little-endian 0x2b00 a byte-swap would give.
 */

/**
 * The four walk directions, and the tile step each one makes.
 *
 * The index is the direction byte: 0 North, 1 East, 2 South, 3 West. A value
 * above 3 is not a walk. SMove uses 4 as a correction that moves no tile.
 */
export const DIRECTION_DELTA: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // North
  [1, 0], // East
  [0, 1], // South
  [-1, 0] // West
]

/** True while `direction` is one of the four cardinal walk directions. */
export function isWalkDirection(direction: number): boolean {
  return direction >= 0 && direction <= 3
}

/** SUserPosition 0x04. The player's own authoritative tile. */
export interface UserPosition {
  kind: 'userPosition'
  x: number
  y: number
}

/**
 * Decode SUserPosition 0x04.
 *
 * Body: `[u8 opcode][u16 x][u16 y][u16 viewportWidth][u16 viewportHeight]`.
 *
 * The two viewport words are always 11 and the client ignores them. This is the
 * server's word on where the player is, so it always confirms the tile.
 */
export function decodeUserPosition(body: Uint8Array): UserPosition {
  const reader = new PacketReader(body, 1)
  return { kind: 'userPosition', x: reader.u16(), y: reader.u16() }
}

/** SMove 0x0B. The player's own confirmed step, from a source tile. */
export interface UserMove {
  kind: 'userMove'
  /** 0 North, 1 East, 2 South, 3 West. 4 is a correction that moves no tile. */
  direction: number
  /** The tile the step starts from. The destination is this plus the delta. */
  fromX: number
  fromY: number
}

/**
 * Decode SMove 0x0B.
 *
 * Body: `[u8 opcode][u8 direction][u16 fromX][u16 fromY][u16 viewportWidth]
 *        [u16 viewportHeight][u8 step]`.
 *
 * This is the player's own move only. Another creature's move is a different
 * opcode (0x0C), so there is no entity id to check: the connection is the
 * player. `fromX`/`fromY` are the tile before the step, checked against a live
 * capture where each packet's source equals the previous packet's destination.
 * The viewport words and the echoed step counter are not read.
 */
export function decodeUserMove(body: Uint8Array): UserMove {
  const reader = new PacketReader(body, 1)
  return {
    kind: 'userMove',
    direction: reader.u8(),
    fromX: reader.u16(),
    fromY: reader.u16()
  }
}

/** SMapSize 0x15. The map's identity, size, and name. */
export interface MapInfo {
  kind: 'mapInfo'
  mapId: number
  width: number
  height: number
  /** Weather, darkness, and the no-map bit. Not read by the position reducer. */
  flags: number
  name: string
}

/**
 * Decode SMapSize 0x15.
 *
 * Body: `[u8 opcode][u16 mapId][u8 width][u8 height][u8 flags][u8 reserved]
 *        [u24 checksum][string8 name]`.
 *
 * This is the one packet that drives a map change on the 7.41 client. The
 * dead-looking 0x67, 0x1F, and 0x58 do not: 0x67 is unhandled and fires as a
 * bookend around non-map events, 0x1F is SChangeWeather, and 0x58 has no
 * consumer. Both protocol sources agree. So a map change is this packet, and
 * the position reducer clears the tile on it and waits for the next 0x04.
 *
 * The reserved byte and the three checksum bytes are stepped over.
 */
export function decodeMapInfo(body: Uint8Array): MapInfo {
  const reader = new PacketReader(body, 1)
  const mapId = reader.u16()
  const width = reader.u8()
  const height = reader.u8()
  const flags = reader.u8()
  reader.skip(1) // reserved; loaded by the client, never read
  reader.skip(3) // checksum: a leading zero and the 16-bit map CRC
  const name = reader.string8()
  return { kind: 'mapInfo', mapId, width, height, flags, name }
}

/** CWalk 0x06. The client's own step, drawn before the server confirms it. */
export interface Walk {
  kind: 'walk'
  /** 0 North, 1 East, 2 South, 3 West. The client sends no other value. */
  direction: number
  /** A rolling per-connection counter the server echoes to measure latency. */
  step: number
}

/**
 * Decode CWalk 0x06.
 *
 * Body: `[u8 opcode][u8 direction][u8 step]` and trailing bytes the client adds.
 *
 * The client draws this step at once and sends it, so it predicts the position
 * one tile ahead of the server. The reducer marks that a predicted move and
 * snaps back when SMove or SUserPosition arrives.
 */
export function decodeWalk(body: Uint8Array): Walk {
  const reader = new PacketReader(body, 1)
  return { kind: 'walk', direction: reader.u8(), step: reader.u8() }
}
