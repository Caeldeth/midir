import { describe, expect, it } from 'vitest'
import { reduceExchange, type ExchangeState } from '../exchange'
import type { Exchange } from '../../protocol/decode/exchange'
import type { DecodedPacket } from '../../protocol/decode'

const started: Exchange = {
  kind: 'exchange',
  event: 'started',
  exchangeId: 1,
  partnerName: 'Pandsala'
}
const cancelled: Exchange = {
  kind: 'exchange',
  event: 'cancelled',
  party: 1,
  message: 'Exchange was cancelled.'
}
const accepted = (party: number): Exchange => ({
  kind: 'exchange',
  event: 'accepted',
  party,
  message: 'You exchanged.'
})

function open(): ExchangeState {
  return reduceExchange(null, { packet: started, timestampMs: 1000 })!
}

describe('reduceExchange', () => {
  it('opens on the start event, with the partner and the capture time', () => {
    expect(open()).toEqual({ kind: 'open', partnerName: 'Pandsala', asOfMs: 1000, accepted: [] })
  })

  it('leaves the window open through offer updates', () => {
    const state = open()
    const item: Exchange = {
      kind: 'exchange',
      event: 'item',
      party: 1,
      index: 1,
      sprite: 0x8064,
      color: 0,
      name: 'Stick'
    }
    const gold: Exchange = { kind: 'exchange', event: 'gold', party: 0, gold: 10 }
    const quantity: Exchange = { kind: 'exchange', event: 'quantity', slot: 3 }
    expect(reduceExchange(state, { packet: item, timestampMs: 1100 })).toBe(state)
    expect(reduceExchange(state, { packet: gold, timestampMs: 1200 })).toBe(state)
    expect(reduceExchange(state, { packet: quantity, timestampMs: 1300 })).toBe(state)
  })

  it('becomes the closing alert on a cancel from either side', () => {
    expect(reduceExchange(open(), { packet: cancelled, timestampMs: 2000 })).toEqual({
      kind: 'alert',
      message: 'Exchange was cancelled.',
      asOfMs: 2000
    })
  })

  it('stays open after one accept and closes on the second', () => {
    const one = reduceExchange(open(), { packet: accepted(1), timestampMs: 2000 })
    expect(one).toMatchObject({ kind: 'open', accepted: [1] })
    // The same side again is not the second accept.
    const same = reduceExchange(one, { packet: accepted(1), timestampMs: 2100 })
    expect(same).toMatchObject({ kind: 'open', accepted: [1] })
    expect(reduceExchange(same, { packet: accepted(0), timestampMs: 2200 })).toEqual({
      kind: 'alert',
      message: 'You exchanged.',
      asOfMs: 2200
    })
  })

  it("keeps the client's cancel beside the window and carries it onto the alert", () => {
    const cancel: DecodedPacket = { kind: 'exchangeRequest', action: 'cancel', exchangeId: 1 }
    const sent = reduceExchange(open(), { packet: cancel, timestampMs: 1900 })
    expect(sent).toMatchObject({ kind: 'open', sent: { action: 'cancel', asOfMs: 1900 } })
    expect(reduceExchange(sent, { packet: cancelled, timestampMs: 1940 })).toEqual({
      kind: 'alert',
      message: 'Exchange was cancelled.',
      asOfMs: 1940,
      sent: { action: 'cancel', asOfMs: 1900 }
    })
  })

  it('ignores a client action that is not a cancel or an accept, and one with no window', () => {
    const state = open()
    const add: DecodedPacket = {
      kind: 'exchangeRequest',
      action: 'addItem',
      exchangeId: 1,
      slot: 3
    }
    expect(reduceExchange(state, { packet: add, timestampMs: 1500 })).toBe(state)
    const cancel: DecodedPacket = { kind: 'exchangeRequest', action: 'cancel', exchangeId: 1 }
    expect(reduceExchange(null, { packet: cancel, timestampMs: 1500 })).toBeNull()
  })

  it('ignores an accept with no window open', () => {
    expect(reduceExchange(null, { packet: accepted(0), timestampMs: 2000 })).toBeNull()
  })

  it('leaves the state alone for any other packet', () => {
    const state = open()
    const walk: DecodedPacket = { kind: 'walk', direction: 0, step: 1 }
    expect(reduceExchange(state, { packet: walk, timestampMs: 1500 })).toBe(state)
  })

  it('forgets the window after a lost packet', () => {
    const state = open()
    const walk: DecodedPacket = { kind: 'walk', direction: 0, step: 1 }
    expect(reduceExchange(state, { packet: walk, timestampMs: 1500, sawLoss: true })).toBeNull()
  })
})
