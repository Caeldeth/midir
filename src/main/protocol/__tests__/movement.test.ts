import { describe, expect, it } from 'vitest'
import {
  DIRECTION_DELTA,
  decodeMapInfo,
  decodeUserMove,
  decodeUserPosition,
  decodeWalk,
  isWalkDirection
} from '../decode/movement'
import {
  decodeClientPacket,
  decodeServerPacket,
  hasClientDecoder,
  hasServerDecoder
} from '../decode'
import { ClientOpcode, ServerOpcode } from '../opcodes'

/**
 * Every byte string here is from a live retail capture, so the tests pin the
 * decoders to what the 7.41 client actually sends, not to the docs alone.
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe('decodeUserPosition 0x04', () => {
  it('reads big-endian x and y from a live capture', () => {
    // 04 00 2b 00 28 ... is x=43, y=40. A little-endian read would give 0x2b00.
    const packet = decodeUserPosition(bytes(0x04, 0x00, 0x2b, 0x00, 0x28, 0x00, 0x0b, 0x00, 0x0b))
    expect(packet).toEqual({ kind: 'userPosition', x: 43, y: 40 })
  })

  it('ignores the trailing viewport words, whatever the body length', () => {
    // Live bodies came in at 9 and 10 bytes; both must read the same tile.
    const nine = decodeUserPosition(bytes(0x04, 0x00, 0x05, 0x00, 0x08, 0x00, 0x0b, 0x00, 0x0b))
    const ten = decodeUserPosition(
      bytes(0x04, 0x00, 0x05, 0x00, 0x08, 0x00, 0x0b, 0x00, 0x0b, 0x00)
    )
    expect(nine).toEqual({ kind: 'userPosition', x: 5, y: 8 })
    expect(ten).toEqual(nine)
  })
})

describe('decodeUserMove 0x0B', () => {
  it('reads the direction and the source tile from a live capture', () => {
    // 0b 02 00 05 00 08 00 0b 00 0b 01: dir South, from (5,8).
    const packet = decodeUserMove(
      bytes(0x0b, 0x02, 0x00, 0x05, 0x00, 0x08, 0x00, 0x0b, 0x00, 0x0b, 0x01)
    )
    expect(packet).toEqual({ kind: 'userMove', direction: 2, fromX: 5, fromY: 8 })
  })

  it('keeps a correction direction above 3 as it is', () => {
    // The reducer treats direction 4 as a no-step correction; the decoder only
    // reports it. It must not fail on the value.
    const packet = decodeUserMove(bytes(0x0b, 0x04, 0x00, 0x2b, 0x00, 0x27))
    expect(packet).toEqual({ kind: 'userMove', direction: 4, fromX: 43, fromY: 39 })
  })
})

describe('decodeMapInfo 0x15', () => {
  it('reads the id, size, and name from a live capture', () => {
    // 15 01 a6 0f 0f 00 00 00 40 56 10 "Rucesion Storage": id 422, 15 by 15.
    const body = bytes(
      0x15,
      0x01,
      0xa6, // map id 422
      0x0f, // width 15
      0x0f, // height 15
      0x00, // flags
      0x00, // reserved
      0x00,
      0x40,
      0x56, // three checksum bytes
      0x10, // name length 16
      ...[...'Rucesion Storage'].map((c) => c.charCodeAt(0))
    )
    expect(decodeMapInfo(body)).toEqual({
      kind: 'mapInfo',
      mapId: 422,
      width: 15,
      height: 15,
      flags: 0,
      name: 'Rucesion Storage'
    })
  })

  it('reads a map id above 255', () => {
    // 15 0c 07 ... "Mileth Threshold": id 0x0C07 = 3079.
    const body = bytes(
      0x15,
      0x0c,
      0x07,
      0x0e,
      0x07,
      0x00,
      0x00,
      0x00,
      0xab,
      0x00,
      0x10,
      ...[...'Mileth Threshold'].map((c) => c.charCodeAt(0))
    )
    const packet = decodeMapInfo(body)
    expect(packet.mapId).toBe(3079)
    expect(packet.name).toBe('Mileth Threshold')
  })

  it('accepts a trailing byte after the name', () => {
    const body = bytes(
      0x15,
      0x01,
      0xf2,
      0x0c,
      0x0c,
      0x00,
      0x00,
      0x00,
      0x41,
      0xdb,
      0x0c,
      ...[...'Rucesion Inn'].map((c) => c.charCodeAt(0)),
      0x00
    )
    expect(decodeMapInfo(body).name).toBe('Rucesion Inn')
  })
})

describe('decodeWalk 0x06', () => {
  it('reads the direction and step, and ignores the tail', () => {
    // 06 02 01 00 06 from a live capture: dir South, step 1.
    expect(decodeWalk(bytes(0x06, 0x02, 0x01, 0x00, 0x06))).toEqual({
      kind: 'walk',
      direction: 2,
      step: 1
    })
  })

  it('reads the rising step counter', () => {
    expect(decodeWalk(bytes(0x06, 0x00, 0x0a, 0x00, 0x06)).step).toBe(10)
  })
})

describe('the direction table', () => {
  it('steps one tile the way the client draws it', () => {
    // Checked against the walk: dir 2 raises y, dir 1 raises x, and so on.
    expect(DIRECTION_DELTA[0]).toEqual([0, -1]) // North
    expect(DIRECTION_DELTA[1]).toEqual([1, 0]) // East
    expect(DIRECTION_DELTA[2]).toEqual([0, 1]) // South
    expect(DIRECTION_DELTA[3]).toEqual([-1, 0]) // West
  })

  it('accepts only the four cardinal directions', () => {
    for (const d of [0, 1, 2, 3]) expect(isWalkDirection(d)).toBe(true)
    for (const d of [-1, 4, 255]) expect(isWalkDirection(d)).toBe(false)
  })
})

describe('the decoders are registered', () => {
  it('dispatches the server movement opcodes', () => {
    expect(hasServerDecoder(ServerOpcode.UserPosition)).toBe(true)
    expect(hasServerDecoder(ServerOpcode.Move)).toBe(true)
    expect(hasServerDecoder(ServerOpcode.MapInfo)).toBe(true)
    expect(decodeServerPacket(bytes(0x04, 0x00, 0x05, 0x00, 0x08))).toMatchObject({
      kind: 'userPosition'
    })
  })

  it('dispatches the client walk opcode', () => {
    expect(hasClientDecoder(ClientOpcode.Walk)).toBe(true)
    expect(decodeClientPacket(bytes(0x06, 0x01, 0x03))).toEqual({
      kind: 'walk',
      direction: 1,
      step: 3
    })
  })
})
