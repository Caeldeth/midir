import { describe, expect, it } from 'vitest'
import {
  decodeAddWorldObjects,
  decodeCreatureMove,
  decodeRemoveWorldObject,
  NPC_TYPE
} from '../decode/world'
import { decodeServerPacket, hasServerDecoder } from '../decode'
import { ServerOpcode } from '../opcodes'

/**
 * The three packets that put things on the map, move them, and take them
 * away (WP35). The 0x07 layout is the document repo's, binary-verified; the
 * decoders were run over every recording on disk (3760 SDrawObjects, 6101
 * objects, batches of up to 152, 10955 moves, 4310 removes) with no failure,
 * and the NPC names and tiles in them matched the errands' known tiles.
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

/** One creature body: `[u16 x][u16 y][u32 id][u16 sprite][4 anim][dir][unused][type]` and a name for an NPC. */
function creature(
  x: number,
  y: number,
  id: number,
  sprite: number,
  direction: number,
  type: number,
  name?: string
): number[] {
  const body = [
    x >> 8,
    x & 0xff,
    y >> 8,
    y & 0xff,
    (id >>> 24) & 0xff,
    (id >>> 16) & 0xff,
    (id >>> 8) & 0xff,
    id & 0xff,
    (0x4000 + sprite) >> 8,
    (0x4000 + sprite) & 0xff,
    0,
    0,
    0,
    0,
    direction,
    0,
    type
  ]
  if (name !== undefined) body.push(name.length, ...[...name].map((c) => c.charCodeAt(0)))
  return body
}

function item(x: number, y: number, id: number, sprite: number, color: number): number[] {
  return [
    x >> 8,
    x & 0xff,
    y >> 8,
    y & 0xff,
    0,
    0,
    (id >> 8) & 0xff,
    id & 0xff,
    (0x8000 + sprite) >> 8,
    (0x8000 + sprite) & 0xff,
    color,
    0,
    0
  ]
}

describe('decodeAddWorldObjects 0x07', () => {
  it('reads an NPC with its name, a solid monster, and a walk-through monster', () => {
    const packet = decodeAddWorldObjects(
      bytes(
        0x07,
        0x00,
        0x03,
        ...creature(3, 4, 0x1234, 56, 2, NPC_TYPE, 'Antonio'),
        ...creature(10, 11, 0x99, 300, 0, 0),
        ...creature(12, 11, 0x9a, 301, 1, 1)
      )
    )
    expect(packet).toEqual({
      kind: 'addWorldObjects',
      objects: [
        {
          kind: 'creature',
          id: 0x1234,
          x: 3,
          y: 4,
          sprite: 56,
          direction: 2,
          type: 2,
          name: 'Antonio'
        },
        { kind: 'creature', id: 0x99, x: 10, y: 11, sprite: 300, direction: 0, type: 0 },
        { kind: 'creature', id: 0x9a, x: 12, y: 11, sprite: 301, direction: 1, type: 1 }
      ]
    })
  })

  it('reads an item on the ground, and keeps a dropped sprite range as ignored', () => {
    const packet = decodeAddWorldObjects(
      bytes(
        0x07,
        0x00,
        0x02,
        ...item(7, 8, 42, 100, 3),
        0,
        1,
        0,
        1,
        0,
        0,
        0,
        43,
        0xc1,
        0x00,
        0,
        0,
        0
      )
    )
    expect(packet.objects).toEqual([
      { kind: 'item', id: 42, x: 7, y: 8, sprite: 100, color: 3 },
      { kind: 'ignored', id: 43, x: 1, y: 1, sprite: 0xc100 }
    ])
  })

  it('reads a batch whose count says more than one, in order', () => {
    // Retail bundles many objects in one packet; the loop must not stop at one.
    const many = Array.from({ length: 5 }, (_, i) => creature(i, 0, 100 + i, 1, 0, 0)).flat()
    const packet = decodeAddWorldObjects(bytes(0x07, 0x00, 0x05, ...many))
    expect(packet.objects.map((o) => o.id)).toEqual([100, 101, 102, 103, 104])
  })

  it('throws on a body that ends inside an object, so the session reports it unreadable', () => {
    expect(() => decodeAddWorldObjects(bytes(0x07, 0x00, 0x01, 0, 1, 0, 1))).toThrow()
  })

  it('is registered for the server opcode', () => {
    expect(hasServerDecoder(ServerOpcode.AddWorldObjects)).toBe(true)
    const decoded = decodeServerPacket(bytes(0x07, 0x00, 0x01, ...creature(1, 2, 5, 9, 3, 0)))
    expect(decoded?.kind).toBe('addWorldObjects')
  })
})

describe('decodeCreatureMove 0x0C', () => {
  it('reads the id, the source tile, and the direction', () => {
    const packet = decodeCreatureMove(
      bytes(0x0c, 0x00, 0x01, 0x02, 0x03, 0x00, 0x2b, 0x00, 0x28, 0x01, 0x00)
    )
    expect(packet).toEqual({
      kind: 'creatureMove',
      id: 0x010203,
      fromX: 43,
      fromY: 40,
      direction: 1
    })
    expect(hasServerDecoder(ServerOpcode.CreatureMove)).toBe(true)
  })
})

describe('decodeRemoveWorldObject 0x0E', () => {
  it('reads the id', () => {
    expect(decodeRemoveWorldObject(bytes(0x0e, 0x00, 0x00, 0x12, 0x34))).toEqual({
      kind: 'removeWorldObject',
      id: 0x1234
    })
    expect(hasServerDecoder(ServerOpcode.RemoveWorldObject)).toBe(true)
  })
})
