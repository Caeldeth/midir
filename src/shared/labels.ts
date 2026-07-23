// Names for the values the protocol carries as single bytes. Pure data, shared
// between main, preload, and renderer. No runtime imports.
//
// Source: darkages-741-re/docs/network/protocol-types.md. Where that document
// marks a name as "project-owner protocol vocabulary", the number is recovered
// from the client and the name is a label. Midir keeps the raw number in every
// record, so an unknown or relabelled value is never lost.

/** Equipment slots. Wire value 0 is a sentinel; 1 through 18 are real slots. */
export const EQUIPMENT_SLOT_NAMES: Readonly<Record<number, string>> = {
  1: 'Weapon',
  2: 'Armor',
  3: 'Shield',
  4: 'Helmet',
  5: 'Earrings',
  6: 'Necklace',
  7: 'Left Ring',
  8: 'Right Ring',
  9: 'Left Gauntlet',
  10: 'Right Gauntlet',
  11: 'Belt',
  12: 'Greaves',
  13: 'Boots',
  14: 'Accessory 1',
  15: 'Overcoat',
  16: 'Over Helm',
  17: 'Accessory 2',
  18: 'Accessory 3'
}

/** The order the equipment grid shows the slots in. */
export const EQUIPMENT_SLOT_ORDER: readonly number[] = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18
]

export const CHARACTER_CLASS_NAMES: Readonly<Record<number, string>> = {
  0: 'Peasant',
  1: 'Warrior',
  2: 'Rogue',
  3: 'Wizard',
  4: 'Priest',
  5: 'Monk'
}

export const NATION_NAMES: Readonly<Record<number, string>> = {
  0: 'None',
  1: 'Suomi',
  3: 'Loures',
  4: 'Mileth',
  5: 'Tagor',
  6: 'Rucesion',
  7: 'Noes',
  9: 'Piet',
  11: 'Abel',
  12: 'Undine'
}

/** Legend mark icons. Value 8 is a sentinel, not a ninth drawable icon. */
export const LEGEND_ICON_NAMES: Readonly<Record<number, string>> = {
  0: 'Aisling',
  1: 'Warrior',
  2: 'Rogue',
  3: 'Wizard',
  4: 'Priest',
  5: 'Monk',
  6: 'Heart',
  7: 'Victory',
  8: 'None'
}

export const ELEMENT_NAMES: Readonly<Record<number, string>> = {
  0: 'None',
  1: 'Fire',
  2: 'Water',
  3: 'Wind',
  4: 'Earth',
  5: 'Light',
  6: 'Dark',
  7: 'Wood',
  8: 'Metal',
  9: 'Undead'
}

/** The lowest and highest real equipment slot values. */
export const FIRST_EQUIPMENT_SLOT = 1
export const LAST_EQUIPMENT_SLOT = 18

/** The number of inventory slots. Slot 60 holds the client's synthetic gold item. */
export const INVENTORY_SLOT_COUNT = 60
