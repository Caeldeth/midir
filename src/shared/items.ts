// The cross-character item index. Pure data and pure functions, shared between
// main, preload, and renderer. No runtime imports from electron or node.

import type { CharacterRecord } from './character'

/**
 * The item index answers one question: "which of my characters has this?"
 *
 * It is derived, never stored. Every value comes from the character records,
 * so the index is always as fresh as the records behind it and there is no
 * second copy of the truth to keep in step.
 *
 * A record is a snapshot of the last time Midir read that character. A count
 * is therefore true "as of" that moment and never later, so every holding
 * carries the time its character was last seen. The user interface must show
 * it. A stale count read as a live one is worse than no count at all.
 */

/** Where a held item sits. */
export type ItemPlace = 'equipment' | 'inventory'

/** One item, held by one character, in one slot. */
export interface ItemHolding {
  character: string
  place: ItemPlace
  /** An EquipmentSlot value for equipment, or an inventory slot number. */
  slot: number
  /** How many are in this slot. It is 1 for an item that cannot stack. */
  count: number
  /** The dye colour index. */
  color: number
  durability: number
  maxDurability: number
  /** When Midir last read this character. The count is true as of then. */
  lastSeenMs: number
}

/** Every holding of one item, across every character. */
export interface ItemIndexEntry {
  /** The item name, as the server wrote it. This is the grouping key. */
  name: string
  /** The item's sprite id, from the first holding seen. */
  sprite: number
  /** The total across every character. */
  totalCount: number
  /** How many characters hold at least one. */
  characterCount: number
  /** The most recent time any holder was seen. */
  lastSeenMs: number
  holdings: ItemHolding[]
}

/** Equipment before inventory, so a worn item is listed first. */
const PLACE_ORDER: Record<ItemPlace, number> = { equipment: 0, inventory: 1 }

/**
 * A holding's count.
 *
 * An item that cannot stack arrives with a quantity of 1. A quantity of zero
 * for a slot the server placed an item in describes nothing, so the item is
 * counted once. That is a floor, not an estimate: the item is there.
 */
function countOf(count: number): number {
  return count > 0 ? count : 1
}

/**
 * Compare two names the way a reader expects, ignoring case.
 *
 * The collator is built once. Passing options to `localeCompare` builds a new
 * one for every comparison, which dominates the cost of a whole index build.
 */
const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base' })

function byName(left: string, right: string): number {
  return COLLATOR.compare(left, right)
}

function compareHoldings(left: ItemHolding, right: ItemHolding): number {
  const name = byName(left.character, right.character)
  if (name !== 0) return name
  const place = PLACE_ORDER[left.place] - PLACE_ORDER[right.place]
  if (place !== 0) return place
  return left.slot - right.slot
}

/**
 * Build the index from every character record.
 *
 * Items are grouped by name, because the name is what the player searches for.
 * Two dye colours of the same item are one entry; the colour is kept on each
 * holding, so nothing is lost.
 */
export function buildItemIndex(records: readonly CharacterRecord[]): ItemIndexEntry[] {
  const grouped = new Map<string, { sprite: number; holdings: ItemHolding[] }>()

  for (const record of records) {
    // The place and its slots are one choice. A bank adds a row here.
    for (const [place, slots] of [
      ['equipment', record.equipment],
      ['inventory', record.inventory]
    ] as const) {
      for (const [slot, item] of Object.entries(slots)) {
        const holding: ItemHolding = {
          character: record.name,
          place,
          slot: Number(slot),
          count: countOf(item.count),
          color: item.color,
          durability: item.durability,
          maxDurability: item.maxDurability,
          lastSeenMs: record.lastSeenMs
        }
        const group = grouped.get(item.name)
        if (group === undefined) {
          grouped.set(item.name, { sprite: item.sprite, holdings: [holding] })
        } else {
          group.holdings.push(holding)
        }
      }
    }
  }

  const entries: ItemIndexEntry[] = []
  for (const [name, group] of grouped) {
    const { holdings } = group
    holdings.sort(compareHoldings)
    entries.push({
      name,
      sprite: group.sprite,
      totalCount: holdings.reduce((sum, holding) => sum + holding.count, 0),
      characterCount: new Set(holdings.map((holding) => holding.character)).size,
      lastSeenMs: holdings.reduce((latest, holding) => Math.max(latest, holding.lastSeenMs), 0),
      holdings
    })
  }

  return entries.sort((left, right) => byName(left.name, right.name))
}

/**
 * Keep the entries whose name contains `query`.
 *
 * The match ignores case and matches anywhere in the name, so "ring" finds
 * "Small Emerald Ring". An empty query keeps everything.
 */
export function filterItems(entries: readonly ItemIndexEntry[], query: string): ItemIndexEntry[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...entries]
  return entries.filter((entry) => entry.name.toLowerCase().includes(needle))
}

/** What the index totals up to. Shown above the list. */
export interface ItemIndexSummary {
  /** How many distinct items are in the index. */
  itemCount: number
  /** How many individual items, counting a stack as its full count. */
  totalCount: number
  /** How many characters hold at least one item. */
  characterCount: number
}

export function summariseItems(entries: readonly ItemIndexEntry[]): ItemIndexSummary {
  const characters = new Set<string>()
  let totalCount = 0
  for (const entry of entries) {
    totalCount += entry.totalCount
    for (const holding of entry.holdings) characters.add(holding.character)
  }
  return { itemCount: entries.length, totalCount, characterCount: characters.size }
}
