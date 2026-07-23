import { describe, expect, it } from 'vitest'
import { createFrameReader, FRAME_MARKER } from '../frame'

/** Wrap a body in the binary frame the client writes. */
function frame(body: number[]): Uint8Array {
  return Uint8Array.from([FRAME_MARKER, (body.length >> 8) & 0xff, body.length & 0xff, ...body])
}

const bodies = (frames: Uint8Array[]): number[][] => frames.map((f) => [...f])

describe('createFrameReader', () => {
  it('returns one complete frame', () => {
    const reader = createFrameReader()
    expect(bodies(reader.push(frame([0x08, 0x20, 0x01])))).toEqual([[0x08, 0x20, 0x01]])
    expect(reader.pendingBytes).toBe(0)
    expect(reader.droppedBytes).toBe(0)
  })

  it('returns several frames from one chunk', () => {
    const reader = createFrameReader()
    const chunk = new Uint8Array([...frame([0x0f, 0x01]), ...frame([0x10, 0x02]), ...frame([0x08])])
    expect(bodies(reader.push(chunk))).toEqual([[0x0f, 0x01], [0x10, 0x02], [0x08]])
  })

  it('joins a frame that arrives one byte at a time', () => {
    const reader = createFrameReader()
    const whole = frame([0x39, 0x01, 0x02, 0x03, 0x04])
    const collected: Uint8Array[] = []
    for (const byte of whole) collected.push(...reader.push(Uint8Array.of(byte)))
    expect(bodies(collected)).toEqual([[0x39, 0x01, 0x02, 0x03, 0x04]])
  })

  it('holds a partial tail and completes it on the next chunk', () => {
    const reader = createFrameReader()
    const whole = frame([0x33, 0xaa, 0xbb, 0xcc])
    expect(reader.push(whole.slice(0, 4))).toEqual([])
    expect(reader.pendingBytes).toBe(4)
    expect(bodies(reader.push(whole.slice(4)))).toEqual([[0x33, 0xaa, 0xbb, 0xcc]])
    expect(reader.pendingBytes).toBe(0)
  })

  it('splits a chunk that holds one frame and the head of the next', () => {
    const reader = createFrameReader()
    const first = frame([0x0f, 0x01])
    const second = frame([0x10, 0x02, 0x03])
    const chunk = new Uint8Array([...first, ...second.slice(0, 3)])
    expect(bodies(reader.push(chunk))).toEqual([[0x0f, 0x01]])
    expect(bodies(reader.push(second.slice(3)))).toEqual([[0x10, 0x02, 0x03]])
  })

  it('drops leading rubbish and resynchronises on the next marker', () => {
    const reader = createFrameReader()
    const chunk = new Uint8Array([0x01, 0x02, 0x03, ...frame([0x08, 0x20])])
    expect(bodies(reader.push(chunk))).toEqual([[0x08, 0x20]])
    expect(reader.droppedBytes).toBe(3)
  })

  it('steps past a false marker whose length field is zero', () => {
    const reader = createFrameReader()
    const chunk = new Uint8Array([FRAME_MARKER, 0x00, 0x00, ...frame([0x08])])
    expect(bodies(reader.push(chunk))).toEqual([[0x08]])
    expect(reader.droppedBytes).toBeGreaterThan(0)
  })

  it('keeps a body whose first byte is itself a marker', () => {
    const reader = createFrameReader()
    expect(bodies(reader.push(frame([FRAME_MARKER, FRAME_MARKER])))).toEqual([
      [FRAME_MARKER, FRAME_MARKER]
    ])
  })

  it('reads a maximum-length body', () => {
    const reader = createFrameReader()
    const body = Array.from({ length: 0xffff }, (_, i) => i & 0xff)
    const frames = reader.push(frame(body))
    expect(frames).toHaveLength(1)
    expect(frames[0]).toHaveLength(0xffff)
  })

  it('returns nothing for an empty chunk', () => {
    const reader = createFrameReader()
    expect(reader.push(new Uint8Array(0))).toEqual([])
  })

  it('forgets the buffered tail on reset', () => {
    const reader = createFrameReader()
    reader.push(frame([0x08, 0x01, 0x02]).slice(0, 4))
    expect(reader.pendingBytes).toBe(4)
    reader.reset()
    expect(reader.pendingBytes).toBe(0)
  })

  it('returns bodies that do not alias the input chunk', () => {
    const reader = createFrameReader()
    const chunk = frame([0x08, 0x01])
    const [body] = reader.push(chunk)
    chunk.fill(0)
    expect([...body!]).toEqual([0x08, 0x01])
  })
})
