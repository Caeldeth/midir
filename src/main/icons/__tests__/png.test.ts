import { inflateSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { encodePng } from '../png'

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10]

/** Read a big-endian uint32 at `offset`. */
function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset)
}

describe('encodePng', () => {
  it('writes the PNG signature and an IHDR with the right size', () => {
    const width = 3
    const height = 2
    const rgba = new Uint8Array(width * height * 4).fill(255)
    const png = encodePng(rgba, width, height)

    expect(Array.from(png.subarray(0, 8))).toEqual(SIGNATURE)
    // IHDR length is 13, then the type "IHDR", then width and height.
    expect(u32(png, 8)).toBe(13)
    expect(String.fromCharCode(...png.subarray(12, 16))).toBe('IHDR')
    expect(u32(png, 16)).toBe(width)
    expect(u32(png, 20)).toBe(height)
    // Bit depth 8, colour type 6 (RGBA).
    expect(png[24]).toBe(8)
    expect(png[25]).toBe(6)
  })

  it('deflates the pixels with a filter byte on each scanline', () => {
    const width = 2
    const height = 2
    const rgba = Uint8Array.from([
      // row 0
      10, 20, 30, 40, 50, 60, 70, 80,
      // row 1
      90, 100, 110, 120, 130, 140, 150, 160
    ])
    const png = encodePng(rgba, width, height)

    // Find the IDAT chunk and inflate it.
    const marker = 'IDAT'
    let at = -1
    for (let i = 8; i < png.length - 4; i++) {
      if (String.fromCharCode(png[i], png[i + 1], png[i + 2], png[i + 3]) === marker) {
        at = i
        break
      }
    }
    expect(at).toBeGreaterThan(0)
    const length = u32(png, at - 4)
    const idat = png.subarray(at + 4, at + 4 + length)
    const raw = inflateSync(idat)

    // (width*4 + 1) bytes per row: one filter byte then the pixels, filter 0.
    const stride = width * 4
    expect(raw.length).toBe((stride + 1) * height)
    expect(raw[0]).toBe(0)
    expect(Array.from(raw.subarray(1, 1 + stride))).toEqual([10, 20, 30, 40, 50, 60, 70, 80])
    expect(raw[stride + 1]).toBe(0)
    expect(Array.from(raw.subarray(stride + 2, stride + 2 + stride))).toEqual([
      90, 100, 110, 120, 130, 140, 150, 160
    ])
  })

  it('accepts a Uint8ClampedArray, the shape renderEpf returns', () => {
    const png = encodePng(new Uint8ClampedArray(4), 1, 1)
    expect(Array.from(png.subarray(0, 8))).toEqual(SIGNATURE)
  })
})
