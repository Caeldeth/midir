import { PacketReader } from '../reader'

/**
 * NPC dialog, and the bank inside it.
 *
 * The retail protocol has no bank opcode. Bank contents arrive as an ordinary
 * NPC dialog: the player clicks the banker, chooses "Withdraw Item", and the
 * server answers with SScreenMenu 0x2F carrying a list of items. That is the
 * only place a bank is ever described, so it is read opportunistically and
 * every value is true only as of the moment it arrived.
 *
 * ## Telling the bank from a shop
 *
 * A shop's buy list is the same opcode and the same menu type. The body's
 * pursuit id is what separates them, and it is a server-wide constant rather
 * than a per-NPC dialog id. Four live captures settle it:
 *
 *   Taurael   at Antonio (0x1f6f)  pursuit 0x56  21 rows  quantities 1-4
 *   Angelique at Drave   (0x2ab5)  pursuit 0x56  53 rows  quantities 1-10
 *   Arachne   at Cassidy (0x1ba9)  pursuit 0x56  45 rows  quantities 1-2
 *   Paelrohm  at Antonio (0x1f6f)  pursuit 0x4a   1 row   value 8300
 *
 * The last row is the control: it is a buy list from **the same NPC** as the
 * first row's bank, so the pursuit cannot be per-NPC. Each of the three banks
 * consumed its body to exactly zero trailing bytes.
 *
 * ## The quantity field
 *
 * Both protocol sources call the row's `u32` a price. In a bank it is the
 * number held. The captures above show ordinary items at 1 to 10 in a bank,
 * against a single "Mystic Gown" at 8300 in the buy list from the same NPC.
 * The field is the same offset with a different meaning per dialog, so this
 * decoder names it for the only dialog it reads.
 *
 * ## An empty bank sends nothing, and the request is what proves it
 *
 * A player whose bank holds nothing gets no reply at all — no menu, no
 * message. Silence alone is therefore not evidence of an empty bank: it is
 * identical to never having opened one, to a missed packet, and to capture
 * starting late.
 *
 * **The player's own request separates them.** CMerchant 0x39 carries the
 * pursuit below, and Midir can read it now that the dialog inner wrapper is
 * off. A request with no list behind it, on a connection that lost no bytes,
 * is an empty bank. Nothing else may render a bank as empty. See
 * model/character.ts, which owns that rule and its timing.
 */

/** The pursuit id the server uses for the "withdraw item" list. */
export const BANK_WITHDRAW_PURSUIT = 0x56

/**
 * The pursuit id the client sends to ask a banker for that list.
 *
 * Like the reply pursuit, it is a server-wide constant and not a per-NPC
 * dialog id. Six requests in one capture settle it:
 *
 *   Taurael   at Antonio (0x1f6f)  0x39 pursuit 0x45  ->  0x2F type 4, 21 rows
 *   Angelique at Drave   (0x2ab5)  0x39 pursuit 0x45  ->  0x2F type 4, 53 rows
 *   Arachne   at Cassidy (0x1ba9)  0x39 pursuit 0x45  ->  0x2F type 4, 45 rows
 *   Paelrohm  at Antonio (0x1f6f)  0x39 pursuit 0x45  ->  0x2F type 4, 49 rows
 *   Paelrohm  at Antonio (0x1f6f)  0x39 pursuit 0x40  ->  0x2F type 4, pursuit
 *                                                          0x4a, a shop list
 *   Gabrael   at Antonio (0x1f6f)  0x39 pursuit 0x45  ->  nothing
 *
 * The fifth row is the control. It is the same NPC as the first and the
 * fourth, and its buy list answers a different request pursuit with a
 * different reply pursuit, so neither constant belongs to the NPC. The sixth
 * row is the empty bank.
 */
export const BANK_WITHDRAW_REQUEST_PURSUIT = 0x45

/** The menu types that carry a server-owned item list. Type 10 is an alias. */
const ITEM_LIST_MENU_TYPES = new Set([4, 10])

/** One item a bank holds. */
export interface BankItem {
  name: string
  sprite: number
  color: number
  /** How many the bank holds. */
  count: number
}

/** SScreenMenu 0x2F, when it carries the bank's contents. */
export interface BankContents {
  kind: 'bankContents'
  /** The banker's object id. */
  sourceId: number
  /** The banker's name, as the server wrote it. */
  npcName: string
  items: BankItem[]
}

/** The menu types that carry a menu of text options with a pursuit per row. */
const OPTION_MENU_TYPE = 0

/** The menu types that carry a text-entry field and one pursuit. */
const TEXT_ENTRY_MENU_TYPES = new Set([2, 3])

/** The menu types that carry a spell or skill list, with one pursuit. */
const SPELL_SKILL_MENU_TYPES = new Set([6, 7])

/** One row of a text menu, and the pursuit the client sends when it is chosen. */
export interface NpcMenuOption {
  text: string
  /** The pursuit id this row answers with. Set for a type-0 menu. */
  pursuit?: number
}

/**
 * SScreenMenu 0x2F, when it is an NPC menu Midir can read.
 *
 * This is the general dialog the bank is one special case of. It models the
 * text menus (type 0), the text-entry menus (types 2 and 3), and the spell and
 * skill lists (types 6 and 7). The item lists (types 4, 5, 10, and 11) are not
 * modelled here: the bank is the one item list Midir reads, and it has its own
 * decoder above.
 *
 * The pursuit id does not sit in a fixed place. A type-0 menu carries one
 * pursuit per row; a type-2, type-3, type-6, or type-7 menu carries a single
 * pursuit for the whole menu. `pursuit` holds the single one, and each row of a
 * type-0 menu holds its own.
 */
export interface NpcMenu {
  kind: 'npcMenu'
  /** The NPC the menu belongs to. */
  sourceId: number
  /** The NPC name, as the server wrote it. */
  npcName: string
  /** The raw menuType byte. */
  menuType: number
  /** The single pursuit for the whole menu. Undefined for a type-0 menu. */
  pursuit?: number
  /** The dialog prose the menu shows. */
  text: string
  /** True when the menu asks for typed text rather than a choice of rows. */
  isTextInput: boolean
  /** The choosable rows. Empty for a text-entry menu. */
  options: NpcMenuOption[]
}

/** Read the common 0x2F header, up to and including the prose text. */
interface MenuHeader {
  sourceId: number
  npcName: string
  text: string
}

function readMenuHeader(reader: PacketReader): MenuHeader {
  reader.u8() // entity type
  const sourceId = reader.u32()
  reader.skip(1) // read and discarded by the client
  reader.u16() // NPC sprite
  reader.u8() // NPC sprite colour
  reader.skip(4) // read and discarded by the client
  reader.u8() // illustration index
  const npcName = reader.string8()
  const text = reader.string16()
  return { sourceId, npcName, text }
}

/**
 * Decode SScreenMenu 0x2F when it is the bank, and return null otherwise.
 *
 * Returning null rather than throwing is deliberate. Every NPC conversation in
 * the game uses this opcode, so a dialog that is not the bank is the normal
 * case and not a failure.
 *
 * Body: `[u8 opcode][u8 menuType][u8 entityType][u32 sourceId][u8 unused]
 *        [u16 sprite][u8 color][4 bytes unused][u8 illustration]
 *        [string8 npcName][string16 text]` then, for an item list,
 *        `[u16 pursuit][u16 count]` and `count` rows of
 *        `[u16 sprite][u8 color][u32 count][string8 name][string8 description]`.
 *
 * The four unused bytes are read and discarded by the retail client. They are
 * skipped here for the same reason: they are on the wire and carry nothing.
 */
export function decodeBankContents(body: Uint8Array): BankContents | null {
  const reader = new PacketReader(body, 1)
  const menuType = reader.u8()
  if (!ITEM_LIST_MENU_TYPES.has(menuType)) return null

  const header = readMenuHeader(reader)

  const pursuit = reader.u16()
  if (pursuit !== BANK_WITHDRAW_PURSUIT) return null

  const count = reader.u16()
  const items: BankItem[] = []
  for (let index = 0; index < count; index++) {
    const sprite = reader.u16()
    const color = reader.u8()
    const held = reader.u32()
    const name = reader.string8()
    reader.string8() // the description, which is a single space for every bank row
    items.push({ name, sprite, color, count: held })
  }

  return { kind: 'bankContents', sourceId: header.sourceId, npcName: header.npcName, items }
}

/**
 * Decode SScreenMenu 0x2F to a general NPC menu, and return null otherwise.
 *
 * This reads the text menus, the text-entry menus, and the spell and skill
 * lists. It returns null for an item list, which is either the bank (read by
 * `decodeBankContents`) or a shop list Midir does not act on.
 *
 * Body after the header: for a type-0 menu, `[u8 count]` then `count` rows of
 * `[string8 label][u16 pursuit]`. For a type-2 menu, `[u16 pursuit]`. For a
 * type-3 menu, `[string8 argument][u16 pursuit]`. For a type-6 or type-7 menu,
 * `[u16 pursuit][u16 count]` then `count` rows of
 * `[u8 iconType][u16 icon][u8 color][string8 name]`.
 */
function decodeNpcMenu(body: Uint8Array): NpcMenu | null {
  const reader = new PacketReader(body, 1)
  const menuType = reader.u8()
  const header = readMenuHeader(reader)
  const base = {
    kind: 'npcMenu' as const,
    sourceId: header.sourceId,
    npcName: header.npcName,
    menuType,
    text: header.text
  }

  if (menuType === OPTION_MENU_TYPE) {
    const count = reader.u8()
    const options: NpcMenuOption[] = []
    for (let index = 0; index < count; index++) {
      const text = reader.string8()
      const pursuit = reader.u16()
      options.push({ text, pursuit })
    }
    return { ...base, isTextInput: false, options }
  }

  if (TEXT_ENTRY_MENU_TYPES.has(menuType)) {
    if (menuType === 3) reader.string8() // a server argument, prose and not data
    const pursuit = reader.u16()
    return { ...base, pursuit, isTextInput: true, options: [] }
  }

  if (SPELL_SKILL_MENU_TYPES.has(menuType)) {
    const pursuit = reader.u16()
    const count = reader.u16()
    const options: NpcMenuOption[] = []
    for (let index = 0; index < count; index++) {
      reader.u8() // icon type
      reader.u16() // icon
      reader.u8() // colour
      options.push({ text: reader.string8() })
    }
    return { ...base, pursuit, isTextInput: false, options }
  }

  // An item list or a menu type Midir does not model.
  return null
}

/**
 * Decode SScreenMenu 0x2F to whichever dialog it carries.
 *
 * The bank is read first, because it is the one item list Midir stores. Every
 * other readable menu is a general NPC menu. A menu Midir does not model
 * returns null, which is the usual case for this opcode.
 */
export function decodeScreenMenu(body: Uint8Array): BankContents | NpcMenu | null {
  return decodeBankContents(body) ?? decodeNpcMenu(body)
}
