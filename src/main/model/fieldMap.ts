import type { DecodedPacket } from '../protocol/decode'
import type { FieldMap, FieldMapClick } from '../protocol/decode/fieldMap'

/**
 * Turn a stream of decoded packets into the world map on screen now.
 *
 * A reducer beside the position and the dialog, and as pure. The walker reads
 * it the way it reads the position: when a route hop crosses the world map, it
 * steps onto the edge tile, polls for this, clicks the point, and waits for the
 * map to change.
 *
 * The pane opens on SFieldMap 0x2E and goes away when the server moves the
 * character, which is SMapInfo 0x15. Nothing else clears it: the pane has no
 * cancel. A lost packet clears it too, because the pane may have opened or
 * closed in the gap Midir did not see.
 *
 * The client's own answer, CFieldMapClick 0x3F, is kept on the state as well.
 * It is the proof that a click selected a point: the pane sends it only after
 * a release over a point and its marker animation. A walker that posted a
 * click and sees no 0x3F knows the click missed, and can try again rather than
 * wait on a map change that will never come.
 */

/** The point the client sent, and when. */
export interface FieldMapClickState {
  packet: FieldMapClick
  /** Capture time of the click. */
  asOfMs: number
}

/** The world map on screen now, and when it opened. */
export interface FieldMapState {
  packet: FieldMap
  /** Capture time of the packet that opened it. */
  asOfMs: number
  /** The client's click on this pane, once it has sent one. */
  click?: FieldMapClickState
}

/** One packet, with what the capture layer knows about it. */
export interface FieldMapInput {
  packet: DecodedPacket
  /** Capture time of the packet. */
  timestampMs: number
  /** True when bytes were lost on this connection since the previous packet. */
  sawLoss?: boolean | undefined
}

/**
 * Apply one packet. Returns a new state and never changes the old one.
 *
 * Returns null while no world map is on screen: before the first one, after a
 * map change, and after a lost packet.
 */
export function reduceFieldMap(
  state: FieldMapState | null,
  input: FieldMapInput
): FieldMapState | null {
  if (input.sawLoss === true) return null

  const { packet, timestampMs } = input
  if (packet.kind === 'fieldMap') return { packet, asOfMs: timestampMs }
  // The server moved the character: the pane is gone.
  if (packet.kind === 'mapInfo') return null
  // The client answered the pane. A click with no pane is not one Midir saw
  // open, so there is nothing to attach it to.
  if (packet.kind === 'fieldMapClick') {
    if (state === null) return null
    return { ...state, click: { packet, asOfMs: timestampMs } }
  }
  return state
}
