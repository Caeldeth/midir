import type { DialogState } from './model/dialog'

/**
 * The dialog facts a driving assistant shares: which dialog is safe to
 * dismiss, and the two gestures that dismiss one.
 *
 * A dialog on screen stops the character moving until the player clears it.
 * The walker meets one mid-walk (a clout notice, a level-up), and the Laborer
 * closes one as a step of an errand. Both read the same rule and post the
 * same gestures, so the rule lives here and not in either.
 *
 * ## Which dialog may be dismissed
 *
 * Only a plain notice: SPursuitMessage 0x30 with dialogType 0 or 1, which
 * carries prose and no choice. A menu (0x2F, or 0x30 with options), a text
 * field, and the credential pane (dialogType 9) are the player's to answer,
 * and an assistant stops when it meets one it did not expect. Closing a
 * notice sends what the player's own close sends; answering a menu makes a
 * choice the player did not.
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

/**
 * Whether the dialog is a plain notice: prose and no choice. Only this may be
 * dismissed without a step that names it.
 */
export function isPlainNotice(dialog: DialogState): boolean {
  return dialog.packet.kind === 'pursuitMessage' && dialog.packet.dialogKind === 'text'
}

/** Whether the dialog is the credential pane, which no assistant touches. */
export function isProtectedDialog(dialog: DialogState): boolean {
  return dialog.packet.kind === 'pursuitMessage' && dialog.packet.isProtected
}
