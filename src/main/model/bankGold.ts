import type { CharacterRecord } from '../../shared/character'
import type { DecodedPacket } from '../protocol/decode'

/**
 * The gold in the bank, read from the banker's own words.
 *
 * The retail protocol has no bank opcode, and the gold in the bank is on the
 * wire in one place only: the prompt the banker puts up when the player
 * chooses Deposit Money or Withdraw Money (SScreenMenu 0x2F, a text-entry
 * menu), which states the balance before the amount is typed. Eolathe at
 * Antonio, 2026-09-22 03:20Z:
 *
 *   Deposit Money   -> "Lessee... I've got 0 coins of yours. How much more you going to put in today?"
 *   Withdraw Money  -> "You have 10 coins. How much will you be taking out?"
 *
 * The prompt is the reading. The amount the player then types is the
 * client's CMerchant 0x39 answer to the same pursuit (a length byte and the
 * digits), and the server's next SStatus with the currency block says
 * whether it took: gold down by the amount for a deposit, up by it for a
 * withdrawal. Only then is the balance moved; a refusal ("Failed.") moves
 * nothing, and the prompt's figure stands.
 */

/** The banker's prompt, and what it says the bank holds. */
export interface GoldPrompt {
  kind: 'deposit' | 'withdraw'
  /** What the banker said it holds, before the amount is typed. */
  held: number
}

const DEPOSIT_PROMPT = /I've got (\d[\d,]*) coins of yours/i
const WITHDRAW_PROMPT = /^You have (\d[\d,]*) coins\./i

/** Read a banker's text-entry prompt, or null for any other text. */
export function goldPromptFrom(text: string): GoldPrompt | null {
  const deposit = DEPOSIT_PROMPT.exec(text)
  if (deposit !== null) return { kind: 'deposit', held: Number(deposit[1]!.replace(/,/g, '')) }
  const withdraw = WITHDRAW_PROMPT.exec(text.trim())
  if (withdraw !== null) return { kind: 'withdraw', held: Number(withdraw[1]!.replace(/,/g, '')) }
  return null
}

/**
 * The amount the player typed into the prompt, from the answer's tail: a
 * length byte and the digits (Eolathe's "10" was `02 31 30`). Null for a
 * tail that is not that.
 */
export function amountFromTail(tail: Uint8Array): number | null {
  if (tail.length < 2 || tail[0] !== tail.length - 1) return null
  const text = String.fromCharCode(...tail.subarray(1)).trim()
  if (!/^\d{1,9}$/.test(text)) return null
  return Number(text)
}

/** A prompt answered, waiting for the server's word on the gold. */
export interface PendingGold extends GoldPrompt {
  /** The pursuit the prompt carries, which the answer repeats. */
  pursuit: number
  /** The character's gold when the prompt appeared. */
  goldBefore: number
  /** The amount typed, once the answer is seen. */
  amount?: number
}

/** What one packet does to the pending gold and the record. */
export interface GoldStep {
  pending: PendingGold | undefined
  record: CharacterRecord
}

/**
 * Follow the banker's prompt, the player's answer, and the server's word.
 *
 * The prompt writes the balance at once. The answer remembers the amount.
 * The currency block that follows moves the balance by the amount when the
 * gold moved by it; any other currency block ends the wait, as does any other
 * menu.
 */
export function applyGold(
  pending: PendingGold | undefined,
  record: CharacterRecord,
  packet: DecodedPacket,
  timestampMs: number
): GoldStep {
  if (packet.kind === 'npcMenu') {
    const prompt =
      packet.isTextInput && packet.pursuit !== undefined ? goldPromptFrom(packet.text) : null
    if (prompt === null) return { pending: undefined, record }
    return {
      pending: { ...prompt, pursuit: packet.pursuit!, goldBefore: record.stats.gold },
      record: { ...record, bankGold: { amount: prompt.held, readAtMs: timestampMs } }
    }
  }
  if (pending === undefined) return { pending, record }
  if (packet.kind === 'merchantResponse') {
    if (packet.pursuit !== pending.pursuit) return { pending: undefined, record }
    const amount = amountFromTail(packet.tail)
    return { pending: amount === null ? undefined : { ...pending, amount }, record }
  }
  if (packet.kind === 'status' && packet.currency !== undefined) {
    if (pending.amount === undefined) return { pending, record }
    const moved = packet.currency.gold - pending.goldBefore
    const expected = pending.kind === 'deposit' ? -pending.amount : pending.amount
    if (moved !== expected) return { pending: undefined, record }
    return {
      pending: undefined,
      record: {
        ...record,
        bankGold: {
          amount: pending.held + pending.amount * (pending.kind === 'deposit' ? 1 : -1),
          readAtMs: timestampMs
        }
      }
    }
  }
  return { pending, record }
}
