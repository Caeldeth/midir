import { describe, expect, it } from 'vitest'
import {
  characterClassName,
  elementName,
  equipmentSlotName,
  formatAgo,
  formatBytes,
  formatDurability,
  formatNumber,
  formatSigned,
  legendIconName,
  nationName,
  plural
} from '../format'

describe('formatNumber', () => {
  it('separates thousands, as the client does', () => {
    expect(formatNumber(3000000000)).toBe('3,000,000,000')
    expect(formatNumber(0)).toBe('0')
  })
})

describe('formatSigned', () => {
  it('marks a positive value and leaves a negative one alone', () => {
    expect(formatSigned(12)).toBe('+12')
    expect(formatSigned(-10)).toBe('-10')
    expect(formatSigned(0)).toBe('0')
  })
})

describe('the name tables', () => {
  it('names the values it knows', () => {
    expect(characterClassName(3)).toBe('Wizard')
    expect(nationName(4)).toBe('Mileth')
    expect(equipmentSlotName(1)).toBe('Weapon')
    expect(equipmentSlotName(18)).toBe('Accessory 3')
    expect(legendIconName(6)).toBe('Heart')
    expect(elementName(1)).toBe('Fire')
  })

  it('keeps the number when it has no name for it', () => {
    // A relabelled or unmodelled value must never disappear from the sheet.
    expect(characterClassName(9)).toBe('Unknown (9)')
    expect(nationName(2)).toBe('Unknown (2)')
    expect(equipmentSlotName(0)).toBe('Unknown (0)')
  })
})

describe('plural', () => {
  it('leaves a count of one singular', () => {
    expect(plural(1, 'item')).toBe('1 item')
  })

  it('pluralises everything else, zero included', () => {
    expect(plural(0, 'item')).toBe('0 items')
    expect(plural(3, 'character')).toBe('3 characters')
  })

  it('separates the thousands in the count', () => {
    expect(plural(12000, 'item')).toBe('12,000 items')
  })
})

describe('formatAgo', () => {
  const now = 1_000_000_000_000

  it('says just now inside the first minute', () => {
    expect(formatAgo(now - 30_000, now)).toBe('just now')
  })

  it('counts minutes, hours, and days', () => {
    expect(formatAgo(now - 60_000, now)).toBe('1 minute ago')
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 minutes ago')
    expect(formatAgo(now - 3600_000, now)).toBe('1 hour ago')
    expect(formatAgo(now - 5 * 3600_000, now)).toBe('5 hours ago')
    expect(formatAgo(now - 86_400_000, now)).toBe('1 day ago')
    expect(formatAgo(now - 14 * 86_400_000, now)).toBe('14 days ago')
  })
})

describe('formatDurability', () => {
  it('shows current over maximum', () => {
    expect(formatDurability(9500, 10000)).toBe('9,500 / 10,000')
  })

  it('shows nothing for an item that has no durability', () => {
    expect(formatDurability(0, 0)).toBe('')
  })
})

describe('formatBytes', () => {
  it('uses the largest unit that keeps the number readable', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB')
  })

  it('shows bytes as whole things', () => {
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('reads an empty or impossible size as nothing', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(-5)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})
