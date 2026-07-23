import { describe, expect, it } from 'vitest'
import { BANK_WITHDRAW_PURSUIT, decodeBankContents } from '../decode/dialog'

/**
 * The bodies here are built to the shape three live retail captures pinned,
 * with invented item names. The real dialogs name a player's actual holdings,
 * and this repository is public.
 */

function string8(text: string): number[] {
  return [text.length, ...[...text].map((c) => c.charCodeAt(0))]
}

function string16(text: string): number[] {
  return [text.length >> 8, text.length & 0xff, ...[...text].map((c) => c.charCodeAt(0))]
}

function u16(value: number): number[] {
  return [value >> 8, value & 0xff]
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]
}

interface Row {
  sprite: number
  color?: number
  count: number
  name: string
  description?: string
}

interface MenuOptions {
  menuType?: number
  pursuit?: number
  sourceId?: number
  npcName?: string
  text?: string
  rows?: Row[]
  /** Bytes appended after the rows, to prove a long body is accepted. */
  trailing?: number[]
}

/** Build one SScreenMenu 0x2F body, opcode first. */
function screenMenu(options: MenuOptions = {}): Uint8Array {
  const rows = options.rows ?? []
  return Uint8Array.from([
    0x2f,
    options.menuType ?? 4,
    0x01, // entity type
    ...u32(options.sourceId ?? 0x1f6f),
    0x00, // read and discarded
    ...u16(0x4038), // NPC sprite
    0x00, // NPC colour
    0x01,
    ...u16(0x4038),
    0x00, // read and discarded: unknown, sprite2, colour2
    0x00, // illustration index
    ...string8(options.npcName ?? 'Antonio'),
    ...string16(options.text ?? 'Here is what you have deposited with me previously. '),
    ...u16(options.pursuit ?? BANK_WITHDRAW_PURSUIT),
    ...u16(rows.length),
    ...rows.flatMap((row) => [
      ...u16(row.sprite),
      row.color ?? 0,
      ...u32(row.count),
      ...string8(row.name),
      ...string8(row.description ?? ' ')
    ]),
    ...(options.trailing ?? [])
  ])
}

const ROWS: Row[] = [
  { sprite: 0x8053, count: 4, name: 'Bent Crux' },
  { sprite: 0x876a, count: 3, name: 'Jeweled Dark Belt' },
  { sprite: 0x844a, count: 2, name: 'Wolf Claw' }
]

describe('decodeBankContents', () => {
  it('reads the banker and every item it holds', () => {
    const decoded = decodeBankContents(screenMenu({ rows: ROWS, npcName: 'Drave' }))

    expect(decoded).not.toBeNull()
    expect(decoded).toMatchObject({ kind: 'bankContents', npcName: 'Drave', sourceId: 0x1f6f })
    expect(decoded!.items).toEqual([
      { name: 'Bent Crux', sprite: 0x8053, color: 0, count: 4 },
      { name: 'Jeweled Dark Belt', sprite: 0x876a, color: 0, count: 3 },
      { name: 'Wolf Claw', sprite: 0x844a, color: 0, count: 2 }
    ])
  })

  it('reads the row count as a quantity, not a price', () => {
    // Both protocol sources call this field a cost. Three live bank captures
    // show ordinary items at 1 to 10, against a single shop row at 8300.
    const decoded = decodeBankContents(
      screenMenu({ rows: [{ sprite: 0x87ee, count: 10, name: 'Andor Aiquilon' }] })
    )
    expect(decoded!.items[0]!.count).toBe(10)
  })

  it('keeps a bank with no rows, which is not the same as an unread one', () => {
    // The server does not send this shape today, but a list that arrives and
    // says nothing is a read bank. Only silence means unread, and silence
    // never reaches this decoder.
    const decoded = decodeBankContents(screenMenu({ rows: [] }))
    expect(decoded).not.toBeNull()
    expect(decoded!.items).toEqual([])
  })

  it('ignores a shop list, which is the same opcode and menu type', () => {
    // The control capture: a buy list from the same NPC as a bank, differing
    // only in the pursuit id.
    const shop = screenMenu({
      pursuit: 0x4a,
      text: 'Perhaps I can offer you something you are looking for? ',
      rows: [
        {
          sprite: 0x807c,
          count: 8300,
          name: 'Mystic Gown',
          description: 'Female Priest Lev11 (AC -17), Wt 5'
        }
      ]
    })
    expect(decodeBankContents(shop)).toBeNull()
  })

  it('ignores an ordinary conversation', () => {
    // Every NPC in the game uses this opcode. A dialog that is not an item
    // list is the normal case, not a failure.
    expect(decodeBankContents(screenMenu({ menuType: 0 }))).toBeNull()
    expect(decodeBankContents(screenMenu({ menuType: 2 }))).toBeNull()
    expect(decodeBankContents(screenMenu({ menuType: 5 }))).toBeNull()
  })

  it('reads menu type 10, which the client treats as the same list', () => {
    const decoded = decodeBankContents(screenMenu({ menuType: 10, rows: ROWS }))
    expect(decoded!.items).toHaveLength(3)
  })

  it('accepts a body longer than the fields it reads', () => {
    // The retail parsers stop at the last field they read. Trailing bytes are
    // not fields.
    const decoded = decodeBankContents(screenMenu({ rows: ROWS, trailing: [0xaa, 0xbb, 0xcc] }))
    expect(decoded!.items).toHaveLength(3)
  })

  it('throws when the body stops in the middle of a row', () => {
    // A truncated list must fail loudly rather than report a short bank, which
    // would read as the player having withdrawn everything after it.
    const full = screenMenu({ rows: ROWS })
    expect(() => decodeBankContents(full.slice(0, full.length - 6))).toThrow(RangeError)
  })
})
