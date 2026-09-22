import type { BankSnapshot, CharacterRecord, ItemRef } from '../../shared/character'
import type { DecodedPacket } from '../protocol/decode'
import { BANK_DEPOSIT_PURSUIT, BANK_WITHDRAW_PURSUIT } from '../protocol/decode/dialog'

/**
 * An item moving into or out of the bank, read from the player's pick and the
 * server's word (WP22).
 *
 * The retail protocol has no bank opcode, so a deposit and a withdrawal are
 * both an NPC dialog answered by CMerchant 0x39, and the server says nothing
 * about the bank afterwards: it moves the item in the inventory. Antonio,
 * 2026-09-22:
 *
 *   Deposit Item  -> 0x2F type 5, pursuit 0x53, the slots the banker takes
 *                    0x39 pursuit 0x53, tail `[u8 slot]`          (slot 2)
 *                    0x10 remove-inventory slot 2, 204 ms later
 *   Withdraw Item -> 0x2F type 4, pursuit 0x56, the bank's list
 *                    0x39 pursuit 0x56, tail `[string8 name]`
 *                    0x0F add-inventory of that name, 237 ms later
 *
 * The pick is remembered with the item it names; the inventory change is the
 * proof, and only then does the bank on the record move. A refusal shows as
 * no inventory change, and moves nothing. The move is applied to a bank that
 * has been read, because a bank with only the one deposited item in it would
 * read as the whole bank; an unread bank stays unread. The window is the bank
 * reply window, against the two observed replies above.
 */
export const BANK_MOVE_WINDOW_MS = 2000

export type PendingMove =
  | { kind: 'deposit'; atMs: number; slot: number; item: ItemRef }
  | { kind: 'withdraw'; atMs: number; name: string }

export interface MoveStep {
  pending: PendingMove | undefined
  record: CharacterRecord
}

/** The slot a deposit pick names, or null when the tail is not one byte. */
export function depositSlotOf(tail: Uint8Array): number | null {
  return tail.length === 1 ? tail[0]! : null
}

/** The name a withdraw pick names, or null when the tail is not a string8. */
export function withdrawNameOf(tail: Uint8Array): string | null {
  if (tail.length < 1 || tail.length !== 1 + tail[0]!) return null
  return Buffer.from(tail.subarray(1)).toString('latin1')
}

function deposited(bank: BankSnapshot, item: ItemRef, atMs: number): BankSnapshot {
  const items = bank.items.map((held) => ({ ...held }))
  const held = items.find((row) => row.name === item.name && row.sprite === item.sprite)
  if (held !== undefined) held.count += item.count
  else items.push({ name: item.name, sprite: item.sprite, color: item.color, count: item.count })
  return { ...bank, items, readAtMs: atMs }
}

function withdrawn(bank: BankSnapshot, item: ItemRef, atMs: number): BankSnapshot {
  const items: BankSnapshot['items'] = []
  for (const row of bank.items) {
    if (row.name !== item.name) {
      items.push({ ...row })
      continue
    }
    const left = row.count - item.count
    if (left > 0) items.push({ ...row, count: left })
  }
  return { ...bank, items, readAtMs: atMs }
}

/**
 * Follow a pick and the inventory change that confirms it.
 *
 * `record` is the record as it stood before this packet, so a deposit pick
 * reads its item from the slot while the item is still there; the remove that
 * confirms it later carries only the slot. The reducer runs this before it
 * applies the packet for that reason.
 */
export function applyBankMove(
  pending: PendingMove | undefined,
  record: CharacterRecord,
  packet: DecodedPacket,
  timestampMs: number
): MoveStep {
  if (packet.kind === 'merchantResponse') {
    if (packet.pursuit === BANK_DEPOSIT_PURSUIT) {
      const slot = depositSlotOf(packet.tail)
      const item = slot === null ? undefined : record.inventory[slot]
      if (slot === null || item === undefined) return { pending: undefined, record }
      return { pending: { kind: 'deposit', atMs: timestampMs, slot, item }, record }
    }
    if (packet.pursuit === BANK_WITHDRAW_PURSUIT) {
      const name = withdrawNameOf(packet.tail)
      if (name === null) return { pending: undefined, record }
      return { pending: { kind: 'withdraw', atMs: timestampMs, name }, record }
    }
    return { pending: undefined, record }
  }
  if (pending === undefined) return { pending, record }
  if (timestampMs - pending.atMs >= BANK_MOVE_WINDOW_MS) return { pending: undefined, record }

  if (pending.kind === 'deposit' && packet.kind === 'removeInventory') {
    if (packet.slot !== pending.slot) return { pending, record }
    const bank = record.bank
    return {
      pending: undefined,
      record:
        bank === undefined
          ? record
          : { ...record, bank: deposited(bank, pending.item, timestampMs) }
    }
  }
  if (pending.kind === 'withdraw' && packet.kind === 'addInventory') {
    if (packet.name !== pending.name) return { pending, record }
    const bank = record.bank
    const item: ItemRef = {
      name: packet.name,
      sprite: packet.sprite,
      color: packet.dyeColor,
      count: packet.quantity,
      canStack: packet.canStack,
      durability: packet.durability,
      maxDurability: packet.maxDurability
    }
    return {
      pending: undefined,
      record: bank === undefined ? record : { ...record, bank: withdrawn(bank, item, timestampMs) }
    }
  }
  // A list arriving settles the bank on its own; any other dialog ends the wait.
  if (
    packet.kind === 'bankContents' ||
    packet.kind === 'npcMenu' ||
    packet.kind === 'playerItemMenu'
  ) {
    return { pending: undefined, record }
  }
  return { pending, record }
}
