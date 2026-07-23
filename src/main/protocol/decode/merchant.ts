import { PacketReader } from '../reader'

/**
 * The two client packets that answer an NPC.
 *
 * Both carry the dialog-response inner wrapper, so the bodies here are what
 * `unwrapDialogResponse` returned, not what the transform returned. See
 * dialogWrapper.ts.
 *
 * Midir listens only. It reads these because the request is evidence: the
 * player asked the banker for the item list, and that is the only way to tell
 * an empty bank from a bank nobody opened. See decode/dialog.ts.
 */

/**
 * CMerchant 0x39. The player chose something in an NPC menu.
 *
 * Body: `[u8 opcode][u8 objectType][u32 objectId][u16 pursuit]` and then a
 * tail whose shape depends on the menu the server last sent.
 *
 * **The tail is kept raw on purpose.** Unlike CPursuit 0x3A it carries no type
 * tag, so which of its six forms is on the wire is recoverable only from the
 * server's dialog state, not from the bytes. A decoder that guessed would read
 * a slot number as a string length sooner or later. Midir needs the pursuit id
 * and nothing else, so it keeps the bytes and says what they are not.
 *
 * `objectType` is 0x01 for a creature, 0x02 for an item, 0x04 for a reactor
 * tile, 0x05 for a castable, and 0xFE for an asynchronous dialog session.
 */
export interface MerchantResponse {
  kind: 'merchantResponse'
  objectType: number
  /** The world object the menu belongs to, for example a banker. */
  objectId: number
  pursuit: number
  /** The unparsed response tail, which is empty for a plain selection. */
  tail: Uint8Array
}

/** Decode CMerchant 0x39, after the inner wrapper is off. */
export function decodeMerchantResponse(body: Uint8Array): MerchantResponse {
  const reader = new PacketReader(body, 1)
  const objectType = reader.u8()
  const objectId = reader.u32()
  const pursuit = reader.u16()
  return { kind: 'merchantResponse', objectType, objectId, pursuit, tail: reader.rest() }
}

/**
 * CPursuit 0x3A. The player moved an NPC conversation along.
 *
 * Body: `[u8 opcode][u8 objectType][u32 objectId][u16 pursuit][u16 step]` and
 * then an optional argument. The argument is self-describing, which is the
 * difference from 0x39:
 *
 *   type 1  `[u8 choice]`    the menu row the player picked, one-based
 *   type 2  `[string8 text]` the text the player typed
 *
 * The type byte is **absent** for navigation and for closing the dialog. It is
 * not sent as zero.
 *
 * The step is how the client states its intent: the next step for an answer,
 * the current step minus one for Previous, and the current step unchanged to
 * close.
 */
export interface PursuitResponse {
  kind: 'pursuitResponse'
  objectType: number
  objectId: number
  pursuit: number
  step: number
  /** The chosen row, when the player answered a menu. */
  choice?: number
  /** The text the player typed, when the player answered an input. */
  text?: string
}

/** The argument type byte the client writes before a menu choice. */
const ARGUMENT_CHOICE = 1

/** The argument type byte the client writes before typed text. */
const ARGUMENT_TEXT = 2

/** Decode CPursuit 0x3A, after the inner wrapper is off. */
export function decodePursuitResponse(body: Uint8Array): PursuitResponse {
  const reader = new PacketReader(body, 1)
  const response: PursuitResponse = {
    kind: 'pursuitResponse',
    objectType: reader.u8(),
    objectId: reader.u32(),
    pursuit: reader.u16(),
    step: reader.u16()
  }
  if (!reader.hasMore) return response

  const argument = reader.u8()
  if (argument === ARGUMENT_CHOICE) return { ...response, choice: reader.u8() }
  if (argument === ARGUMENT_TEXT) return { ...response, text: reader.string8() }
  // No other argument type is emitted by any recovered client builder. Report
  // the prefix rather than reading bytes whose meaning is unknown.
  return response
}
