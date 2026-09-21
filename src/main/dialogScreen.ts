import type { DialogState } from './model/dialog'

/**
 * The dialog facts a driving assistant shares: which dialog it must never
 * touch, and the two gestures that close one.
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
 * Escape cancels a popup (Sabrael, 2026-09-21). It is the key the player
 * presses, it needs no geometry, and it works however tall the pane grows.
 * The Close button is the second gesture: `CloseBtn` in `lnpcd.txt`
 * (`setoa.dat`), 559 to 620 by 450 to 472, clicked at (589, 461); Sabrael's
 * own close landed at (600, 461), and the Laborer's click there closed the
 * labor-fix notice in the live run that finished WP17. The walker posts
 * Escape first and the click if the dialog is still up, so the live check
 * says which one the client honours on a popup.
 */

/** The dialog's Close button, in the game's 640 x 480 space. */
export const CLOSE_BUTTON = { x: 589, y: 461 }

/** Whether the dialog is the credential pane, which no assistant touches. */
export function isProtectedDialog(dialog: DialogState): boolean {
  return dialog.packet.kind === 'pursuitMessage' && dialog.packet.isProtected
}
