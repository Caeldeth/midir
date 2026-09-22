import { describe, expect, it } from 'vitest'
import { decodeServerPacket, hasServerDecoder } from '../decode'
import { decodeStaticObjectState } from '../decode/staticObject'
import { ServerOpcode } from '../opcodes'

/** Every byte string here is from a live retail capture (2026-07 to 2026-09). */
const bytes = (hex: string): Uint8Array =>
  new Uint8Array(hex.split(' ').map((b) => parseInt(b, 16)))

describe('SStaticObjectState 0x32 (WP31)', () => {
  it('decodes a two-panel door opening, as retail batches it (Abel Port)', () => {
    const packet = decodeStaticObjectState(bytes('32 02 2c 0a 00 01 2b 0a 00 01'))
    expect(packet).toEqual({
      kind: 'staticObjectState',
      records: [
        { x: 44, y: 10, state: 0, side: 1 },
        { x: 43, y: 10, state: 0, side: 1 }
      ]
    })
  })

  it('decodes one panel closing on the other slot (Rucesion Village)', () => {
    const packet = decodeStaticObjectState(bytes('32 01 15 13 01 00'))
    expect(packet.records).toEqual([{ x: 21, y: 19, state: 1, side: 0 }])
  })

  it('reads the count and not the length: a trailing byte is not a record', () => {
    const packet = decodeStaticObjectState(bytes('32 02 28 2a 00 00 28 29 00 00 00'))
    expect(packet.records).toHaveLength(2)
    expect(packet.records[1]).toEqual({ x: 40, y: 41, state: 0, side: 0 })
  })

  it('a count of zero is the walk acknowledgement: no records', () => {
    expect(decodeStaticObjectState(bytes('32 00')).records).toEqual([])
  })

  it('stops at a short body rather than reading past it', () => {
    expect(decodeStaticObjectState(bytes('32 03 2c 0a 00 01 2b')).records).toHaveLength(1)
  })

  it('is registered under 0x32', () => {
    expect(ServerOpcode.StaticObjectState).toBe(0x32)
    expect(hasServerDecoder(0x32)).toBe(true)
    expect(decodeServerPacket(bytes('32 01 27 0d 00 01'))).toEqual({
      kind: 'staticObjectState',
      records: [{ x: 39, y: 13, state: 0, side: 1 }]
    })
  })
})
