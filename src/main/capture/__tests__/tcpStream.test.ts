import { describe, expect, it } from 'vitest'
import { createTcpStream, MAX_PENDING_SEGMENTS, type StreamOutput } from '../tcpStream'

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)
const out = (result: StreamOutput): { bytes: number[]; gap: boolean } => ({
  bytes: [...result.bytes],
  gap: result.gap
})

describe('createTcpStream', () => {
  it('takes its starting point from the first segment', () => {
    const stream = createTcpStream()
    expect(out(stream.push(5000, bytes(1, 2, 3)))).toEqual({ bytes: [1, 2, 3], gap: false })
  })

  it('delivers segments that follow on directly', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1, 2))
    expect(out(stream.push(102, bytes(3, 4)))).toEqual({ bytes: [3, 4], gap: false })
    expect(out(stream.push(104, bytes(5)))).toEqual({ bytes: [5], gap: false })
  })

  it('holds an early segment, then releases both when the gap fills', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1, 2))
    expect(out(stream.push(104, bytes(5, 6)))).toEqual({ bytes: [], gap: false })
    expect(stream.pendingSegments).toBe(1)
    expect(out(stream.push(102, bytes(3, 4)))).toEqual({ bytes: [3, 4, 5, 6], gap: false })
    expect(stream.pendingSegments).toBe(0)
  })

  it('releases a whole run of buffered segments at once', () => {
    const stream = createTcpStream()
    stream.push(0, bytes(0))
    stream.push(5, bytes(5))
    stream.push(4, bytes(4))
    stream.push(3, bytes(3))
    expect(out(stream.push(1, bytes(1, 2)))).toEqual({ bytes: [1, 2, 3, 4, 5], gap: false })
  })

  it('drops a whole retransmission', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1, 2, 3))
    expect(out(stream.push(100, bytes(1, 2, 3)))).toEqual({ bytes: [], gap: false })
  })

  it('keeps only the new tail of an overlapping segment', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1, 2, 3)) // covers 100 through 102
    expect(out(stream.push(102, bytes(3, 4, 5)))).toEqual({ bytes: [4, 5], gap: false })
  })

  it('ignores an empty segment, so a bare acknowledgement changes nothing', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1, 2))
    expect(out(stream.push(102, new Uint8Array(0)))).toEqual({ bytes: [], gap: false })
    expect(out(stream.push(102, bytes(3)))).toEqual({ bytes: [3], gap: false })
  })

  it('declares a gap once too much is waiting, and continues from what it has', () => {
    const stream = createTcpStream()
    stream.push(0, bytes(0))

    // Everything from sequence 1 is missing. Segments keep arriving above it.
    let result: StreamOutput = { bytes: new Uint8Array(0), gap: false }
    for (let i = 0; i <= MAX_PENDING_SEGMENTS; i++) {
      result = stream.push(100 + i * 2, bytes(i & 0xff, i & 0xff))
    }

    expect(result.gap).toBe(true)
    expect(result.bytes.length).toBeGreaterThan(0)
    expect(stream.gapCount).toBe(1)
    expect(stream.pendingSegments).toBe(0)
  })

  it('continues in order after a gap', () => {
    const stream = createTcpStream()
    stream.push(0, bytes(0))
    for (let i = 0; i <= MAX_PENDING_SEGMENTS; i++) stream.push(1000 + i, bytes(0xee))

    const resumed = stream.push(1000 + MAX_PENDING_SEGMENTS + 1, bytes(0x42))
    expect(out(resumed)).toEqual({ bytes: [0x42], gap: false })
  })

  it('handles the wrap at 2^32', () => {
    const stream = createTcpStream()
    stream.push(0xfffffffe, bytes(1, 2)) // covers 0xFFFFFFFE and 0xFFFFFFFF
    expect(out(stream.push(0, bytes(3, 4)))).toEqual({ bytes: [3, 4], gap: false })
    expect(out(stream.push(2, bytes(5)))).toEqual({ bytes: [5], gap: false })
  })

  it('treats a retransmission across the wrap as already delivered', () => {
    const stream = createTcpStream()
    stream.push(0xffffff00, bytes(...new Array<number>(256).fill(7))) // wraps to 0
    expect(out(stream.push(0xffffff00, bytes(7, 7)))).toEqual({ bytes: [], gap: false })
  })

  it('starts again from the next segment after a reset', () => {
    const stream = createTcpStream()
    stream.push(100, bytes(1))
    stream.push(500, bytes(9)) // held, far ahead
    expect(stream.pendingSegments).toBe(1)

    stream.reset()
    expect(stream.pendingSegments).toBe(0)
    expect(out(stream.push(9000, bytes(4, 5)))).toEqual({ bytes: [4, 5], gap: false })
  })
})
