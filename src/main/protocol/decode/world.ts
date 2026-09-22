import { PacketReader } from '../reader'

/**
 * The packets that put things on the map beside the player, move them, and
 * take them away: creatures, NPCs, and items on the ground.
 *
 * The walker reads these for one reason (WP35): a right-click on a tile with
 * a creature or a player on it is not a walk. A single right press on a
 * living thing does nothing, and a double right press on one is
 * pursue-and-attack, so the walker never aims at a tile something stands on.
 * Players and NPCs in human form arrive as SDrawHumanObjects 0x33
 * (decode/character.ts); everything else on the ground arrives here.
 *
 * Coordinates are big-endian, like the rest of the protocol. The 0x07 layout
 * is the document repo's, binary-verified against the USDA client: a count
 * header, then one variable-length body per object, selected by the sprite
 * word's high bits.
 */

/** One thing SDrawObjects 0x07 put on the map. */
export type WorldObject =
  | {
      kind: 'creature'
      id: number
      x: number
      y: number
      /** The sprite id, with the type mask removed. */
      sprite: number
      /** 0 North, 1 East, 2 South, 3 West. */
      direction: number
      /**
       * The creature type byte: 0 a solid monster, 1 a monster that can be
       * walked through, 2 an NPC (which carries its name), 4 a reactor.
       */
      type: number
      /** Present for type 2 only. */
      name?: string
    }
  | {
      kind: 'item'
      id: number
      x: number
      y: number
      /** The sprite id, with the type mask removed. */
      sprite: number
      color: number
    }
  | {
      /** A sprite in a range the client parses and then drops without drawing. */
      kind: 'ignored'
      id: number
      x: number
      y: number
      sprite: number
    }

/** SDrawObjects 0x07. One or more objects added to the viewport. */
export interface AddWorldObjects {
  kind: 'addWorldObjects'
  objects: WorldObject[]
}

/** A creature that can be walked through. The client draws it and blocks nothing. */
export const NONSOLID_MONSTER = 1
/** A creature with a name: an NPC. */
export const NPC_TYPE = 2

/**
 * Decode SDrawObjects 0x07.
 *
 * Body: `[u8 opcode][u16 count]` then, per object, `[u16 x][u16 y][u32 id]
 * [u16 sprite]` and a body the sprite selects. A sprite in `[0x4000, 0x8000)`
 * is a creature: `[u8 x4 animation selectors][u8 direction][u8 unused]
 * [u8 type]`, and a `string8 name` when the type is 2. Any other sprite is
 * parsed as an item, `[u8 color][u8][u8]`, and only `[0x8000, 0xC000)` is
 * drawn; the two other ranges are consumed and dropped, and are kept here as
 * `ignored` so the count stays honest.
 *
 * Retail bundles several objects in one packet; the loop reads them all. A
 * body that ends early throws, as every decoder does, and the session reports
 * the packet as unreadable rather than half-read.
 */
export function decodeAddWorldObjects(body: Uint8Array): AddWorldObjects {
  const reader = new PacketReader(body, 1)
  const count = reader.u16()
  const objects: WorldObject[] = []
  for (let i = 0; i < count; i++) {
    const x = reader.u16()
    const y = reader.u16()
    const id = reader.u32()
    const sprite = reader.u16()
    if (sprite >= 0x4000 && sprite < 0x8000) {
      reader.skip(4) // the four animation-slot selectors
      const direction = reader.u8()
      reader.skip(1) // read by the client, never used
      const type = reader.u8()
      const name = type === NPC_TYPE ? reader.string8() : undefined
      objects.push({
        kind: 'creature',
        id,
        x,
        y,
        sprite: sprite - 0x4000,
        direction,
        type,
        ...(name !== undefined ? { name } : {})
      })
      continue
    }
    const color = reader.u8()
    reader.skip(2) // two bytes passed downstream; purpose unconfirmed
    if (sprite >= 0x8000 && sprite < 0xc000) {
      objects.push({ kind: 'item', id, x, y, sprite: sprite - 0x8000, color })
    } else {
      objects.push({ kind: 'ignored', id, x, y, sprite })
    }
  }
  return { kind: 'addWorldObjects', objects }
}

/** SMoveObject 0x0C. Another creature's or player's step, from a source tile. */
export interface CreatureMove {
  kind: 'creatureMove'
  id: number
  /** The tile the step starts from. The destination is this plus the direction's delta. */
  fromX: number
  fromY: number
  /** 0 North, 1 East, 2 South, 3 West. */
  direction: number
}

/**
 * Decode SMoveObject 0x0C.
 *
 * Body: `[u8 opcode][u32 id][u16 fromX][u16 fromY][u8 direction]` and a
 * padding byte the client does not read. The player's own step is SMove 0x0B
 * and never comes this way.
 */
export function decodeCreatureMove(body: Uint8Array): CreatureMove {
  const reader = new PacketReader(body, 1)
  return {
    kind: 'creatureMove',
    id: reader.u32(),
    fromX: reader.u16(),
    fromY: reader.u16(),
    direction: reader.u8()
  }
}

/** SRemoveObject 0x0E. One thing left the viewport. */
export interface RemoveWorldObject {
  kind: 'removeWorldObject'
  id: number
}

/** Decode SRemoveObject 0x0E. Body: `[u8 opcode][u32 id]`. */
export function decodeRemoveWorldObject(body: Uint8Array): RemoveWorldObject {
  const reader = new PacketReader(body, 1)
  return { kind: 'removeWorldObject', id: reader.u32() }
}
