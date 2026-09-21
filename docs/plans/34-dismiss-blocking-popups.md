# WP34 — dismiss the dialog popups that block movement

**Size:** S. **Depends on:** WP11 and WP17 PR1 (the dialog decode), WP15 (the walker), WP14 (the
position). Read `00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-83`.

**Built 2026-09-21; the live check is what is left.** The walker reads what is on screen before a
missed step counts as a stall (`checkPopup` in `walker.ts`). A dialog gets Escape, then the Close
click if it is still up on the next stall, and is never answered; one that survives both stops the
walk with the reason `dialog`, and the credential pane stops it with `protected` before any key. An
exchange window is cancelled with Escape and never accepted. The rule and the two gestures live in
`dialogScreen.ts`, shared with the Laborer's close step.

**The first live try (on the pre-WP34 build, as the log showed) named the two popups that matter.**
The popups Sabrael can make on demand are another character's doing: an exchange window (an item
dragged onto the walking one), which is `SExchange 0x42` and not a dialog at all; and a prayer
invite from a Ceannlaidir necklace, which is a `0x30` **with options** — "Evenue is praying to
Ceannlaidir." with No, Assist, and a curse. The first cut would have stopped on the second by
design, "never a menu". That rule was aimed at the wrong thing: the danger was ever _answering_ a
menu, and a close answers nothing. So the rule is now **close, never choose**, and `0x42` is decoded
(`decode/exchange.ts`) with a reducer for the window (`model/exchange.ts`).

**Trigger:** surfaced by WP17. A server dialog popup — a clout notice, a level-up, an item prompt —
stops the character moving until the player dismisses it. To the walker this looks like a stall, and
after a few stalls the walker stops with `blocked`. This WP starts when a driving assistant meets a
popup in normal use.

## Goal

Let a driving assistant clear a movement-blocking popup on its own, so a walk or an errand does not
stop for a dialog the player would have clicked away.

## Why Midir can do this

The popup is a packet Midir decodes. WP11 and WP17 PR1 read `SPursuitMessage 0x30` and
`SScreenMenu 0x2F`, and the dialog seam (`model/dialog.ts`, `captureService.dialogFor`) already keeps
the one on screen. The exchange window is `SExchange 0x42`, one packet for open, offer, cancel and
accept, and `model/exchange.ts` keeps it the same way. So a walker that stalls can ask "is a popup
up?" and clear it, rather than treating it as a wall.

The exchange has one thing the dialog does not. When the server closes it (a cancel from either
side, or the second accept), the client puts up a one-button alert with the closing message, and
that alert is local: nothing on the wire says it is up, and nothing says when it went. The reducer
holds an `alert` state from the close, and the walker gives it one Escape, keyed to that close, so a
retried step is not posted into it and no second Escape follows.

## The one way to get this wrong

**Answering a dialog that carries a decision.** A clear-the-popup reflex must never choose a row,
type into a field, or accept an exchange. Closing sends the same "close" the player would, and the
server reads it as no answer; choosing makes a choice the player did not. And the credential pane
(dialogType 9) is never touched, closed or otherwise.

## Decisions to take when this is built

1. **Close, never choose.** Planned as "close only a no-choice dialog", and changed on the first
   live try (above): the walker opens no dialog, so one on screen mid-walk was pushed on the
   character, and a close is what the player does with it whatever its rows say. **Taken:** every
   `0x30` and `0x2F` dialog but the credential pane is closed the same way; no gesture of the
   walker's is a row click, a keystroke into a field, or an accept. The Laborer keeps its own
   stricter rule, because its dialogs are ones it asked for and a wrong close there loses the
   errand.
2. **Close the way the client does**, with the same key the player presses to dismiss a notice.
   **Taken:** Escape cancels a popup (Sabrael, 2026-09-21), so the walker posts Escape first. The
   Close button click at (589, 461), proven by the Laborer's labor-fix step in WP17, is the second
   gesture, posted on the next stall if the notice is still up. Each gesture goes once per popup;
   after both, the stall count runs as for a wall, so a popup the client keeps up never loops.
3. **The walker gains a "clear a notice" step** before it calls a stall a block: if a no-choice
   dialog is on screen, close it and retry the step rather than counting it as a stall. **Taken:**
   both walk loops (map to map, and to a tile) call `checkPopup` on a missed step that was not a
   turn. A gesture is followed by a wait of up to 1.5 s for the server's close to leave the wire,
   then the step is retried with no stall counted.
4. **Never a credential pane** (dialogType 9), and never a dialog the errand did not expect while an
   errand runs — WP17's stop-lines hold. **Taken:** the pane stops the walk with `protected` before
   any key; a menu or a text field stops it with `dialog`, and the log names the dialog. The Laborer
   reads no dialog until its walk has ended, so a notice it clears mid-walk is never one an errand
   expected.
5. **An exchange is cancelled, never accepted.** Escape sends the player's own cancel, which loses
   nothing: every offer goes back. An accept would give something away, so no gesture of the
   walker's reaches the accept button, and an exchange the player set up with items in it is
   cancelled like any other — the walker was not running for a reason if the player was trading.
   One Escape per window; a window the client keeps open is left to the stall count.

## Non-goals

- **No answering a menu or a text field to get past it.** A dialog is closed, never chosen.
- **No packet.** The close is a posted key, like every other assistant action.

## Acceptance criteria

1. A plain-text notice that blocks a walk is closed, and the walk continues, in a replay with a
   scripted dialog feed. **Unit test passes** (`walker.test.ts`, "a popup mid-walk"): Escape clears
   it and the walk arrives; a client that ignores Escape gets the click; a client that ignores both
   gets each gesture once and then `blocked`.
2. A dialog with options or input is never auto-answered. **Unit test passes**: the prayer invite
   of the live try is closed with Escape and no row is clicked; a text field the same; a dialog that
   survives Escape and the Close click stops with `dialog`.
3. A dialogType-9 pane is never closed and always stops the run. **Unit test passes**: `protected`,
   with no Escape and no click; the only key posted was the step whose miss revealed the pane.
4. Nothing sends a packet. **Holds by construction**: the walker's only calls are `pressKey` and
   `click`.
5. An exchange window mid-walk is cancelled and the walk continues. **Unit test passes**: one
   Escape for the window, one for its alert, arrived; a window the client keeps open gets one
   Escape and then `blocked`. The decoder and the reducer have their own tests, including the
   accept that closes only on the second side.

## Live check (hand to Sabrael)

The unit tests prove the logic against a scripted feed. The one fact they cannot prove is which
gesture the client honours on a real popup:

1. Start a walk, and have a second character drag an item onto the walking one. Read the walker
   log: "An exchange with X is on screen; pressing Escape to cancel it." then "The exchange closed;
   retrying the step." then, on the next stall, "The exchange's closing alert (…) may be on screen;
   pressing Escape." and the walk goes on. If the walk stops `blocked` after those lines, the alert
   did not take Escape, and its button needs a measured click: the pane watcher logs a hand click on
   it.
2. Start a walk, and make a notice pop up mid-walk (a `0x30` text dialog). Read the log: "A notice
   is on screen (…); pressing Escape." then either "The notice closed; retrying the step." (Escape
   works, done) or "clicking Close at game (589, 461)" on the next stall.
3. If the click closes the notice and Escape did not, swap the order in `checkDialog` and note it
   here.
