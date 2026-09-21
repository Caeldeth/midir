import type { DecodedPacket } from '../protocol/decode'
import { SETTINGS_ROW, type SystemMessage } from '../protocol/decode/message'

/**
 * Turn a stream of decoded packets into the newest server notice.
 *
 * A reducer beside the dialog reducer, and as pure. The Laborer reads it
 * beside the dialog: a step that gets a system notice and a dialog close
 * instead of the next dialog was refused, and the notice is the reason. So
 * this keeps the newest SSystemMessage 0x0A the player could read, stamped
 * with its capture time, so a caller can tell a notice that answered its own
 * step from an older one.
 *
 * A settings row (type 0x07) is not a message to the player and is skipped.
 * A lost packet clears the state, because the newest notice is then unknown.
 */

/** The newest notice, and when it arrived. */
export interface NoticeState {
  packet: SystemMessage
  /** Capture time of the packet. */
  asOfMs: number
}

/** One packet, with what the capture layer knows about it. */
export interface NoticeInput {
  packet: DecodedPacket
  /** Capture time of the packet. */
  timestampMs: number
  /** True when bytes were lost on this connection since the previous packet. */
  sawLoss?: boolean | undefined
}

/** Apply one packet. Returns a new state and never changes the old one. */
export function reduceNotice(state: NoticeState | null, input: NoticeInput): NoticeState | null {
  if (input.sawLoss === true) return null
  const { packet, timestampMs } = input
  if (packet.kind !== 'systemMessage') return state
  if (packet.messageType === SETTINGS_ROW) return state
  return { packet, asOfMs: timestampMs }
}
