import { PacketReader } from '../reader'
import { BLIND_CODE, MONSTER_DISGUISE_HEAD_SPRITE } from '../types'

/**
 * The packets that describe the player's own character.
 *
 * SStatus is flag-gated: the server sends a full snapshot at login and small
 * updates afterwards. A decoded SStatus therefore describes only the blocks
 * that were present, and the caller must merge it into the stored record.
 */

/** Which blocks an SStatus body carries. */
export const StatusField = {
  /** Core stats: level, attributes, weight. */
  CoreStats: 0x20,
  /** Current health and mana. */
  Vitals: 0x10,
  /** Experience, ability, game points, and gold. */
  Currency: 0x08,
  /** Combat modifiers, elements, armour class, and the blind code. */
  Modifiers: 0x04,
  /** A standalone state bit with no confirmed consumer in the 7.41 client. */
  Standalone: 0x02,
  /** Makes the mail-state byte inside the modifier block meaningful. */
  MailActive: 0x01,
  /** The two high bits hold the privilege level, 0 through 3. */
  PrivilegeMask: 0xc0
} as const

export interface StatusCoreStats {
  level: number
  abilityLevel: number
  maxHealth: number
  maxMana: number
  strength: number
  intelligence: number
  wisdom: number
  constitution: number
  dexterity: number
  /** True while the client should show its stat-up buttons. */
  hasStatPoints: boolean
  /** The number of unspent stat points to display. */
  statPoints: number
  maxWeight: number
  weight: number
}

export interface StatusVitals {
  health: number
  mana: number
}

export interface StatusCurrency {
  totalExperience: number
  toNextLevel: number
  totalAbility: number
  toNextAbility: number
  gamePoints: number
  gold: number
}

export interface StatusModifiers {
  blinded: boolean
  /** Meaningful only when the MailActive flag is set. */
  mailState: number
  attackElement: number
  defenseElement: number
  magicResistUnits: number
  /** Signed. A lower armour class is better. */
  armorClass: number
  damageModifier: number
  hitModifier: number
}

/** SStatus 0x08. Every block is optional. */
export interface Status {
  kind: 'status'
  /** The raw flag byte, kept so an unmodelled bit is never lost. */
  fields: number
  /** The privilege level, 0 through 3, from the two high bits. */
  privilege: number
  /** True when the mail-state byte in the modifier block is active. */
  mailActive: boolean
  coreStats?: StatusCoreStats
  vitals?: StatusVitals
  currency?: StatusCurrency
  modifiers?: StatusModifiers
}

/**
 * Decode SStatus 0x08.
 *
 * The byte after the opcode selects the blocks that follow. Absent blocks are
 * absent from the result. Never treat a partial update as a whole character.
 *
 * The three bytes at the head of the core-stats block and four bytes inside
 * the modifier block are read and retained by the client but have no confirmed
 * meaning. They are consumed here so the following fields land correctly.
 */
export function decodeStatus(body: Uint8Array): Status {
  const reader = new PacketReader(body, 1)
  const fields = reader.u8()

  const status: Status = {
    kind: 'status',
    fields,
    privilege: (fields & StatusField.PrivilegeMask) >> 6,
    mailActive: (fields & StatusField.MailActive) !== 0
  }

  if (fields & StatusField.CoreStats) {
    reader.skip(3) // retained by the client, meaning unconfirmed
    status.coreStats = {
      level: reader.u8(),
      abilityLevel: reader.u8(),
      maxHealth: reader.u32(),
      maxMana: reader.u32(),
      strength: reader.u8(),
      intelligence: reader.u8(),
      wisdom: reader.u8(),
      constitution: reader.u8(),
      dexterity: reader.u8(),
      hasStatPoints: reader.bool(),
      statPoints: reader.u8(),
      maxWeight: reader.u16(),
      weight: reader.u16()
    }
    reader.skip(4) // opaque status word
  }

  if (fields & StatusField.Vitals) {
    status.vitals = { health: reader.u32(), mana: reader.u32() }
  }

  if (fields & StatusField.Currency) {
    status.currency = {
      totalExperience: reader.u32(),
      toNextLevel: reader.u32(),
      totalAbility: reader.u32(),
      toNextAbility: reader.u32(),
      gamePoints: reader.u32(),
      gold: reader.u32()
    }
  }

  if (fields & StatusField.Modifiers) {
    // Read every field in wire order. Object literals would evaluate in source
    // order too, but the two skips make the order load-bearing, so keep it plain.
    reader.skip(1) // retained modifier 0
    const blindCode = reader.u8()
    reader.skip(3) // retained modifiers 1 to 3
    const mailState = reader.u8()
    const attackElement = reader.u8()
    const defenseElement = reader.u8()
    const magicResistUnits = reader.u8()
    reader.skip(1) // unknown modifier 4; the client copies it but never reads it
    const armorClass = reader.i8()
    const damageModifier = reader.u8()
    const hitModifier = reader.u8()

    status.modifiers = {
      blinded: blindCode === BLIND_CODE,
      mailState,
      attackElement,
      defenseElement,
      magicResistUnits,
      armorClass,
      damageModifier,
      hitModifier
    }
  }

  return status
}

/** One legend mark. */
export interface LegendMark {
  icon: number
  color: number
  /** The mark's stable key. The server uses it to replace a mark in place. */
  key: string
  text: string
}

/** One row of a group recruiting advertisement. */
export interface RecruitingClassRow {
  wanted: number
  current: number
}

/** The recruiting advertisement, present only while the group is recruiting. */
export interface Recruiting {
  leader: string
  groupName: string
  note: string
  minimumLevel: number
  maximumLevel: number
  /** Warrior, Wizard, Rogue, Priest, Monk, in that order. */
  classes: RecruitingClassRow[]
}

/** SSelfLook 0x39. The player's own profile. */
export interface SelfLook {
  kind: 'selfLook'
  nation: number
  guildRank: string
  title: string
  groupMembers: string
  isGroupOpen: boolean
  recruiting?: Recruiting
  characterClass: number
  showAbilityMetadata: boolean
  showMasterMetadata: boolean
  displayClass: string
  guild: string
  legend: LegendMark[]
}

/** The five recruiting rows, in wire order. */
const RECRUITING_CLASS_ROWS = 5

/**
 * Decode SSelfLook 0x39.
 *
 * The optional recruiting block is present only when the recruiting byte is
 * exactly 1. Any other value means no block follows.
 */
export function decodeSelfLook(body: Uint8Array): SelfLook {
  const reader = new PacketReader(body, 1)
  const nation = reader.u8()
  const guildRank = reader.string8()
  const title = reader.string8()
  const groupMembers = reader.string8()
  const isGroupOpen = reader.bool()
  const isRecruiting = reader.u8() === 1

  let recruiting: Recruiting | undefined
  if (isRecruiting) {
    const leader = reader.string8()
    const groupName = reader.string8()
    const note = reader.string8()
    const minimumLevel = reader.u8()
    const maximumLevel = reader.u8()
    const classes: RecruitingClassRow[] = []
    for (let i = 0; i < RECRUITING_CLASS_ROWS; i++) {
      classes.push({ wanted: reader.u8(), current: reader.u8() })
    }
    recruiting = { leader, groupName, note, minimumLevel, maximumLevel, classes }
  }

  const characterClass = reader.u8()
  const showAbilityMetadata = reader.bool()
  const showMasterMetadata = reader.bool()
  const displayClass = reader.string8()
  const guild = reader.string8()

  const legend: LegendMark[] = []
  const legendCount = reader.u8()
  for (let i = 0; i < legendCount; i++) {
    legend.push({
      icon: reader.u8(),
      color: reader.u8(),
      key: reader.string8(),
      text: reader.string8()
    })
  }

  return {
    kind: 'selfLook',
    nation,
    guildRank,
    title,
    groupMembers,
    isGroupOpen,
    ...(recruiting ? { recruiting } : {}),
    characterClass,
    showAbilityMetadata,
    showMasterMetadata,
    displayClass,
    guild,
    legend
  }
}

/** SUserAppearance 0x05. The player's own identity and action lock. */
export interface UserAppearance {
  kind: 'userAppearance'
  /** The world entity id of the player's own character. */
  userId: number
  facing: number
  guildValue: number
  characterClass: number
  actionState: number
}

/**
 * Decode SUserAppearance 0x05.
 *
 * Body: `[u8 opcode][u32 userId][u8 facing][u8 guild][u8 class][u8 actionState]
 *        [u8 unknown]`.
 *
 * The fixed body holds five bytes after the id, not four. `actionState` and
 * the final byte are separate fields.
 */
export function decodeUserAppearance(body: Uint8Array): UserAppearance {
  const reader = new PacketReader(body, 1)
  return {
    kind: 'userAppearance',
    userId: reader.u32(),
    facing: reader.u8(),
    guildValue: reader.u8(),
    characterClass: reader.u8(),
    actionState: reader.u8()
  }
}

/** The visible sprites of a human form. */
export interface HumanForm {
  /** The high nibble of the packed body byte. */
  bodyShape: number
  /** The low nibble of the packed body byte. */
  pantsDye: number
  headSprite: number
  armsSprite: number
  bootsSprite: number
  armorSprite: number
  shieldSprite: number
  weaponSprite: number
  hairColor: number
  bootsColor: number
  accessory1: { sprite: number; color: number }
  accessory2: { sprite: number; color: number }
  accessory3: { sprite: number; color: number }
  lightMaskId: number
  restPosition: number
  overcoatSprite: number
  overcoatColor: number
  skinColor: number
  isTranslucent: boolean
  faceShape: number
}

/** The visible form while an entity wears a monster disguise. */
export interface MonsterForm {
  monsterSprite: number
  monsterColor: number
}

/** SDrawHumanObjects 0x33. How one entity looks and where it stands. */
export interface DrawHumanObjects {
  kind: 'drawHumanObjects'
  x: number
  y: number
  direction: number
  entityId: number
  name: string
  nameStyle: number
  groupAdText: string
  human?: HumanForm
  monster?: MonsterForm
}

/**
 * Decode SDrawHumanObjects 0x33.
 *
 * A head sprite of 0xFFFF selects the monster-disguise form. Both forms end
 * with the same name fields, so the name is always readable.
 */
export function decodeDrawHumanObjects(body: Uint8Array): DrawHumanObjects {
  const reader = new PacketReader(body, 1)
  const x = reader.u16()
  const y = reader.u16()
  const direction = reader.u8()
  const entityId = reader.u32()
  const headSprite = reader.u16()

  let human: HumanForm | undefined
  let monster: MonsterForm | undefined

  if (headSprite === MONSTER_DISGUISE_HEAD_SPRITE) {
    monster = { monsterSprite: reader.u16(), monsterColor: reader.u8() }
    reader.skip(1) // ignored colour
    reader.skip(6) // unknown
  } else {
    const packedBody = reader.u8()
    human = {
      bodyShape: (packedBody >> 4) & 0x0f,
      pantsDye: packedBody & 0x0f,
      headSprite,
      armsSprite: reader.u16(),
      bootsSprite: reader.u8(),
      armorSprite: reader.u16(),
      shieldSprite: reader.u8(),
      weaponSprite: reader.u16(),
      hairColor: reader.u8(),
      bootsColor: reader.u8(),
      accessory1: { color: reader.u8(), sprite: reader.u16() },
      accessory2: { color: reader.u8(), sprite: reader.u16() },
      accessory3: { color: reader.u8(), sprite: reader.u16() },
      lightMaskId: reader.u8(),
      restPosition: reader.u8(),
      overcoatSprite: reader.u16(),
      overcoatColor: reader.u8(),
      skinColor: reader.u8(),
      isTranslucent: reader.bool(),
      faceShape: reader.u8()
    }
  }

  const nameStyle = reader.u8()
  const name = reader.string8()
  const groupAdText = reader.string8()

  return {
    kind: 'drawHumanObjects',
    x,
    y,
    direction,
    entityId,
    name,
    nameStyle,
    groupAdText,
    ...(human ? { human } : {}),
    ...(monster ? { monster } : {})
  }
}
