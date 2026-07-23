import { describe, expect, it } from 'vitest'
import { PacketReader } from '../reader'

const of = (...bytes: number[]): PacketReader => new PacketReader(Uint8Array.from(bytes))

describe('PacketReader', () => {
  it('reads unsigned integers as big-endian', () => {
    const reader = of(0x7f, 0x12, 0x34, 0x00, 0xbc, 0x61, 0x4e)
    expect(reader.u8()).toBe(0x7f)
    expect(reader.u16()).toBe(0x1234)
    expect(reader.u32()).toBe(0x00bc614e)
  })

  it('reads a 32-bit value above 2^31 without going negative', () => {
    // Durability and stack counts use the full unsigned range.
    expect(of(0xff, 0xff, 0xff, 0xff).u32()).toBe(0xffffffff)
    expect(of(0x80, 0x00, 0x00, 0x00).u32()).toBe(2147483648)
  })

  it('reads a signed byte', () => {
    expect(of(0x00).i8()).toBe(0)
    expect(of(0x7f).i8()).toBe(127)
    expect(of(0x80).i8()).toBe(-128)
    expect(of(0xff).i8()).toBe(-1)
  })

  it('reads a byte as a boolean where any non-zero value is true', () => {
    expect(of(0x00).bool()).toBe(false)
    expect(of(0x01).bool()).toBe(true)
    expect(of(0x7f).bool()).toBe(true)
  })

  it('reads a string with a one-byte length prefix', () => {
    const reader = of(0x07, 0x53, 0x61, 0x62, 0x72, 0x61, 0x65, 0x6c, 0x99)
    expect(reader.string8()).toBe('Sabrael')
    expect(reader.remaining).toBe(1)
  })

  it('reads a string with a two-byte length prefix', () => {
    const reader = of(0x00, 0x03, 0x61, 0x62, 0x63)
    expect(reader.string16()).toBe('abc')
  })

  it('reads an empty string', () => {
    const reader = of(0x00, 0x05)
    expect(reader.string8()).toBe('')
    expect(reader.u8()).toBe(0x05)
  })

  it('keeps every byte of a high-bit string', () => {
    // Bytes above 0x7F must survive, so another code page can be recovered.
    const reader = of(0x02, 0xb8, 0xc5)
    const text = reader.string8()
    expect([...text].map((c) => c.charCodeAt(0))).toEqual([0xb8, 0xc5])
  })

  it('tracks position and remaining', () => {
    const reader = of(1, 2, 3, 4, 5)
    expect(reader.position).toBe(0)
    expect(reader.remaining).toBe(5)
    expect(reader.hasMore).toBe(true)
    reader.skip(5)
    expect(reader.position).toBe(5)
    expect(reader.remaining).toBe(0)
    expect(reader.hasMore).toBe(false)
  })

  it('copies bytes rather than aliasing the body', () => {
    const body = Uint8Array.from([1, 2, 3, 4])
    const taken = new PacketReader(body).bytes(2)
    body.fill(0)
    expect([...taken]).toEqual([1, 2])
  })

  it('returns every remaining byte with rest', () => {
    const reader = of(1, 2, 3, 4)
    reader.u16()
    expect([...reader.rest()]).toEqual([3, 4])
    expect(reader.remaining).toBe(0)
  })

  it('starts at an offset when asked', () => {
    expect(new PacketReader(Uint8Array.from([0x0f, 0x01, 0x02]), 1).u8()).toBe(0x01)
  })

  it('throws when a read runs past the end', () => {
    expect(() => of(0x01).u16()).toThrow(RangeError)
    expect(() => of(0x01, 0x02).u32()).toThrow(RangeError)
    expect(() => of(0x05, 0x61).string8()).toThrow(RangeError)
    expect(() => of().u8()).toThrow(RangeError)
  })

  it('names the offset and the shortfall in the error', () => {
    const reader = of(0x01, 0x02, 0x03)
    reader.u16()
    expect(() => reader.u32()).toThrow(/offset 2, 1 left/)
  })
})
