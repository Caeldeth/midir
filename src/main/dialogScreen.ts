import type { DialogState } from './model/dialog'

/**
 * The dialog facts a driving assistant shares: which dialog it must never
 * touch, and the gesture that closes one.
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
 * ## The gestures
 *
 * A dialog is closed by a click on its Close button: `CloseBtn` in
 * `lnpcd.txt` (`setoa.dat`), 559 to 620 by 450 to 472, clicked at (589, 461).
 * Sabrael's own close landed at (600, 461), the Laborer's click there closed
 * the labor-fix notice in the live run that finished WP17, and the walker's
 * closed the prayer invite in the live run of WP34. A posted Escape did not
 * close that dialog.
 *
 * An exchange window is cancelled by Escape, which is its own Cancel
 * (Sabrael, 2026-09-21: by hand it cancels the window at once). A posted
 * Escape as key-down and key-up alone did not; a real press also delivers
 * the WM_CHAR, and `pressKey` posts that now. The window's Cancel button is
 * in `_nexch.txt` (136 to 197 by 252 to 274 of a 421 x 296 pane) but the
 * layout does not say where the client puts the pane, and a click at the
 * centred guess (276, 355) missed, so there is no button click until the
 * pane watcher measures one from a hand click paired with the client's
 * cancel.
 */

/** The dialog's Close button, in the game's 640 x 480 space. */
export const CLOSE_BUTTON = { x: 589, y: 461 }

/** Whether the dialog is the credential pane, which no assistant touches. */
export function isProtectedDialog(dialog: DialogState): boolean {
  return dialog.packet.kind === 'pursuitMessage' && dialog.packet.isProtected
}
