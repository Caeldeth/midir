// The character record, shared between main, preload, and renderer. No runtime
// imports from electron or node, so this file is safe to pull from any process.

/** One item, as the server described it. */
export interface ItemRef {
  name: string
  /** The item's sprite id. Used to draw its icon from the client's archives. */
  sprite: number
  /** The dye colour index. */
  color: number
  /** The stack count. It is 1 for an item that cannot stack. */
  count: number
  canStack: boolean
  durability: number
  maxDurability: number
}

/** One legend mark. */
export interface LegendMark {
  /** A LegendMarkIcon value, 0 through 8. */
  icon: number
  color: number
  /** The mark's stable key. The server replaces a mark in place by its key. */
  key: string
  text: string
}

/** The numbers on the character sheet. */
export interface CharacterStats {
  level: number
  abilityLevel: number
  currentHealth: number
  maxHealth: number
  currentMana: number
  maxMana: number
  strength: number
  intelligence: number
  wisdom: number
  constitution: number
  dexterity: number
  /** Unspent stat points. */
  statPoints: number
  weight: number
  maxWeight: number
  gold: number
  totalExperience: number
  toNextLevel: number
  totalAbility: number
  toNextAbility: number
  gamePoints: number
  /** Signed. A lower armour class is better. */
  armorClass: number
  magicResistance: number
  damageModifier: number
  hitModifier: number
  /** An Element value for attacks. */
  attackElement: number
  /** An Element value for defence. */
  defenseElement: number
}

/** How the character looks in the world. */
export interface CharacterAppearance {
  /** A CharacterClass value, 0 through 5. */
  characterClass: number
  /** A Nation value. */
  nation: number
  hairStyle: number
  hairColor: number
  bodyShape: number
  faceShape: number
  skinColor: number
  /** The sprites the character is wearing, as the world draws them. */
  armorSprite: number
  weaponSprite: number
  shieldSprite: number
  bootsSprite: number
  overcoatSprite: number
  overcoatColor: number
}

/** Everything Midir knows about one character. */
export interface CharacterRecord {
  name: string
  /** When Midir last decoded a packet for this character. */
  lastSeenMs: number
  /** When Midir first saw this character. */
  firstSeenMs: number
  stats: CharacterStats
  appearance: CharacterAppearance
  /** Equipment by EquipmentSlot value, 1 through 18. */
  equipment: Record<number, ItemRef>
  /** Inventory by slot, 1 through 60. */
  inventory: Record<number, ItemRef>
  legend: LegendMark[]
  title: string
  guild: string
  guildRank: string
  /** The class name the server shows, for example "Gardcorp". */
  displayClass: string
  /** Whether the character had unread mail when last seen. */
  hasMail: boolean
}

/** A character with nothing known yet. */
export function emptyCharacter(name: string, seenAtMs: number): CharacterRecord {
  return {
    name,
    firstSeenMs: seenAtMs,
    lastSeenMs: seenAtMs,
    stats: {
      level: 0,
      abilityLevel: 0,
      currentHealth: 0,
      maxHealth: 0,
      currentMana: 0,
      maxMana: 0,
      strength: 0,
      intelligence: 0,
      wisdom: 0,
      constitution: 0,
      dexterity: 0,
      statPoints: 0,
      weight: 0,
      maxWeight: 0,
      gold: 0,
      totalExperience: 0,
      toNextLevel: 0,
      totalAbility: 0,
      toNextAbility: 0,
      gamePoints: 0,
      armorClass: 0,
      magicResistance: 0,
      damageModifier: 0,
      hitModifier: 0,
      attackElement: 0,
      defenseElement: 0
    },
    appearance: {
      characterClass: 0,
      nation: 0,
      hairStyle: 0,
      hairColor: 0,
      bodyShape: 0,
      faceShape: 0,
      skinColor: 0,
      armorSprite: 0,
      weaponSprite: 0,
      shieldSprite: 0,
      bootsSprite: 0,
      overcoatSprite: 0,
      overcoatColor: 0
    },
    equipment: {},
    inventory: {},
    legend: [],
    title: '',
    guild: '',
    guildRank: '',
    displayClass: '',
    hasMail: false
  }
}

/** How much of a character Midir has decoded. Drives what the sheet shows. */
export interface CharacterSummary {
  name: string
  level: number
  characterClass: number
  gold: number
  lastSeenMs: number
  /** How many inventory slots hold an item. */
  itemCount: number
}

/** Reduce a record to the row the character list shows. */
export function summarise(record: CharacterRecord): CharacterSummary {
  return {
    name: record.name,
    level: record.stats.level,
    characterClass: record.appearance.characterClass,
    gold: record.stats.gold,
    lastSeenMs: record.lastSeenMs,
    itemCount: Object.keys(record.inventory).length
  }
}
