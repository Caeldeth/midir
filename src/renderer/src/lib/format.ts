import {
  CHARACTER_CLASS_NAMES,
  ELEMENT_NAMES,
  EQUIPMENT_SLOT_NAMES,
  LEGEND_ICON_NAMES,
  NATION_NAMES
} from '@shared/labels'

/** Formatting helpers for the character sheet. */

const NUMBER = new Intl.NumberFormat()

/** A number with thousands separators, as the client shows it. */
export function formatNumber(value: number): string {
  return NUMBER.format(value)
}

/** A signed number, so an armour class of -10 reads as an improvement. */
export function formatSigned(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value)
}

/** The label for a value, or a readable fallback that keeps the number. */
function label(names: Readonly<Record<number, string>>, value: number): string {
  return names[value] ?? `Unknown (${value})`
}

export const characterClassName = (value: number): string => label(CHARACTER_CLASS_NAMES, value)
export const nationName = (value: number): string => label(NATION_NAMES, value)
export const equipmentSlotName = (value: number): string => label(EQUIPMENT_SLOT_NAMES, value)
export const legendIconName = (value: number): string => label(LEGEND_ICON_NAMES, value)
export const elementName = (value: number): string => label(ELEMENT_NAMES, value)

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * How long ago something happened, in plain words.
 *
 * The character list needs this to say how stale a record is. A count that was
 * true two weeks ago must not read as if it were true now.
 */
export function formatAgo(timestampMs: number, nowMs: number = Date.now()): string {
  const elapsed = nowMs - timestampMs
  if (elapsed < MINUTE) return 'just now'
  if (elapsed < HOUR) {
    const minutes = Math.floor(elapsed / MINUTE)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  }
  if (elapsed < DAY) {
    const hours = Math.floor(elapsed / HOUR)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(elapsed / DAY)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** A durability as "current / maximum", or an empty string when it has none. */
export function formatDurability(durability: number, maxDurability: number): string {
  if (maxDurability === 0) return ''
  return `${formatNumber(durability)} / ${formatNumber(maxDurability)}`
}
