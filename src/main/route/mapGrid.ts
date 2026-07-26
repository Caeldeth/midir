import { DIRECTION_DELTA, isWalkDirection } from '../protocol/decode'

/**
 * A map's passability, built from the client's own tile cache and the SOTP
 * collision table.
 *
 * The map cache file `lodNNNNN.map` is a header-less row-major array of six-byte
 * cells: `[u16le ground][u16le leftStatic][u16le rightStatic]`. The two static
 * tile ids select the collision flags in SOTP.DAT. This grid joins them into one
 * question the A* pathfinder asks: can the player step from a tile in a
 * direction.
 *
 * The map is read from disk, not off the wire. The server sends the tile rows
 * (SMapPart 0x3C) only on a cache miss, so a returning player's client loads the
 * map from `lodNNNNN.map` and the wire is silent. The disk cache is the complete
 * source, and it is the same six-byte cell format.
 */

/** The bytes one map cell holds. */
const CELL_BYTES = 6

/** The static tile id the client treats as empty, matching SOTP.DAT. */
const EMPTY_TILE_ID = 0x2710

/**
 * The SOTP collision bit for each walk direction.
 *
 * The direction index matches DIRECTION_DELTA: 0 North (0,-1), 1 East (+1,0),
 * 2 South (0,+1), 3 West (-1,0). SOTP names the bits by grid move: up 0x08,
 * right 0x04, down 0x02, left 0x01.
 */
const DIRECTION_BIT = [0x08, 0x04, 0x02, 0x01]

/** The collision flags for one static tile id. Injected, so tests need no file. */
export interface Collision {
  /** The low-nibble collision bits for a static tile id, or 0 when it is empty. */
  collisionFor(tileId: number): number
}

/** A map's passability, ready for the pathfinder. */
export interface MapGrid {
  width: number
  height: number
  /** True while (x, y) is inside the map. */
  inBounds(x: number, y: number): boolean
  /**
   * Can the player step from (x, y) in a walk direction (0-3)?
   *
   * The move is blocked when the direction's collision bit is set on either the
   * source tile or the destination tile, exactly as the client's
   * `map_can_move_direction` reads it. A move off the map is always blocked.
   */
  canMove(x: number, y: number, direction: number): boolean
}

/**
 * Build a grid from raw map-cache bytes, its dimensions, and the SOTP table.
 *
 * The buffer must hold at least `width * height * 6` bytes. Extra trailing bytes
 * are ignored, as the client ignores them.
 */
export function buildMapGrid(
  bytes: Uint8Array,
  width: number,
  height: number,
  collision: Collision
): MapGrid {
  const cells = width * height
  if (bytes.length < cells * CELL_BYTES) {
    throw new Error(
      `Map cache too short: ${bytes.length} bytes for ${width}x${height} (need ${cells * CELL_BYTES}).`
    )
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  // Precompute one collision nibble for each tile: the OR of both static tiles.
  // A cell is blocked in a direction when either static tile blocks it.
  const blockedBits = new Uint8Array(cells)
  for (let i = 0; i < cells; i++) {
    const base = i * CELL_BYTES
    const leftStatic = view.getUint16(base + 2, true)
    const rightStatic = view.getUint16(base + 4, true)
    let bits = 0
    if (leftStatic !== EMPTY_TILE_ID) bits |= collision.collisionFor(leftStatic)
    if (rightStatic !== EMPTY_TILE_ID) bits |= collision.collisionFor(rightStatic)
    blockedBits[i] = bits & 0x0f
  }

  function inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < width && y < height
  }

  function canMove(x: number, y: number, direction: number): boolean {
    if (!isWalkDirection(direction) || !inBounds(x, y)) return false
    const [dx, dy] = DIRECTION_DELTA[direction]!
    const nx = x + dx
    const ny = y + dy
    if (!inBounds(nx, ny)) return false
    const bit = DIRECTION_BIT[direction]!
    if ((blockedBits[y * width + x]! & bit) !== 0) return false
    if ((blockedBits[ny * width + nx]! & bit) !== 0) return false
    return true
  }

  return { width, height, inBounds, canMove }
}
