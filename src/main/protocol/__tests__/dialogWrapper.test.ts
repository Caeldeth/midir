import { describe, expect, it } from 'vitest'
import { crc16 } from '../crc16'
import { unwrapDialogResponse } from '../dialogWrapper'

/**
 * The two fixtures below are real bytes from a retail session recording, taken
 * after the outer transform and before the wrapper. Neither carries anything a
 * player typed.
 */

/** CMerchant 0x39 asking a banker for the withdraw list, pursuit 0x0045. */
const BANK_REQUEST = Uint8Array.from([
  0x39, 0xb7, 0xca, 0xb2, 0xba, 0x4c, 0x79, 0x6b, 0x6b, 0x6c, 0x72, 0x01, 0x6f, 0x35, 0x00, 0x39
])

/** CPursuit 0x3A answering a menu with row 2. */
const MENU_CHOICE = Uint8Array.from([
  0x3a, 0x7d, 0x0c, 0xce, 0xc2, 0xe6, 0xb7, 0x87, 0x87, 0x88, 0xdc, 0x43, 0x8b, 0x8c, 0x8d, 0x8c,
  0x8e, 0x92, 0x00
])

/** Build a wrapper the way the client does, for cases no capture holds. */
function wrap(opcode: number, payload: number[], random1 = 0x5a, random2 = 0xa5): Uint8Array {
  const bytes = Uint8Array.from(payload)
  const checksum = crc16(bytes)
  const inner = Uint8Array.from([(checksum >> 8) & 0xff, checksum & 0xff, ...payload])

  let key = (random2 + 0x28) & 0xff
  for (let i = 0; i < inner.length; i++) {
    inner[i] = inner[i]! ^ key
    key = (key + 1) & 0xff
  }

  const innerLength = inner.length
  return Uint8Array.from([
    opcode,
    random1,
    ((random1 + 0xd3) & 0xff) ^ random2,
    ((innerLength >> 8) & 0xff) ^ ((random2 + 0x72) & 0xff),
    (innerLength & 0xff) ^ ((random2 + 0x73) & 0xff),
    ...inner,
    0x00
  ])
}

describe('unwrapDialogResponse', () => {
  it('unwraps a live bank request', () => {
    const plain = unwrapDialogResponse(BANK_REQUEST)
    // Object type 1, object 0x1f6f, pursuit 0x0045.
    expect([...plain!]).toEqual([0x39, 0x01, 0x00, 0x00, 0x1f, 0x6f, 0x00, 0x45])
  })

  it('unwraps a live menu answer', () => {
    const plain = unwrapDialogResponse(MENU_CHOICE)
    expect([...plain!]).toEqual([
      0x3a, 0x01, 0x00, 0x00, 0x55, 0xc9, 0x00, 0x00, 0x00, 0x02, 0x01, 0x02
    ])
  })

  it('ignores the trailing zero and the scratch byte after it', () => {
    // The live 0x39 fixture carries 00 39 after the inner block. They are
    // outside the encoded length, and the payload stops before them.
    expect(unwrapDialogResponse(BANK_REQUEST)).toHaveLength(8)
  })

  it('round-trips a payload the captures do not hold', () => {
    const payload = [0x01, 0x00, 0x00, 0x1a, 0x70, 0x02, 0x4c, 0x00, 0x43, 0x01, 0x01]
    const plain = unwrapDialogResponse(wrap(0x3a, payload))
    expect([...plain!]).toEqual([0x3a, ...payload])
  })

  it('works for every random pair, because both randoms are in the packet', () => {
    for (const random1 of [0x00, 0x7f, 0xff]) {
      for (const random2 of [0x00, 0x80, 0xff]) {
        const plain = unwrapDialogResponse(wrap(0x39, [0x01, 0x02, 0x03], random1, random2))
        expect([...plain!]).toEqual([0x39, 0x01, 0x02, 0x03])
      }
    }
  })

  it('refuses a body whose CRC does not match', () => {
    const damaged = Uint8Array.from(BANK_REQUEST)
    damaged[6] = damaged[6]! ^ 0xff
    expect(unwrapDialogResponse(damaged)).toBeNull()
  })

  it('refuses a body whose encoded length does not fit', () => {
    const damaged = Uint8Array.from(BANK_REQUEST)
    damaged[3] = damaged[3]! ^ 0xff
    expect(unwrapDialogResponse(damaged)).toBeNull()
  })

  it('refuses a body too short to hold a wrapper, without throwing', () => {
    expect(unwrapDialogResponse(Uint8Array.from([0x39, 0x01, 0x02]))).toBeNull()
    expect(unwrapDialogResponse(new Uint8Array(0))).toBeNull()
  })

  it('leaves the body it was given alone', () => {
    const before = [...BANK_REQUEST]
    unwrapDialogResponse(BANK_REQUEST)
    expect([...BANK_REQUEST]).toEqual(before)
  })
})
