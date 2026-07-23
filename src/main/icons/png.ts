// A minimal PNG encoder for one rendered icon.
//
// It takes a straight-alpha RGBA buffer, the shape dalib-ts `renderEpf` returns,
// and writes a 8-bit RGBA PNG. Node's zlib does the compression. The encoder is
// pure and testable in the node project, so the icon path needs no Electron and
// no game files to prove out.

import { deflateSync } from 'node:zlib'

/** The 8-byte PNG signature. */
const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

/** The CRC-32 table, built once. This is the standard zlib/PNG CRC-32. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Assemble one PNG chunk: length, type, data, and the CRC of type + data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = Uint8Array.from([0, 1, 2, 3].map((i) => type.charCodeAt(i)))
  const out = new Uint8Array(12 + data.length)
  const view = new DataView(out.buffer)
  view.setUint32(0, data.length)
  out.set(typeBytes, 4)
  out.set(data, 8)
  const crcInput = new Uint8Array(4 + data.length)
  crcInput.set(typeBytes, 0)
  crcInput.set(data, 4)
  view.setUint32(8 + data.length, crc32(crcInput))
  return out
}

/**
 * Encode a straight-alpha RGBA buffer as an 8-bit RGBA PNG.
 *
 * `data` is row-major `[r, g, b, a, ...]` and must be `width * height * 4` bytes.
 * Each scanline is written with filter type 0 (none), which keeps the encoder
 * small; the icons are tiny, so the size cost is not worth a filter search.
 */
export function encodePng(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number
): Uint8Array {
  const ihdr = new Uint8Array(13)
  const ihdrView = new DataView(ihdr.buffer)
  ihdrView.setUint32(0, width)
  ihdrView.setUint32(4, height)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // One filter byte (0 = none) in front of each scanline.
  const stride = width * 4
  const raw = new Uint8Array((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    raw.set(data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1)
  }

  const idat = deflateSync(raw)

  const chunks = [chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]
  const total = SIGNATURE.length + chunks.reduce((sum, c) => sum + c.length, 0)
  const png = new Uint8Array(total)
  png.set(SIGNATURE, 0)
  let offset = SIGNATURE.length
  for (const c of chunks) {
    png.set(c, offset)
    offset += c.length
  }
  return png
}
