# WP34 — dismiss the dialog popups that block movement

**Size:** S. **Depends on:** WP11 and WP17 PR1 (the dialog decode), WP15 (the walker), WP14 (the
position). Read `00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-83`.

**Built 2026-09-21; both popups proven live.** The walker reads what is on screen before a missed
step counts as a stall (`checkPopup` in `walker.ts`). A dialog gets a click on its Close button and
is never answered; one that survives the click stops the walk with the reason `dialog`, and the
credential pane stops it with `protected` before any click. An exchange is two popups: the window,
which gets Escape (its own cancel, never OK), and the "Exchange cancelled." confirm the client
shows once the window is gone, which gets an Escape of its own. The rule and the gestures live in
`dialogScreen.ts`, shared with the Laborer's close step.

**A posted key is not a pressed key until it carries everything a press does.** The second live
run posted Escape at the prayer invite and at the exchange window, and both stayed up; the Close
click then closed the dialog, and a click at the exchange's Cancel from a guessed pane position
missed. Then Sabrael pressed Escape by hand and the exchange cancelled at once. The posted Escape
was key-down and key-up alone, with no scan code; a real press also delivers `WM_CHAR` 0x1B, and a
pane that reads characters (as the dialog's text field does) sees only that. `pressKey` now posts
Escape with its scan code and its character, and the exchange goes back to Escape; the run of
11:45Z cancelled on it.

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

The exchange has two things the dialog does not. Its cancel is Escape, and the pane's Cancel
button has no known place: the layout (`_nexch.txt`) gives the button inside the pane (136 to 197
by 252 to 274 of a 421 x 296 pane) but not where the client puts the pane, and a click at (276,
355), the button with the pane centred on the canvas, missed. If Escape fails again the button is
measured, not guessed: the pane watcher logs a hand click while the exchange is up and pairs it
with the client's `0x4A` cancel (decoded for this), the way the dialog rows were measured.

And when the server closes the window (a cancel from either side, or the second accept), the client
puts up a one-button confirm with the closing message ("Exchange cancelled."), and that confirm is
local: nothing on the wire says it is up, and nothing says when it went. It holds the character
still like the window (the run of 11:45Z: three stalls on it after "The exchange closed"). The
reducer holds an `alert` state from the close, and the walker gives it one Escape, keyed to that
close, on the first stall after — Escape dismisses it by hand (Sabrael) — with no wait, because
nothing on the wire can confirm it went. Its button is at game (403, 167), from Sabrael's hand
click logged by the pane watcher, should the key ever fail.

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
   **Taken, and corrected live:** the dialog closes on a click on its Close button at (589, 461),
   proven by the Laborer's labor-fix step in WP17 and again here (the run of 2026-09-21 11:29Z: the
   dialog stayed up through a posted Escape and closed on the click). The exchange cancels on
   Escape, by hand at once; the posted Escape of 11:29Z lacked the character message a real press
   delivers, and carries it now. One gesture per popup; a popup still up after it stops the walk as
   `dialog`, so nothing loops.
3. **The walker gains a "clear a notice" step** before it calls a stall a block: if a no-choice
   dialog is on screen, close it and retry the step rather than counting it as a stall. **Taken:**
   both walk loops (map to map, and to a tile) call `checkPopup` on a missed step that was not a
   turn. A click is followed by a wait of up to 1.5 s for the server's close to leave the wire,
   then the step is retried with no stall counted.
4. **Never a credential pane** (dialogType 9), and never a dialog the errand did not expect while an
   errand runs — WP17's stop-lines hold. **Taken:** the pane stops the walk with `protected` before
   any click; every other dialog is closed (decision 1), and the log names it. The Laborer reads
   no dialog until its walk has ended, so a dialog the walker closes mid-walk is never one an
   errand expected.
5. **An exchange is cancelled, never accepted.** Escape sends the player's own cancel, which loses
   nothing: every offer goes back. An accept would give something away, so no gesture of the
   walker's reaches OK, and an exchange the player set up with items in it is cancelled like any
   other — the walker was not running for a reason if the player was trading. One Escape per
   window; a window still open after it stops the walk as `dialog`.

## Non-goals

- **No answering a menu or a text field to get past it.** A dialog is closed, never chosen.
- **No packet.** The close is a posted key, like every other assistant action.

## Acceptance criteria

1. A plain-text notice that blocks a walk is closed, and the walk continues, in a replay with a
   scripted dialog feed. **Unit test passes** (`walker.test.ts`, "a popup mid-walk"): the Close
   click clears it and the walk arrives, with no key posted at the pane; a client that ignores the
   click gets it once and then `dialog`. **Live 2026-09-21 11:29Z**: the prayer invite closed on
   the click and the walk went on.
2. A dialog with options or input is never auto-answered. **Unit test passes**: the prayer invite
   of the live try is closed and no row is clicked; a text field the same.
3. A dialogType-9 pane is never closed and always stops the run. **Unit test passes**: `protected`,
   with no click and no key; the only key posted was the step whose miss revealed the pane.
4. Nothing sends a packet. **Holds by construction**: the walker's only calls are `pressKey` and
   `click`.
5. An exchange window mid-walk is cancelled and the walk continues. **Unit test passes**: one
   Escape for the window and one for its confirm, no click, arrived; a window still open after its
   Escape stops as `dialog`. The decoders (`0x42`, `0x4A`), the reducer (the accept that closes
   only on the second side; the client's cancel carried onto the alert), and the action layer
   (Escape posted as down with scan code, character, up) have their own tests. **Live 2026-09-21
   11:45Z**: "pressing Escape to cancel it" → "The exchange closed; retrying the step." on the
   third posted form (a bare key and a click at a guessed point had failed); the confirm's Escape
   is from Sabrael's hand and the next run.

## Live check (hand to Sabrael)

The unit tests prove the logic against a scripted feed. What they could not prove was what the
client does with a posted key, and that is now the log's:

1. **Dialog, done (11:29Z)**: the prayer invite closed on the Close click.
2. **Exchange window, done (11:45Z)**: "pressing Escape to cancel it" → "The exchange closed;
   retrying the step."
3. **Exchange confirm, next run**: after "The exchange closed", the first stall should read "The
   exchange's closing alert ("Exchange cancelled.") is on screen; pressing Escape." and the walk go
   on. If the stalls run to `blocked` instead, the key did not reach it, and the walker clicks its
   button at (403, 167), Sabrael's hand click of 11:46Z.
