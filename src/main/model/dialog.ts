import type { DecodedPacket } from '../protocol/decode'
import type { NpcMenu } from '../protocol/decode/dialog'
import type { MerchantResponse, PursuitResponse } from '../protocol/decode/merchant'
import type { PursuitMessage } from '../protocol/decode/pursuit'

/**
 * Turn a stream of decoded packets into the NPC dialog on screen now.
 *
 * This is a third reducer, beside the character reducer and the position
 * reducer, and just as pure. The Laborer reads it the way the walker reads the
 * position: it polls the latest dialog, acts, and waits for a new one. So this
 * keeps only the newest server dialog on the connection, stamped with the time
 * it was captured, so a caller can tell a fresh dialog from the one it already
 * answered.
 *
 * Two server packets carry a dialog: SPursuitMessage 0x30 (a scripted
 * conversation) and SScreenMenu 0x2F (an NPC menu). A dialog stays on screen
 * until the server closes it or replaces it, so an ordinary packet in between
 * leaves the state alone. A close (0x30 dialogType 10) clears it, and a lost
 * packet clears it too, because a dropped dialog packet means the state on
 * screen is no longer known.
 */

/** The dialog on screen now, and when it arrived. */
export interface DialogState {
  packet: PursuitMessage | NpcMenu
  /** Capture time of the packet that set it. */
  asOfMs: number
}

/**
 * The client's newest answer to a dialog: CMerchant 0x39 for a menu, CPursuit
 * 0x3A for a pursuit, with the dialog it answered.
 *
 * A separate fact from the dialog on screen, because the answer outlives it:
 * the server replies within tens of milliseconds, and the capture delivers
 * both packets in one batch, so a poller that looked for the answer beside the
 * dialog would never see it. The pane watcher pairs this with the hand click
 * before it, which is how a row's screen position is learned.
 */
export interface DialogAnswer {
  packet: MerchantResponse | PursuitResponse
  /** Capture time of the answer. */
  asOfMs: number
  /** The dialog that was on screen when the client answered. */
  dialog: PursuitMessage | NpcMenu
}

/** One packet, with what the capture layer knows about it. */
export interface DialogInput {
  packet: DecodedPacket
  /** Capture time of the packet. */
  timestampMs: number
  /** True when bytes were lost on this connection since the previous packet. */
  sawLoss?: boolean | undefined
}

/**
 * Apply one packet. Returns a new state and never changes the old one.
 *
 * Returns null while no dialog is on screen: before the first dialog, after a
 * close, and after a lost packet.
 */
export function reduceDialog(state: DialogState | null, input: DialogInput): DialogState | null {
  // A lost packet may have been the close, or a new dialog Midir never saw. The
  // dialog on screen is no longer known, so forget it.
  if (input.sawLoss === true) return null

  const { packet, timestampMs } = input

  if (packet.kind === 'pursuitMessage') {
    if (packet.dialogKind === 'close') return null
    return { packet, asOfMs: timestampMs }
  }

  if (packet.kind === 'npcMenu') return { packet, asOfMs: timestampMs }

  // Every other packet, the bank included, leaves the dialog on screen alone.
  return state
}

/**
 * Apply one packet to the newest answer. `dialog` is the dialog on screen
 * before this packet. An answer with no dialog up is not an answer to
 * anything Midir saw, and is dropped.
 */
export function reduceAnswer(
  state: DialogAnswer | null,
  dialog: DialogState | null,
  input: DialogInput
): DialogAnswer | null {
  if (input.sawLoss === true) return null
  const { packet, timestampMs } = input
  if (packet.kind !== 'merchantResponse' && packet.kind !== 'pursuitResponse') return state
  if (dialog === null) return state
  return { packet, asOfMs: timestampMs, dialog: dialog.packet }
}
