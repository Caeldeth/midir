import { describe, expect, it } from 'vitest'
import {
  ITEMS_PER_FILE,
  iconCacheKey,
  itemSheetFor,
  itemSheetName,
  itemSpriteId
} from '../itemSprite'

describe('item sprite arithmetic', () => {
  it('keeps 266 items per file', () => {
    expect(ITEMS_PER_FILE).toBe(266)
  })

  it('maps id 1 to the first frame of the first sheet', () => {
    expect(itemSheetFor(1)).toEqual({ fileId: 1, frameId: 0 })
    expect(itemSheetName(1)).toBe('item001.epf')
  })

  it('maps id 266 to the last frame of the first sheet', () => {
    expect(itemSheetFor(266)).toEqual({ fileId: 1, frameId: 265 })
  })

  it('maps id 267 to the first frame of the second sheet', () => {
    expect(itemSheetFor(267)).toEqual({ fileId: 2, frameId: 0 })
    expect(itemSheetName(2)).toBe('item002.epf')
  })

  it('pads the sheet number to three digits', () => {
    expect(itemSheetName(54)).toBe('item054.epf')
  })

  it('has no icon for id 0', () => {
    expect(itemSheetFor(0)).toBeNull()
  })

  it('strips the 0x8000 display flag', () => {
    // 1 with the flag set is still item 1.
    expect(itemSpriteId(0x8000 | 1)).toBe(1)
    expect(itemSheetFor(0x8000 | 1)).toEqual(itemSheetFor(1))
    // 0x8000 alone masks to 0, which has no icon.
    expect(itemSheetFor(0x8000)).toBeNull()
  })

  it('keys the cache by masked sprite and colour', () => {
    // The flag never changes the key.
    expect(iconCacheKey(0x8000 | 5, 0)).toBe(iconCacheKey(5, 0))
    // Two colours of one sprite are two keys.
    expect(iconCacheKey(5, 0)).not.toBe(iconCacheKey(5, 3))
    expect(iconCacheKey(5, 3)).toBe('5:3')
  })
})
