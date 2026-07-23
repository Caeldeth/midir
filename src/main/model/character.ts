import {
  BANK_WITHDRAW_REQUEST_PURSUIT,
  isPlaceholderName,
  type DecodedPacket
} from '../protocol/decode'
import { FIRST_EQUIPMENT_SLOT, INVENTORY_SLOT_COUNT, LAST_EQUIPMENT_SLOT } from '../protocol/types'
import { emptyCharacter, type CharacterRecord, type ItemRef } from '../../shared/character'

/**
 * Turn a stream of decoded packets into one character record.
 *
 * This file is pure. `reduce` takes a state and a packet and returns the next
 * state, so a whole login can be replayed through it in a test.
 *
 * Two rules shape everything here:
 *
 * 1. **Merge, never replace.** SStatus is flag-gated. A packet that carries
 *    only current health must not wipe the level, the gold, or the inventory.
 * 2. **A record is only a character once it has a name.** Midir learns the
 *    name two ways, and prefers the stronger one.
 */

/**
 * How long to wait for the bank list after the player asks for it.
 *
 * An empty bank sends no reply at all, so the wait is what turns the player's
 * request into an answer. Live captures put every answered request between 119
 * and 253 ms. The nearest packet that could be mistaken for a late reply was
 * an NPC main menu 3.2 seconds later, and it is a different menu type. Two
 * seconds is therefore about ten times the observed reply time and still well
 * clear of anything else.
 */
export const BANK_REPLY_WINDOW_MS = 2000

/** A bank list the player has asked for and Midir is still waiting on. */
interface PendingBank {
  /** When the request went out. This is the time the reading belongs to. */
  atMs: number
  /** The banker the request went to. */
  objectId: number
}

/** What the reducer holds between packets. */
export interface CharacterSession {
  /** The player's own world entity id, once SUserAppearance has said. */
  userId: number | null
  /** The name, once known. Until then the record is unnamed. */
  name: string | null
  /** True when the name came from a drawn entity rather than a token. */
  nameIsConfirmed: boolean
  /**
   * True once the server has described this character at all: statistics, an
   * item, a profile, or our own drawn entity.
   *
   * A name on its own is not a character. The connections before the world
   * server are keyed from a placeholder, and they never describe anybody.
   */
  hasCharacterData: boolean
  /** A bank list asked for but not yet answered. */
  pendingBank?: PendingBank
  record: CharacterRecord
}

/** One packet, with what the capture layer knows about it. */
export interface ReducerInput {
  packet: DecodedPacket
  timestampMs: number
  /**
   * The name the connection's session key was built from. On the world
   * connection this is the character name, because it came from the login
   * redirect. It is a good first answer, and a drawn entity overrides it.
   */
  keyName?: string | undefined
  /**
   * True when bytes were lost on this connection since the previous packet.
   *
   * A lost packet must never become an empty bank. Silence after a loss says
   * nothing at all, so it cancels the wait rather than answering it.
   */
  sawLoss?: boolean | undefined
}

/** Start a fresh session. Call this for each new world connection. */
export function newSession(startedAtMs: number): CharacterSession {
  return {
    userId: null,
    name: null,
    nameIsConfirmed: false,
    hasCharacterData: false,
    record: emptyCharacter('', startedAtMs)
  }
}

/** Apply one packet. Returns a new state and never changes the old one. */
export function reduce(state: CharacterSession, input: ReducerInput): CharacterSession {
  const named = applyName(state, input)
  const wait = applyBankWait(named, input)
  const record = applyPacket(wait.record, input, named)
  const session = withPendingBank(named, wait.pendingBank)
  if (record === named.record) return session
  return {
    ...session,
    hasCharacterData: true,
    record: { ...record, lastSeenMs: input.timestampMs }
  }
}

/**
 * True once the record describes a character that is worth saving.
 *
 * Both halves matter. A record with no name cannot be filed, and a name with
 * no record behind it is the pre-login placeholder, which is nobody.
 */
export function isIdentified(state: CharacterSession): boolean {
  return state.name !== null && state.name.length > 0 && state.hasCharacterData
}

// ---------------------------------------------------------------------------
// The bank the player asked for
// ---------------------------------------------------------------------------

/** What the wait decided: what to keep waiting for, and the record it leaves. */
interface BankWait {
  pendingBank: PendingBank | undefined
  record: CharacterRecord
}

/**
 * Decide what the player's bank request means so far.
 *
 * The bank is the one thing the server answers with silence. It sends the
 * whole list when the bank holds something and sends nothing at all when it
 * holds nothing, so only the request tells the two apart:
 *
 *   request, then the list          the bank holds what the list says
 *   request, then nothing, waited   the bank is empty
 *   request, then a lost packet     nothing is known; drop the request
 *   no request                      nothing is known; the bank is unread
 *
 * The reading is stamped with the time of the **request**, not the time the
 * wait ran out. That is the moment the player looked.
 */
function applyBankWait(state: CharacterSession, input: ReducerInput): BankWait {
  const { packet } = input
  const pending = state.pendingBank

  // Bytes were lost. Silence after a loss is not evidence of anything.
  if (input.sawLoss === true) return { pendingBank: undefined, record: state.record }

  if (packet.kind === 'merchantResponse' && packet.pursuit === BANK_WITHDRAW_REQUEST_PURSUIT) {
    return {
      pendingBank: { atMs: input.timestampMs, objectId: packet.objectId },
      record: state.record
    }
  }

  // The list arrived. applyPacket stores it.
  if (packet.kind === 'bankContents') return { pendingBank: undefined, record: state.record }

  if (pending !== undefined && input.timestampMs - pending.atMs >= BANK_REPLY_WINDOW_MS) {
    return { pendingBank: undefined, record: withEmptyBank(state.record, pending.atMs) }
  }

  return { pendingBank: pending, record: state.record }
}

/**
 * Settle a request the connection ended on.
 *
 * The world server sends a heartbeat every few seconds, so a request normally
 * runs out of wait against an ordinary packet. This closes the one hole left:
 * a player who asks an empty bank and logs off at once. The wait still has to
 * have passed, because a connection that ends sooner than that could have been
 * carrying the list.
 */
export function resolvePendingBank(state: CharacterSession, nowMs: number): CharacterSession {
  const pending = state.pendingBank
  if (pending === undefined) return state
  if (nowMs - pending.atMs < BANK_REPLY_WINDOW_MS) return state
  const settled = withPendingBank(state, undefined)
  return { ...settled, record: withEmptyBank(state.record, pending.atMs) }
}

function withEmptyBank(record: CharacterRecord, readAtMs: number): CharacterRecord {
  return { ...record, bank: { readAtMs, items: [] } }
}

function withPendingBank(
  state: CharacterSession,
  pending: PendingBank | undefined
): CharacterSession {
  if (pending === state.pendingBank) return state
  if (pending === undefined) {
    const next = { ...state }
    delete next.pendingBank
    return next
  }
  return { ...state, pendingBank: pending }
}

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

function applyName(state: CharacterSession, input: ReducerInput): CharacterSession {
  const { packet } = input

  // The strongest evidence: the world drew our own entity, and named it.
  if (
    packet.kind === 'drawHumanObjects' &&
    state.userId !== null &&
    packet.entityId === state.userId &&
    packet.name.length > 0
  ) {
    if (state.nameIsConfirmed && state.name === packet.name) return state
    return {
      ...state,
      name: packet.name,
      nameIsConfirmed: true,
      record: { ...state.record, name: packet.name }
    }
  }

  if (packet.kind === 'userAppearance') {
    return { ...state, userId: packet.userId }
  }

  // The token's name seeded the session key for this connection, so on the
  // world connection it is the character name. Accept it until an entity
  // confirms one.
  //
  // The connections before the world server are keyed from a placeholder such
  // as `socket[295]`. That value is a real key seed and a real nobody, so it
  // is used for decryption and never as an identity.
  if (
    !state.nameIsConfirmed &&
    input.keyName !== undefined &&
    input.keyName.length > 0 &&
    !isPlaceholderName(input.keyName)
  ) {
    if (state.name === input.keyName) return state
    return { ...state, name: input.keyName, record: { ...state.record, name: input.keyName } }
  }

  return state
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

function applyPacket(
  record: CharacterRecord,
  input: ReducerInput,
  session: CharacterSession
): CharacterRecord {
  const { packet } = input
  switch (packet.kind) {
    case 'status':
      return applyStatus(record, packet)
    case 'addInventory':
      return withSlot(record, 'inventory', packet.slot, itemOf(packet), 1, INVENTORY_SLOT_COUNT)
    case 'removeInventory':
      return withoutSlot(record, 'inventory', packet.slot)
    case 'addEquip':
      return withSlot(
        record,
        'equipment',
        packet.slot,
        itemOf({ ...packet, quantity: 1, canStack: false }),
        FIRST_EQUIPMENT_SLOT,
        LAST_EQUIPMENT_SLOT
      )
    case 'removeEquip':
      return withoutSlot(record, 'equipment', packet.slot)
    case 'selfLook':
      return {
        ...record,
        title: packet.title,
        guild: packet.guild,
        guildRank: packet.guildRank,
        displayClass: packet.displayClass,
        legend: packet.legend.map((mark) => ({ ...mark })),
        appearance: {
          ...record.appearance,
          nation: packet.nation,
          characterClass: packet.characterClass
        }
      }
    case 'userAppearance':
      return {
        ...record,
        appearance: { ...record.appearance, characterClass: packet.characterClass }
      }
    case 'bankContents':
      // The whole list arrives at once, so it replaces what was there rather
      // than merging. A merge would keep an item the player has since
      // withdrawn, and the bank has no per-item update to correct it with.
      return {
        ...record,
        bank: {
          readAtMs: input.timestampMs,
          npcName: packet.npcName,
          items: packet.items.map((item) => ({ ...item }))
        }
      }
    case 'drawHumanObjects':
      // The world draws every player in view. Only our own entity describes
      // this character; anyone else's sprites belong to them.
      if (session.userId === null || packet.entityId !== session.userId) return record
      return applyAppearance(record, packet)
    default:
      return record
  }
}

/**
 * Merge one SStatus. Only the blocks the flag byte selected are present, and
 * only those may change.
 */
function applyStatus(
  record: CharacterRecord,
  packet: Extract<DecodedPacket, { kind: 'status' }>
): CharacterRecord {
  const stats = { ...record.stats }
  let hasMail = record.hasMail

  if (packet.coreStats !== undefined) {
    const core = packet.coreStats
    stats.level = core.level
    stats.abilityLevel = core.abilityLevel
    stats.maxHealth = core.maxHealth
    stats.maxMana = core.maxMana
    stats.strength = core.strength
    stats.intelligence = core.intelligence
    stats.wisdom = core.wisdom
    stats.constitution = core.constitution
    stats.dexterity = core.dexterity
    stats.statPoints = core.hasStatPoints ? core.statPoints : 0
    stats.weight = core.weight
    stats.maxWeight = core.maxWeight
  }

  if (packet.vitals !== undefined) {
    stats.currentHealth = packet.vitals.health
    stats.currentMana = packet.vitals.mana
  }

  if (packet.currency !== undefined) {
    stats.totalExperience = packet.currency.totalExperience
    stats.toNextLevel = packet.currency.toNextLevel
    stats.totalAbility = packet.currency.totalAbility
    stats.toNextAbility = packet.currency.toNextAbility
    stats.gamePoints = packet.currency.gamePoints
    stats.gold = packet.currency.gold
  }

  if (packet.modifiers !== undefined) {
    stats.armorClass = packet.modifiers.armorClass
    stats.magicResistance = packet.modifiers.magicResistUnits
    stats.damageModifier = packet.modifiers.damageModifier
    stats.hitModifier = packet.modifiers.hitModifier
    stats.attackElement = packet.modifiers.attackElement
    stats.defenseElement = packet.modifiers.defenseElement
    // The mail byte only means anything when the flag byte says so.
    if (packet.mailActive) hasMail = packet.modifiers.mailState !== 0
  }

  return { ...record, stats, hasMail }
}

function applyAppearance(
  record: CharacterRecord,
  packet: Extract<DecodedPacket, { kind: 'drawHumanObjects' }>
): CharacterRecord {
  if (packet.human === undefined) return record
  const human = packet.human
  return {
    ...record,
    appearance: {
      ...record.appearance,
      hairStyle: human.headSprite,
      hairColor: human.hairColor,
      bodyShape: human.bodyShape,
      faceShape: human.faceShape,
      skinColor: human.skinColor,
      armorSprite: human.armorSprite,
      weaponSprite: human.weaponSprite,
      shieldSprite: human.shieldSprite,
      bootsSprite: human.bootsSprite,
      overcoatSprite: human.overcoatSprite,
      overcoatColor: human.overcoatColor
    }
  }
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

interface ItemFields {
  sprite: number
  dyeColor: number
  name: string
  quantity: number
  canStack: boolean
  durability: number
  maxDurability: number
}

function itemOf(packet: ItemFields): ItemRef {
  return {
    name: packet.name,
    sprite: packet.sprite,
    color: packet.dyeColor,
    count: packet.quantity,
    canStack: packet.canStack,
    durability: packet.durability,
    maxDurability: packet.maxDurability
  }
}

function withSlot(
  record: CharacterRecord,
  field: 'inventory' | 'equipment',
  slot: number,
  item: ItemRef,
  lowest: number,
  highest: number
): CharacterRecord {
  // A slot outside the range is not something the client would place. Ignore
  // it rather than growing the record with a slot nothing can show.
  if (slot < lowest || slot > highest) return record
  return { ...record, [field]: { ...record[field], [slot]: item } }
}

function withoutSlot(
  record: CharacterRecord,
  field: 'inventory' | 'equipment',
  slot: number
): CharacterRecord {
  if (record[field][slot] === undefined) return record
  const next = { ...record[field] }
  delete next[slot]
  return { ...record, [field]: next }
}
