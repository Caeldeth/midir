import { describe, expect, it } from 'vitest'
import { decodeServerPacket } from '../decode'
import { decodeExchange } from '../decode/exchange'

/** `[opcode][event]` then the body, as the wire carries it. */
function body(event: number, ...rest: number[]): Uint8Array {
  return Uint8Array.from([0x42, event, ...rest])
}

const str8 = (text: string): number[] => [text.length, ...Buffer.from(text, 'latin1')]

describe('decodeExchange (SExchange 0x42)', () => {
  it('reads the start event: the exchange id and the partner name', () => {
    expect(decodeExchange(body(0x00, 0x00, 0x01, 0x02, 0x03, ...str8('Pandsala')))).toEqual({
      kind: 'exchange',
      event: 'started',
      exchangeId: 0x00010203,
      partnerName: 'Pandsala'
    })
  })

  it('reads the quantity prompt', () => {
    expect(decodeExchange(body(0x01, 7))).toEqual({ kind: 'exchange', event: 'quantity', slot: 7 })
  })

  it('reads an item on either side', () => {
    expect(decodeExchange(body(0x02, 1, 2, 0x80, 0x64, 3, ...str8('Stick')))).toEqual({
      kind: 'exchange',
      event: 'item',
      party: 1,
      index: 2,
      sprite: 0x8064,
      color: 3,
      name: 'Stick'
    })
  })

  it('reads gold on either side', () => {
    expect(decodeExchange(body(0x03, 0, 0x00, 0x00, 0x03, 0xe8))).toEqual({
      kind: 'exchange',
      event: 'gold',
      party: 0,
      gold: 1000
    })
  })

  it('reads the cancel and the accept with their messages', () => {
    expect(decodeExchange(body(0x04, 1, ...str8('Exchange was cancelled.')))).toEqual({
      kind: 'exchange',
      event: 'cancelled',
      party: 1,
      message: 'Exchange was cancelled.'
    })
    expect(decodeExchange(body(0x05, 0, ...str8('You exchanged.')))).toEqual({
      kind: 'exchange',
      event: 'accepted',
      party: 0,
      message: 'You exchanged.'
    })
  })

  it('returns null for an event no client reads', () => {
    expect(decodeExchange(body(0x09))).toBeNull()
  })

  it('accepts trailing bytes after the last field', () => {
    expect(decodeExchange(body(0x01, 7, 0xff, 0xff))).toMatchObject({ slot: 7 })
  })

  it('is registered for 0x42 in the server direction', () => {
    const packet = decodeServerPacket(body(0x00, 0, 0, 0, 9, ...str8('A')))
    expect(packet).toMatchObject({ kind: 'exchange', event: 'started', partnerName: 'A' })
  })
})
