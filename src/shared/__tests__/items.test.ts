import { describe, expect, it } from 'vitest'
import { emptyCharacter, type CharacterRecord, type ItemRef } from '../character'
import { buildItemIndex, filterItems, summariseItems } from '../items'

/** Build an item with only the fields a test cares about. */
function item(name: string, overrides: Partial<ItemRef> = {}): ItemRef {
  return {
    name,
    sprite: 1,
    color: 0,
    count: 1,
    canStack: false,
    durability: 0,
    maxDurability: 0,
    ...overrides
  }
}

interface CharacterOptions {
  lastSeenMs?: number
  inventory?: Record<number, ItemRef>
  equipment?: Record<number, ItemRef>
}

function character(name: string, options: CharacterOptions = {}): CharacterRecord {
  const record = emptyCharacter(name, options.lastSeenMs ?? 1000)
  return {
    ...record,
    lastSeenMs: options.lastSeenMs ?? 1000,
    inventory: options.inventory ?? {},
    equipment: options.equipment ?? {}
  }
}

describe('buildItemIndex', () => {
  it('is empty when nothing is recorded', () => {
    expect(buildItemIndex([])).toEqual([])
  })

  it('gathers one item held by several characters', () => {
    const index = buildItemIndex([
      character('Sabrael', { inventory: { 1: item('Stick') } }),
      character('Fintan', { inventory: { 4: item('Stick') } })
    ])

    expect(index).toHaveLength(1)
    expect(index[0]).toMatchObject({ name: 'Stick', totalCount: 2, characterCount: 2 })
    expect(index[0]!.holdings.map((holding) => holding.character)).toEqual(['Fintan', 'Sabrael'])
  })

  it('adds up a stack rather than counting the slot', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        inventory: { 1: item('Hemloch', { count: 40, canStack: true }) }
      }),
      character('Fintan', { inventory: { 2: item('Hemloch', { count: 2, canStack: true }) } })
    ])

    expect(index[0]).toMatchObject({ name: 'Hemloch', totalCount: 42, characterCount: 2 })
  })

  it('counts an item once when the server sent no quantity', () => {
    // A slot the server placed an item in holds at least one, whatever the
    // quantity field said. Zero would read as "you have none".
    const index = buildItemIndex([
      character('Sabrael', { inventory: { 1: item('Stick', { count: 0 }) } })
    ])
    expect(index[0]!.totalCount).toBe(1)
  })

  it('counts the same item in two slots of one character once per slot', () => {
    const index = buildItemIndex([
      character('Sabrael', { inventory: { 1: item('Stick'), 2: item('Stick') } })
    ])
    expect(index[0]).toMatchObject({ totalCount: 2, characterCount: 1 })
  })

  it('lists a worn item beside a carried one', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        equipment: { 1: item('Claw') },
        inventory: { 7: item('Claw') }
      })
    ])

    expect(index[0]!.holdings.map((holding) => holding.place)).toEqual(['equipment', 'inventory'])
    expect(index[0]!.holdings.map((holding) => holding.slot)).toEqual([1, 7])
  })

  it('groups two dye colours of one item and keeps each colour', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        inventory: { 1: item('Gorget', { color: 3 }), 2: item('Gorget', { color: 9 }) }
      })
    ])

    expect(index).toHaveLength(1)
    expect(index[0]!.holdings.map((holding) => holding.color)).toEqual([3, 9])
  })

  it('keeps durability, so a worn item can be told from a fresh one', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        equipment: { 11: item('Light Belt', { durability: 2912, maxDurability: 3000 }) }
      })
    ])

    expect(index[0]!.holdings[0]).toMatchObject({ durability: 2912, maxDurability: 3000 })
  })

  it('sorts items by name, ignoring case', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        inventory: { 1: item('zinc bar'), 2: item('Apple'), 3: item('Beryl') }
      })
    ])
    expect(index.map((entry) => entry.name)).toEqual(['Apple', 'Beryl', 'zinc bar'])
  })

  it('carries the time each holder was last seen', () => {
    // A count is only true as of the moment its character was last read.
    const index = buildItemIndex([
      character('Sabrael', { lastSeenMs: 5000, inventory: { 1: item('Stick') } }),
      character('Fintan', { lastSeenMs: 9000, inventory: { 1: item('Stick') } })
    ])

    expect(index[0]!.lastSeenMs).toBe(9000)
    expect(index[0]!.holdings.map((holding) => holding.lastSeenMs)).toEqual([9000, 5000])
  })
})

describe('filterItems', () => {
  const index = buildItemIndex([
    character('Sabrael', {
      inventory: { 1: item('Small Emerald Ring'), 2: item('Stick'), 3: item('Hemloch') }
    })
  ])

  it('keeps everything when the query is empty', () => {
    expect(filterItems(index, '   ')).toHaveLength(3)
  })

  it('matches anywhere in the name and ignores case', () => {
    expect(filterItems(index, 'RING').map((entry) => entry.name)).toEqual(['Small Emerald Ring'])
    expect(filterItems(index, 'emerald').map((entry) => entry.name)).toEqual(['Small Emerald Ring'])
  })

  it('returns nothing when no name matches', () => {
    expect(filterItems(index, 'crown')).toEqual([])
  })
})

describe('summariseItems', () => {
  it('totals the entries it is given', () => {
    const index = buildItemIndex([
      character('Sabrael', {
        inventory: { 1: item('Hemloch', { count: 40, canStack: true }), 2: item('Stick') }
      }),
      character('Fintan', { inventory: { 1: item('Stick') } })
    ])

    expect(summariseItems(index)).toEqual({ itemCount: 2, totalCount: 42, characterCount: 2 })
  })

  it('summarises a filtered list, not the whole index', () => {
    const index = buildItemIndex([
      character('Sabrael', { inventory: { 1: item('Stick'), 2: item('Hemloch') } }),
      character('Fintan', { inventory: { 1: item('Hemloch') } })
    ])

    expect(summariseItems(filterItems(index, 'stick'))).toEqual({
      itemCount: 1,
      totalCount: 1,
      characterCount: 1
    })
  })
})
