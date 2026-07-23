import { PacketReader } from '../reader'

/**
 * Inventory and equipment packets.
 *
 * The two "add" packets share a head — slot, sprite, dye colour, name — and
 * then differ. Inventory carries a stack count and a stackable flag.
 * Equipment carries one ignored byte instead.
 */

/** One item as the server describes it. */
export interface DecodedItem {
  sprite: number
  dyeColor: number
  name: string
  durability: number
  maxDurability: number
}

/** SAddInventory 0x0F. Place or replace one inventory slot. */
export interface AddInventory extends DecodedItem {
  kind: 'addInventory'
  /** Slot 1 through 60. Slot 60 is where the client puts its synthetic gold item. */
  slot: number
  quantity: number
  canStack: boolean
}

/**
 * Decode SAddInventory 0x0F.
 *
 * Body: `[u8 opcode][u8 slot][u16 sprite][u8 dye][string8 name][u32 quantity]
 *        [u8 canStack][u32 durability][u32 maxDurability]`.
 *
 * The two durability words are read in the order the retail client's
 * deserializer reads them. Hybrasyl's emitter writes them the other way round
 * (maximum first). Retail is the target, so the retail order wins here. A live
 * capture settles it in one look: a worn item has a current durability below
 * its maximum.
 */
export function decodeAddInventory(body: Uint8Array): AddInventory {
  const reader = new PacketReader(body, 1)
  const slot = reader.u8()
  const sprite = reader.u16()
  const dyeColor = reader.u8()
  const name = reader.string8()
  const quantity = reader.u32()
  const canStack = reader.bool()
  const durability = reader.u32()
  const maxDurability = reader.u32()
  return {
    kind: 'addInventory',
    slot,
    sprite,
    dyeColor,
    name,
    quantity,
    canStack,
    durability,
    maxDurability
  }
}

/** SRemoveInventory 0x10. Clear one inventory slot. */
export interface RemoveInventory {
  kind: 'removeInventory'
  slot: number
}

/** Decode SRemoveInventory 0x10. Body: `[u8 opcode][u8 slot]`. */
export function decodeRemoveInventory(body: Uint8Array): RemoveInventory {
  return { kind: 'removeInventory', slot: new PacketReader(body, 1).u8() }
}

/** SAddEquip 0x37. Place or replace one equipment slot. */
export interface AddEquip extends DecodedItem {
  kind: 'addEquip'
  /** An EquipmentSlot value, 1 through 18. */
  slot: number
}

/**
 * Decode SAddEquip 0x37.
 *
 * Body: `[u8 opcode][u8 slot][u16 sprite][u8 dye][string8 name][u8 ignored]
 *        [u32 durability][u32 maxDurability]`.
 *
 * The byte after the name is part of the parsed body. The client steps over it
 * without checking its value, and it was zero in every observed login.
 */
export function decodeAddEquip(body: Uint8Array): AddEquip {
  const reader = new PacketReader(body, 1)
  const slot = reader.u8()
  const sprite = reader.u16()
  const dyeColor = reader.u8()
  const name = reader.string8()
  reader.skip(1)
  const durability = reader.u32()
  const maxDurability = reader.u32()
  return { kind: 'addEquip', slot, sprite, dyeColor, name, durability, maxDurability }
}

/** SRemoveEquip 0x38. Clear one equipment slot. */
export interface RemoveEquip {
  kind: 'removeEquip'
  slot: number
}

/** Decode SRemoveEquip 0x38. Body: `[u8 opcode][u8 slot]`. */
export function decodeRemoveEquip(body: Uint8Array): RemoveEquip {
  return { kind: 'removeEquip', slot: new PacketReader(body, 1).u8() }
}
