import type { DialogState } from './model/dialog'

/**
 * The dialog facts a driving assistant shares: which dialog it must never
 * touch, and the click that closes one.
 *
 * A dialog on screen stops the character moving until the player clears it.
 * The walker meets one mid-walk (a verdict, another player's prayer or
 * fellowship invite), and the Laborer closes one as a step of an errand.
 * Both read the same rule and post the same gestures, so the rule lives here
 * and not in either.
 *
 * ## Close, never choose
 *
 * A close chooses no row and types no text: it is the pane's own Close, what
 * the player does with a dialog they did not ask for, and the server reads
 * it as no answer. So an assistant may close any dialog it did not open, and
 * must never answer one it did not expect. The one dialog no assistant
 * touches is the credential pane (dialogType 9): it stops before any key.
 *
 * ## The gesture is a click, never a key
 *
 * Escape cancels a popup by hand, and a posted Escape does nothing: the
 * live run of 2026-09-21 posted it at a dialog and at an exchange window and
 * both stayed up, as a posted digit does nothing on a dialog row. A posted
 * click is honoured. So every dismiss is a click on the pane's own button.
 *
 * The dialog's Close button is `CloseBtn` in `lnpcd.txt` (`setoa.dat`), 559
 * to 620 by 450 to 472, clicked at (589, 461); Sabrael's own close landed at
 * (600, 461), the Laborer's click there closed the labor-fix notice in the
 * live run that finished WP17, and the walker's closed the prayer invite in
 * the live run of WP34.
 *
 * The exchange window is `_nexch.txt`: a 421 x 296 pane with OK at 46 to 107
 * and Cancel at 136 to 197, both 252 to 274, from the pane's own origin. The
 * layout does not say where the client puts the pane; `EXCHANGE_CANCEL` is
 * the middle of Cancel with the pane centred on the 640 x 480 canvas, and it
 * is a guess until the pane watcher's pairing of a hand click with the
 * client's cancel confirms or corrects it. Under every other origin the pane
 * could have, that point is outside the pane or on Cancel, never on OK.
 */

/** The dialog's Close button, in the game's 640 x 480 space. */
export const CLOSE_BUTTON = { x: 589, y: 461 }

/** The exchange window's Cancel button, in the game's 640 x 480 space. See above. */
export const EXCHANGE_CANCEL = { x: 276, y: 355 }

/** Whether the dialog is the credential pane, which no assistant touches. */
export function isProtectedDialog(dialog: DialogState): boolean {
  return dialog.packet.kind === 'pursuitMessage' && dialog.packet.isProtected
}
