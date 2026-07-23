import { describe, expect, it } from 'vitest'
import { crc16 } from '../crc16'

const ascii = (text: string): Uint8Array =>
  Uint8Array.from([...text].map((character) => character.charCodeAt(0)))

describe('crc16', () => {
  // The check value from the client's own description. A standard library
  // CRC16 substituted here fails this, which is the point of keeping it.
  it('gives the documented check value for 123456789', () => {
    expect(crc16(ascii('123456789'))).toBe(0xbeef)
  })

  it('is zero for nothing', () => {
    expect(crc16(new Uint8Array(0))).toBe(0)
  })

  it('differs from CRC-16/XMODEM, which uses the same polynomial', () => {
    // XMODEM gives 0x31C3 for these bytes. The input byte enters after the
    // table lookup here, not as part of the index.
    expect(crc16(ascii('123456789'))).not.toBe(0x31c3)
  })

  it('stays inside sixteen bits', () => {
    const bytes = Uint8Array.from({ length: 512 }, (_, index) => (index * 7) & 0xff)
    const value = crc16(bytes)
    expect(value).toBeGreaterThanOrEqual(0)
    expect(value).toBeLessThanOrEqual(0xffff)
  })
})
