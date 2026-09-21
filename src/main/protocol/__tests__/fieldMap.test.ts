import { describe, expect, it } from 'vitest'
import { decodeFieldMap, decodeFieldMapClick } from '../decode/fieldMap'
import { decodeClientPacket, decodeServerPacket } from '../decode'

/**
 * The 0x2E body here is built to the layout both protocol sources pin. Its
 * Loures point carries the values darkages-741-re read from a retail capture
 * (screen 344 x 250, map 0x0BC4, tile 14 x 10), and the 0x3F body is the exact
 * client bytes that capture shows for the click on it. So the test proves the
 * round trip: the point the decoder reads is the point the click echoes.
 */

function string8(text: string): number[] {
  return [text.length, ...[...text].map((c) => c.charCodeAt(0))]
}

function u16(value: number): number[] {
  return [value >> 8, value & 0xff]
}

interface Point {
  screenX: number
  screenY: number
  name: string
  checksum?: number
  mapId: number
  x: number
  y: number
}

function point(p: Point): number[] {
  return [
    ...u16(p.screenX),
    ...u16(p.screenY),
    ...string8(p.name),
    ...u16(p.checksum ?? 0),
    ...u16(p.mapId),
    ...u16(p.x),
    ...u16(p.y)
  ]
}

/** Build one SFieldMap 0x2E body, opcode first. */
function fieldMap(points: Point[], currentIndex = 0, trailing: number[] = []): Uint8Array {
  return new Uint8Array([
    0x2e,
    ...string8('field001'),
    points.length,
    currentIndex,
    ...points.flatMap(point),
    ...trailing
  ])
}

const MILETH = { screenX: 218, screenY: 99, name: 'Mileth', mapId: 3006, x: 15, y: 8 }
const LOURES = { screenX: 344, screenY: 250, name: 'Loures', mapId: 0x0bc4, x: 14, y: 10 }
const ABEL = { screenX: 306, screenY: 77, name: 'Abel', mapId: 3014, x: 15, y: 13 }

/** The retail click on Loures, byte for byte: 3F 00 00 0B C4 00 0E 00 0A. */
const LOURES_CLICK = new Uint8Array([0x3f, 0x00, 0x00, 0x0b, 0xc4, 0x00, 0x0e, 0x00, 0x0a])

describe('decodeFieldMap', () => {
  it('reads the field name, the marker index, and every point in order', () => {
    const decoded = decodeFieldMap(fieldMap([MILETH, LOURES, ABEL], 1))
    expect(decoded.kind).toBe('fieldMap')
    expect(decoded.fieldName).toBe('field001')
    expect(decoded.currentIndex).toBe(1)
    expect(decoded.points).toEqual([
      { ...MILETH, checksum: 0 },
      { ...LOURES, checksum: 0 },
      { ...ABEL, checksum: 0 }
    ])
  })

  it('accepts a body longer than its fields', () => {
    // Trailing bytes are not fields. The retail capture ends in one such zero.
    const decoded = decodeFieldMap(fieldMap([LOURES], 0, [0x00]))
    expect(decoded.points).toHaveLength(1)
  })

  it('reads an empty map', () => {
    const decoded = decodeFieldMap(fieldMap([]))
    expect(decoded.points).toEqual([])
  })

  it('is registered for server opcode 0x2E', () => {
    expect(decodeServerPacket(fieldMap([LOURES]))?.kind).toBe('fieldMap')
  })
})

describe('decodeFieldMapClick', () => {
  it('reads the four echoed words of the retail click', () => {
    expect(decodeFieldMapClick(LOURES_CLICK)).toEqual({
      kind: 'fieldMapClick',
      checksum: 0,
      mapId: 0x0bc4,
      x: 14,
      y: 10
    })
  })

  it('echoes the point the map carried', () => {
    // The round trip: the click's words are the point's words, unchanged.
    const map = decodeFieldMap(fieldMap([MILETH, LOURES, ABEL], 1))
    const click = decodeFieldMapClick(LOURES_CLICK)
    const chosen = map.points.find((p) => p.mapId === click.mapId)
    expect(chosen?.name).toBe('Loures')
    expect([chosen?.checksum, chosen?.x, chosen?.y]).toEqual([click.checksum, click.x, click.y])
  })

  it('is registered for client opcode 0x3F', () => {
    expect(decodeClientPacket(LOURES_CLICK)?.kind).toBe('fieldMapClick')
  })
})
