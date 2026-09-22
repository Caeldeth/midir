import { PacketReader } from '../reader'

/**
 * The client's use of a spell, an item, or a skill (WP29).
 *
 * Midir reads these for one reason: a map change that follows one of them
 * is not a walk. A teleport spell, an ant tunnel scroll, and a skill that
 * moves the character all change the map with no step onto a warp tile, and
 * the transition learner must not learn that as an edge. Each carries one
 * slot byte and nothing Midir needs after it; the document repo's pages for
 * `0x0F`, `0x1C`, and `0x3E` give the slot as the first body byte, and the
 * live bodies are `0f 1b 00 0f` and `1c 0c 00 1c`: the opcode, the slot, and
 * two trailing bytes the client adds. Trailing bytes are not fields.
 *
 * A spell's argument bytes after the slot are shape-dependent with no
 * discriminator on the wire (a target serial and a point, or prompt text), so
 * they are not read.
 */

/** CUseSpell 0x0F. */
export interface UseSpell {
  kind: 'useSpell'
  /** The spellbook slot, 1-based. */
  slot: number
}

/** CUseItem 0x1C. */
export interface UseItem {
  kind: 'useItem'
  /** The inventory slot, 1-based. */
  slot: number
}

/** CUseSkill 0x3E. */
export interface UseSkill {
  kind: 'useSkill'
  /** The skillbook slot, 1-based. */
  slot: number
}

export function decodeUseSpell(body: Uint8Array): UseSpell {
  return { kind: 'useSpell', slot: new PacketReader(body, 1).u8() }
}

export function decodeUseItem(body: Uint8Array): UseItem {
  return { kind: 'useItem', slot: new PacketReader(body, 1).u8() }
}

export function decodeUseSkill(body: Uint8Array): UseSkill {
  return { kind: 'useSkill', slot: new PacketReader(body, 1).u8() }
}
