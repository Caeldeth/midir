import { PacketReader } from '../reader'

/**
 * SSystemMessage 0x0A, the server's general text packet.
 *
 * One packet carries chat lines, the red system notice, the settings rows,
 * a scrollable popup, and a two-button confirmation prompt; the type byte
 * decides which pane shows the text. Both protocol sources agree on the body,
 * and darkages-741-re gives the type table from the client's consumers:
 *
 *   0x00 to 0x06  a line in the message history (0x03 is the system notice,
 *                 white in the overlay and red in the history)
 *   0x07          a settings row for the game settings dialog, not a message
 *   0x08 to 0x0A  a scrollable popup
 *   0x0B, 0x0C    a line in the message history, with its own palette
 *   0x11          the confirmation prompt (UserConfirmPane), answered by
 *                 CConfirm 0x31, with three prefix bytes the reply echoes
 *   0x12          a line in the score pane
 *
 * Body after the opcode: `[u8 type]`, then for type 0x11 only
 * `[u8 value0][u8 value1][string8 value]`, then `[string16 text]`. The text is
 * a byte string, not Unicode, and may hold the client's `{=x` colour codes.
 *
 * The one reading that matters to a driving assistant: a step that gets a
 * system notice and a dialog close instead of the next dialog was refused, and
 * the notice says why. "(( Register first: www.darkages.com …" is what an
 * unregistered character gets for Labor and for a civic action (Sabrael's
 * capture of 2026-09-21). WP32 reads the same packet for registration.
 */
export interface SystemMessage {
  kind: 'systemMessage'
  /** The display type. See the table above. */
  messageType: number
  /** The text, as the server wrote it. */
  text: string
  /** The confirmation prompt's reply context, on type 0x11 only. */
  confirm?: { value0: number; value1: number; value: string }
}

/** The type of the red system notice. */
export const SYSTEM_NOTICE = 0x03

/** The type of a settings row, which is not a message to the player. */
export const SETTINGS_ROW = 0x07

/** The type of the two-button confirmation prompt. */
export const CONFIRM_PROMPT = 0x11

/** Decode SSystemMessage 0x0A. */
export function decodeSystemMessage(body: Uint8Array): SystemMessage {
  const reader = new PacketReader(body, 1)
  const messageType = reader.u8()
  if (messageType === CONFIRM_PROMPT) {
    const value0 = reader.u8()
    const value1 = reader.u8()
    const value = reader.string8()
    const text = reader.string16()
    return { kind: 'systemMessage', messageType, text, confirm: { value0, value1, value } }
  }
  return { kind: 'systemMessage', messageType, text: reader.string16() }
}
