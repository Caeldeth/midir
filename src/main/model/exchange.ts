import type { DecodedPacket } from '../protocol/decode'

/**
 * Turn a stream of decoded packets into the exchange window on screen now.
 *
 * A reducer beside the dialog reducer, and as pure. An exchange window holds
 * the character still like a dialog, and it opens without the player's asking
 * when another player drags an item onto them, so a walker that stalls reads
 * this beside the dialog (WP34).
 *
 * The window is `open` from SExchange 0x42 event 0 until the server closes it:
 * a cancel from either side, or the second accept. Then the client puts up a
 * one-button alert with the closing message, which never touches the wire, so
 * the state becomes `alert`: a caller that dismisses it can do so once, keyed
 * by the close's capture time, and nothing on the wire says when it went. A
 * lost packet clears the state, because the window on screen is then unknown.
 */

/**
 * The client's own cancel or accept, sent from the window's buttons. Kept
 * beside the window, and carried onto the alert, because the server's close
 * follows it within the same batch: a watcher that looked for it beside the
 * open window would never see it. The pane watcher pairs it with the hand
 * click before it, which is how the button's place on screen is measured.
 */
export interface ExchangeSent {
  action: 'cancel' | 'accept'
  /** Capture time of the client's packet. */
  asOfMs: number
}

/** The exchange window, or the alert the client shows once it closes. */
export type ExchangeState =
  | {
      kind: 'open'
      /** The other player. */
      partnerName: string
      /** Capture time of the event that opened it. */
      asOfMs: number
      /** The party bytes seen on accept events: 0 the player, other the partner. */
      accepted: number[]
      /** The client's newest cancel or accept, when it sent one. */
      sent?: ExchangeSent
    }
  | {
      kind: 'alert'
      /** The closing message the alert shows. */
      message: string
      /** Capture time of the close. */
      asOfMs: number
      /** The client's cancel or accept that led to the close, when there was one. */
      sent?: ExchangeSent
    }

/** One packet, with what the capture layer knows about it. */
export interface ExchangeInput {
  packet: DecodedPacket
  /** Capture time of the packet. */
  timestampMs: number
  /** True when bytes were lost on this connection since the previous packet. */
  sawLoss?: boolean | undefined
}

/** Apply one packet. Returns a new state and never changes the old one. */
export function reduceExchange(
  state: ExchangeState | null,
  input: ExchangeInput
): ExchangeState | null {
  if (input.sawLoss === true) return null
  const { packet, timestampMs } = input

  if (packet.kind === 'exchangeRequest') {
    if (state === null || state.kind !== 'open') return state
    if (packet.action !== 'cancel' && packet.action !== 'accept') return state
    return { ...state, sent: { action: packet.action, asOfMs: timestampMs } }
  }

  if (packet.kind !== 'exchange') return state
  const sent = state?.sent !== undefined ? { sent: state.sent } : {}

  switch (packet.event) {
    case 'started':
      return { kind: 'open', partnerName: packet.partnerName, asOfMs: timestampMs, accepted: [] }
    case 'cancelled':
      return { kind: 'alert', message: packet.message, asOfMs: timestampMs, ...sent }
    case 'accepted': {
      if (state === null || state.kind !== 'open') return state
      const accepted = state.accepted.includes(packet.party)
        ? state.accepted
        : [...state.accepted, packet.party]
      if (accepted.length >= 2) {
        return { kind: 'alert', message: packet.message, asOfMs: timestampMs, ...sent }
      }
      return { ...state, accepted }
    }
    default:
      // An offer update leaves the window as it is.
      return state
  }
}
