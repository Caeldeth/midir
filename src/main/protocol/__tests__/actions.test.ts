import { describe, expect, it } from 'vitest'
import { decodeUseItem, decodeUseSkill, decodeUseSpell } from '../decode/actions'
import { decodeClientPacket, hasClientDecoder } from '../decode'
import { ClientOpcode } from '../opcodes'

/**
 * The client's spell, item, and skill use (WP29). The spell and item bodies
 * are from live retail captures; no recording holds a skill use, so that one
 * is built to the document repo's page.
 */

const bytes = (...values: number[]): Uint8Array => Uint8Array.from(values)

describe('the use packets', () => {
  it('reads the spellbook slot and ignores the trailing bytes', () => {
    expect(decodeUseSpell(bytes(0x0f, 0x1b, 0x00, 0x0f))).toEqual({ kind: 'useSpell', slot: 27 })
    // A targeted cast carries a serial and a point after the slot; not read.
    expect(
      decodeUseSpell(bytes(0x0f, 0x02, 0x00, 0x01, 0x02, 0x03, 0x00, 0x05, 0x00, 0x06))
    ).toEqual({ kind: 'useSpell', slot: 2 })
  })

  it('reads the inventory slot of an item use', () => {
    expect(decodeUseItem(bytes(0x1c, 0x0c, 0x00, 0x1c))).toEqual({ kind: 'useItem', slot: 12 })
  })

  it('reads the skillbook slot of a skill use', () => {
    expect(decodeUseSkill(bytes(0x3e, 0x03))).toEqual({ kind: 'useSkill', slot: 3 })
  })

  it('is reached through the client dispatch', () => {
    for (const opcode of [ClientOpcode.UseSpell, ClientOpcode.UseItem, ClientOpcode.UseSkill]) {
      expect(hasClientDecoder(opcode)).toBe(true)
    }
    expect(decodeClientPacket(bytes(0x1c, 0x06, 0x00, 0x1c))).toEqual({ kind: 'useItem', slot: 6 })
  })
})
