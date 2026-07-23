import { describe, expect, it } from 'vitest'
import { decodeMerchantResponse, decodePursuitResponse } from '../decode/merchant'
import { BANK_WITHDRAW_REQUEST_PURSUIT } from '../decode/dialog'

const body = (...bytes: number[]): Uint8Array => Uint8Array.from(bytes)
const str8 = (text: string): number[] => [text.length, ...[...text].map((c) => c.charCodeAt(0))]

describe('decodeMerchantResponse', () => {
  it('reads the bank request a live capture holds', () => {
    // Object 0x1f6f is Antonio, and 0x45 is "withdraw item".
    const packet = decodeMerchantResponse(body(0x39, 0x01, 0x00, 0x00, 0x1f, 0x6f, 0x00, 0x45))
    expect(packet).toMatchObject({
      kind: 'merchantResponse',
      objectType: 0x01,
      objectId: 0x1f6f,
      pursuit: BANK_WITHDRAW_REQUEST_PURSUIT
    })
    expect([...packet.tail]).toEqual([])
  })

  it('reads the object id and pursuit as big-endian', () => {
    const packet = decodeMerchantResponse(body(0x39, 0x01, 0x12, 0x34, 0x56, 0x78, 0xab, 0xcd))
    expect(packet.objectId).toBe(0x12345678)
    expect(packet.pursuit).toBe(0xabcd)
  })

  it('keeps the response tail unparsed', () => {
    // A "buy with quantity" answer. Its shape is knowable only from the menu
    // the server last sent, so the decoder keeps the bytes as they are.
    const tail = [...str8('Mystic Gown'), ...str8('2')]
    const packet = decodeMerchantResponse(
      body(0x39, 0x01, 0x00, 0x00, 0x1f, 0x6f, 0x00, 0x4a, ...tail)
    )
    expect([...packet.tail]).toEqual(tail)
  })
})

describe('decodePursuitResponse', () => {
  it('reads navigation, which carries no argument', () => {
    const packet = decodePursuitResponse(
      body(0x3a, 0x01, 0x00, 0x00, 0x1a, 0x70, 0x02, 0x4c, 0x00, 0x43)
    )
    expect(packet).toEqual({
      kind: 'pursuitResponse',
      objectType: 0x01,
      objectId: 0x1a70,
      pursuit: 0x024c,
      step: 0x0043
    })
  })

  it('reads a menu choice', () => {
    const packet = decodePursuitResponse(
      body(0x3a, 0x01, 0x00, 0x00, 0x55, 0xc9, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02)
    )
    expect(packet.choice).toBe(2)
    expect(packet.text).toBeUndefined()
  })

  it('reads typed text', () => {
    const packet = decodePursuitResponse(
      body(0x3a, 0x02, 0x00, 0x04, 0x92, 0x75, 0x00, 0x00, 0x00, 0x02, 0x02, ...str8('Ceannlaidir'))
    )
    expect(packet.text).toBe('Ceannlaidir')
    expect(packet.choice).toBeUndefined()
  })

  it('ignores an argument type no client builder emits', () => {
    const packet = decodePursuitResponse(
      body(0x3a, 0x01, 0x00, 0x00, 0x1a, 0x70, 0x02, 0x4c, 0x00, 0x43, 0x07, 0x01, 0x02)
    )
    expect(packet.choice).toBeUndefined()
    expect(packet.text).toBeUndefined()
  })

  it('throws when the body stops inside a field', () => {
    expect(() => decodePursuitResponse(body(0x3a, 0x01, 0x00, 0x00))).toThrow(/too short/)
  })
})
