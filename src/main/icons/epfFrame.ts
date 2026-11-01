import { epfFrameHeight, epfFrameWidth, type EpfFrame } from '@eriscorp/dalib-ts'

/**
 * True when an EPF frame has pixels to draw.
 *
 * Since dalib-ts 3.2.0 an EPF keeps each zero-size frame as a placeholder, so
 * that frame N is the client's animation frame N. Before, the parser dropped
 * these frames, and each later frame moved down one index. `renderEpf` draws a
 * placeholder as one transparent pixel. That is not an icon, and in the doll it
 * counts as a body that draws nothing. So every renderer asks this first and
 * answers "no frame" for a placeholder.
 */
export function hasPixels(frame: EpfFrame): boolean {
  return epfFrameWidth(frame) > 0 && epfFrameHeight(frame) > 0
}
