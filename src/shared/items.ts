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

/**
 * Where a held item sits.
 *
 * `bank` is different in kind from the other two. Equipment and inventory
 * arrive unprompted as the player plays, so they are as fresh as the record.
 * The bank arrives only when the player opens it at a banker, so a bank
 * holding can be months older than the character record that carries it. Every
 * surface must show its own age.
 */
export type ItemPlace = 'equipment' | 'inventory' | 'bank'

/** One item, held by one character, in one slot. */
export interface ItemHolding {
  character: string
  place: ItemPlace
  /**
   * An EquipmentSlot value for equipment, or an inventory slot number. The
   * bank has no slots, so a bank holding uses its position in the list.
   */
  slot: number
  /** How many are in this slot. It is 1 for an item that cannot stack. */
  count: number
  /** The dye colour index. */
  color: number
  durability: number
  maxDurability: number
  /**
   * When this holding was read. Equipment and inventory carry the time the
   * character was last seen; a bank holding carries the time the bank was
   * opened, which is usually much earlier.
   */
  lastSeenMs: number
}

/**
 * Every holding of one item by one character.
 *
 * A character can hold the same item in several slots: two of a stack in the
 * pack and one worn. The list answers "which of my characters has this?", so
 * one character is one answer. The slots stay on the holder, and the interface
 * shows them when the user asks for the detail.
 */
export interface ItemHolder {
  character: string
  /** The total this character holds, across every slot. */
  totalCount: number
  /** True when the character wears at least one. */
  equipped: boolean
  /** True when at least one of these is in the bank rather than on the character. */
  banked: boolean
  /** When Midir last read this character. The total is true as of then. */
  lastSeenMs: number
  /** Each slot the character holds it in, equipment first. */
  holdings: ItemHolding[]
}

/** Every holding of one item, across every character. */
export interface ItemIndexEntry {
  /** The item name, as the server wrote it. This is the grouping key. */
  name: string
  /** The item's sprite id, from the first holding seen. */
  sprite: number
  /** The total across every character. */
  totalCount: number
  /** The most recent time any holder was seen. */
  lastSeenMs: number
  /** One entry for each character that holds the item, in name order. */
  holders: ItemHolder[]
}

/** Worn first, then carried, then stored. */
const PLACE_ORDER: Record<ItemPlace, number> = { equipment: 0, inventory: 1, bank: 2 }

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
 * Group one item's holdings by the character that holds them.
 *
 * The holdings arrive sorted by character, then equipment before inventory,
 * then slot, so one pass keeps that order inside each holder as well.
 */
function groupByCharacter(holdings: readonly ItemHolding[]): ItemHolder[] {
  const holders: ItemHolder[] = []
  for (const holding of holdings) {
    const last = holders[holders.length - 1]
    if (last !== undefined && last.character === holding.character) {
      last.totalCount += holding.count
      last.equipped = last.equipped || holding.place === 'equipment'
      last.banked = last.banked || holding.place === 'bank'
      // The holder is as fresh as its freshest holding. A bank read weeks ago
      // must not make a character look stale when they were seen today.
      last.lastSeenMs = Math.max(last.lastSeenMs, holding.lastSeenMs)
      last.holdings.push(holding)
      continue
    }
    holders.push({
      character: holding.character,
      totalCount: holding.count,
      equipped: holding.place === 'equipment',
      banked: holding.place === 'bank',
      lastSeenMs: holding.lastSeenMs,
      holdings: [holding]
    })
  }
  return holders
}

/**
 * Build the index from every character record.
 *
 * Items are grouped by name, because the name is what the player searches for.
 * Two dye colours of the same item are one entry; the colour is kept on each
 * holding, so nothing is lost.
 */
type Grouped = Map<string, { sprite: number; holdings: ItemHolding[] }>

/** File one holding under its item name, starting the group when it is new. */
function add(grouped: Grouped, name: string, sprite: number, holding: ItemHolding): void {
  const group = grouped.get(name)
  if (group === undefined) grouped.set(name, { sprite, holdings: [holding] })
  else group.holdings.push(holding)
}

export function buildItemIndex(records: readonly CharacterRecord[]): ItemIndexEntry[] {
  const grouped: Grouped = new Map()

  for (const record of records) {
    // The place and its slots are one choice. A bank adds a row here.
    for (const [place, slots] of [
      ['equipment', record.equipment],
      ['inventory', record.inventory]
    ] as const) {
      for (const [slot, item] of Object.entries(slots)) {
        add(grouped, item.name, item.sprite, {
          character: record.name,
          place,
          slot: Number(slot),
          count: countOf(item.count),
          color: item.color,
          durability: item.durability,
          maxDurability: item.maxDurability,
          lastSeenMs: record.lastSeenMs
        })
      }
    }

    // The bank, when the player has opened one. It carries the time it was
    // read, not the time the character was seen, because the two can be far
    // apart. A record with no bank has never had one read; it is not empty.
    if (record.bank !== undefined) {
      record.bank.items.forEach((item, index) => {
        add(grouped, item.name, item.sprite, {
          character: record.name,
          place: 'bank',
          slot: index,
          count: countOf(item.count),
          color: item.color,
          durability: 0,
          maxDurability: 0,
          lastSeenMs: record.bank!.readAtMs
        })
      })
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
      lastSeenMs: holdings.reduce((latest, holding) => Math.max(latest, holding.lastSeenMs), 0),
      holders: groupByCharacter(holdings)
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
    for (const holder of entry.holders) characters.add(holder.character)
  }
  return { itemCount: entries.length, totalCount, characterCount: characters.size }
}
