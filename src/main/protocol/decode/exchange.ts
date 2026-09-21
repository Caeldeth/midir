import { PacketReader } from '../reader'

/**
 * SExchange 0x42, the player-to-player exchange window.
 *
 * One packet opens the window, updates either side's offer, and closes it.
 * The event byte selects the body; both protocol sources agree on all six,
 * and the document repo binary-verifies them against the USDA client:
 *
 *   0x00  started    [u32 exchangeId][string8 partnerName]
 *   0x01  quantity   [u8 slot]         the client opens a count prompt
 *   0x02  item       [u8 party][u8 index][u16 sprite][u8 color][string8 name]
 *   0x03  gold       [u8 party][u32 gold]
 *   0x04  cancelled  [u8 party][string8 message]   closes at once
 *   0x05  accepted   [u8 party][string8 message]   closes once both have
 *
 * Party 0 is the player and anything else is the partner: the client puts
 * party 0 in its `MyExchange` control (darkages-741-re), and Hybrasyl writes
 * the byte as `RightSide = !source`, where the source is the player's own
 * left side of the window (`User.SendExchangeUpdate`). The document repo's
 * page reads it the other way round; the binary and Hybrasyl agree, so this
 * decoder follows them. The window closes on a cancel, and on an accept once
 * both party values have been seen.
 *
 * The reading that matters to a driving assistant: an open exchange holds
 * the character still, like a dialog, and it opens without the player's
 * asking when another player drags an item onto them. The window leaves the
 * wire on a cancel or on the second accept, and the client then shows a
 * one-button alert with the message that never touches the wire. See
 * `model/exchange.ts`.
 */
export type Exchange =
  | { kind: 'exchange'; event: 'started'; exchangeId: number; partnerName: string }
  | { kind: 'exchange'; event: 'quantity'; slot: number }
  | {
      kind: 'exchange'
      event: 'item'
      party: number
      index: number
      sprite: number
      color: number
      name: string
    }
  | { kind: 'exchange'; event: 'gold'; party: number; gold: number }
  | { kind: 'exchange'; event: 'cancelled'; party: number; message: string }
  | { kind: 'exchange'; event: 'accepted'; party: number; message: string }

/** The party byte that means the player. */
export const EXCHANGE_PARTY_SELF = 0

/**
 * CExchange 0x4A, the client's side of the same window: every action the
 * player takes in it. `[u8 action][u32 exchangeId]`, then for add-item a
 * slot, for add-stack a slot and a quantity, for set-gold a u32; start,
 * cancel and accept end after the id. The Cancel button sends 0x04 and the
 * OK button 0x05, and neither closes the pane locally: the server's event
 * does. So the client's cancel, paired with the hand click before it, is
 * how the pane watcher measures where the Cancel button is.
 */
export interface ExchangeRequest {
  kind: 'exchangeRequest'
  action: 'start' | 'addItem' | 'addStack' | 'setGold' | 'cancel' | 'accept'
  exchangeId: number
  slot?: number
  quantity?: number
  gold?: number
}

const REQUEST_ACTIONS: Record<number, ExchangeRequest['action']> = {
  0x00: 'start',
  0x01: 'addItem',
  0x02: 'addStack',
  0x03: 'setGold',
  0x04: 'cancel',
  0x05: 'accept'
}

/** Decode CExchange 0x4A. Returns null for an action the client never sends. */
export function decodeExchangeRequest(body: Uint8Array): ExchangeRequest | null {
  const reader = new PacketReader(body, 1)
  const action = REQUEST_ACTIONS[reader.u8()]
  if (action === undefined) return null
  const exchangeId = reader.u32()
  const request: ExchangeRequest = { kind: 'exchangeRequest', action, exchangeId }
  if (action === 'addItem') request.slot = reader.u8()
  if (action === 'addStack') {
    request.slot = reader.u8()
    request.quantity = reader.u8()
  }
  if (action === 'setGold') request.gold = reader.u32()
  return request
}

/** Decode SExchange 0x42. Returns null for an event byte no client reads. */
export function decodeExchange(body: Uint8Array): Exchange | null {
  const reader = new PacketReader(body, 1)
  const event = reader.u8()
  switch (event) {
    case 0x00: {
      const exchangeId = reader.u32()
      const partnerName = reader.string8()
      return { kind: 'exchange', event: 'started', exchangeId, partnerName }
    }
    case 0x01:
      return { kind: 'exchange', event: 'quantity', slot: reader.u8() }
    case 0x02: {
      const party = reader.u8()
      const index = reader.u8()
      const sprite = reader.u16()
      const color = reader.u8()
      const name = reader.string8()
      return { kind: 'exchange', event: 'item', party, index, sprite, color, name }
    }
    case 0x03: {
      const party = reader.u8()
      const gold = reader.u32()
      return { kind: 'exchange', event: 'gold', party, gold }
    }
    case 0x04: {
      const party = reader.u8()
      const message = reader.string8()
      return { kind: 'exchange', event: 'cancelled', party, message }
    }
    case 0x05: {
      const party = reader.u8()
      const message = reader.string8()
      return { kind: 'exchange', event: 'accepted', party, message }
    }
    default:
      return null
  }
}
