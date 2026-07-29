import { PacketReader } from '../reader'

/**
 * SPursuitMessage 0x30, the server's side of a scripted NPC conversation.
 *
 * Clicking an NPC yields either a merchant menu (SScreenMenu 0x2F) or this
 * scripted dialog; the two paths never cross. This packet drives the dialog the
 * player sees: a line of text, a set of options, or a text-entry field. The
 * client answers it with CPursuit 0x3A. See decode/merchant.ts for the answer.
 *
 * ## The layout
 *
 * Body after the opcode:
 *
 *   [u8 dialogType]
 *   if dialogType == 0x0A: close the dialog and stop (a trailing 0x00 may
 *     follow and is read and discarded by the client).
 *   [u8 objectType][u32 sourceId][u8 unused][u16 sprite][u8 color]
 *   [u8 unused][u16 sprite2][u8 color2][u16 pursuit][u16 step]
 *   [u8 hasPrevious][u8 hasNext][u8 unused][string8 name]
 *   [string16 text]   present only for dialogType in {0,2,4,6,9}
 *   then a per-type body:
 *     options   {2,3,6}: [u8 count] then count x [string8 optionText]
 *     textInput {4,5,9}: [string8 prolog][u8 maxInputBytes][string8 epilog]
 *
 * The offset-20 byte before the name is `unknown` in the document repo and
 * `show_graphic` in darkages-741-re; neither proves it drives rendering, so it
 * is read and discarded here.
 *
 * Sources: the document repo `server/0x30-pursuit.md`; darkages-741-re
 * `server/048-0x30-pursuit-message.md`. Both agree on the field layout, the
 * dialogType enum, and that type 9 is the protected credential pane.
 *
 * ## The dialogType enum
 *
 *   0  Normal (plain text)
 *   1  plain message, no server drive
 *   2  Options (a menu question)
 *   3  SimpleOptions
 *   4  TextInput
 *   5  SimpleTextInput
 *   6  OptionsWithFace
 *   9  ProtectedTextInput  -- the ID and password pane. Never work it.
 *   10 Close
 *
 * Values 7 and 8 construct no known dialog and are not modelled.
 *
 * ## The one field that carries a rule: type 9
 *
 * Type 9 is the Nexon account ID and password form. Both sources agree the raw
 * credentials never reach the wire, but the pane itself is a credential dialog,
 * and every assistant must refuse it (CLAUDE.md). `isProtected` carries that
 * fact so a caller stops before it posts a key. The type byte alone identifies
 * it; there is no other flag.
 */

/** The shape of a pursuit dialog, one meaning per value. */
export type PursuitDialogKind = 'text' | 'options' | 'textInput' | 'protected' | 'close'

/** The dialogType value for the protected credential pane. Never work it. */
export const PROTECTED_DIALOG_TYPE = 9

/** The dialogType value that closes the dialog. */
export const CLOSE_DIALOG_TYPE = 0x0a

/** One option row the player can choose, in wire order (the choice is 1-based). */
export interface PursuitOption {
  text: string
}

/** SPursuitMessage 0x30, decoded to the fields a dialog assistant needs. */
export interface PursuitMessage {
  kind: 'pursuitMessage'
  /** The raw dialogType byte. */
  dialogType: number
  /** The dialogType mapped to its meaning. */
  dialogKind: PursuitDialogKind
  /** The object the dialog belongs to, for example an NPC. */
  objectType: number
  sourceId: number
  /** The NPC name, as the server wrote it. Empty for a close. */
  npcName: string
  /** The pursuit id, echoed back in the CPursuit 0x3A answer. */
  pursuit: number
  /** The current step index within the pursuit. */
  step: number
  hasPrevious: boolean
  hasNext: boolean
  /** The dialog prose, when the type carries it. */
  text?: string
  /** The option rows, when the type is a menu. */
  options?: PursuitOption[]
  /** True only for dialogType 9, the credential pane. */
  isProtected: boolean
}

/** The dialogTypes that carry a menu of options. */
const OPTION_TYPES = new Set([2, 3, 6])

/** The dialogTypes that carry a text-entry field. */
const TEXT_INPUT_TYPES = new Set([4, 5, 9])

/** The dialogTypes that carry the leading string16 prose. */
const TEXT_TYPES = new Set([0, 2, 4, 6, 9])

function dialogKindOf(dialogType: number): PursuitDialogKind {
  if (dialogType === CLOSE_DIALOG_TYPE) return 'close'
  if (dialogType === PROTECTED_DIALOG_TYPE) return 'protected'
  if (OPTION_TYPES.has(dialogType)) return 'options'
  if (TEXT_INPUT_TYPES.has(dialogType)) return 'textInput'
  return 'text'
}

/** Decode SPursuitMessage 0x30. */
export function decodePursuitMessage(body: Uint8Array): PursuitMessage {
  const reader = new PacketReader(body, 1)
  const dialogType = reader.u8()
  const dialogKind = dialogKindOf(dialogType)

  // Close ends the packet. Any trailing byte is read and discarded by the
  // client, so it is not a field here.
  if (dialogType === CLOSE_DIALOG_TYPE) {
    return {
      kind: 'pursuitMessage',
      dialogType,
      dialogKind,
      objectType: 0,
      sourceId: 0,
      npcName: '',
      pursuit: 0,
      step: 0,
      hasPrevious: false,
      hasNext: false,
      isProtected: false
    }
  }

  const objectType = reader.u8()
  const sourceId = reader.u32()
  reader.skip(1) // read and discarded by the client
  reader.u16() // speaker sprite
  reader.u8() // speaker colour
  reader.skip(1) // read and discarded by the client
  reader.u16() // secondary sprite, discarded
  reader.u8() // secondary colour, discarded
  const pursuit = reader.u16()
  const step = reader.u16()
  const hasPrevious = reader.bool()
  const hasNext = reader.bool()
  reader.skip(1) // unknown in one source, show-graphic in the other; discarded
  const npcName = reader.string8()

  const message: PursuitMessage = {
    kind: 'pursuitMessage',
    dialogType,
    dialogKind,
    objectType,
    sourceId,
    npcName,
    pursuit,
    step,
    hasPrevious,
    hasNext,
    isProtected: dialogType === PROTECTED_DIALOG_TYPE
  }

  if (TEXT_TYPES.has(dialogType)) message.text = reader.string16()

  if (OPTION_TYPES.has(dialogType)) {
    const count = reader.u8()
    const options: PursuitOption[] = []
    for (let index = 0; index < count; index++) options.push({ text: reader.string8() })
    message.options = options
  }

  // The text-entry body (prolog, max, epilog) carries nothing the matcher needs
  // beyond `isProtected` and `text`, so it is left unread. Trailing bytes are
  // not fields.

  return message
}
