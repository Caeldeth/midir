# WP34 — dismiss the dialog popups that block movement

**Size:** S. **Depends on:** WP11 and WP17 PR1 (the dialog decode), WP15 (the walker), WP14 (the
position). Read `00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-83`.

**Built 2026-09-21; the live check is what is left.** The walker reads the dialog on screen before
a missed step counts as a stall (`checkPopup` in `walker.ts`). A plain notice gets Escape, then the
Close click if it is still up on the next stall; a dialog that asks something stops the walk with
the reason `dialog`, and the credential pane stops it with `protected` before any key. The rule and
the two gestures live in `dialogScreen.ts`, shared with the Laborer's close step.

**Trigger:** surfaced by WP17. A server dialog popup — a clout notice, a level-up, an item prompt —
stops the character moving until the player dismisses it. To the walker this looks like a stall, and
after a few stalls the walker stops with `blocked`. This WP starts when a driving assistant meets a
popup in normal use.

## Goal

Let a driving assistant clear a movement-blocking popup on its own, so a walk or an errand does not
stop for a dialog the player would have clicked away.

## Why Midir can do this

The popup is a packet Midir already decodes. WP11 and WP17 PR1 read `SPursuitMessage 0x30` and
`SScreenMenu 0x2F`, and the dialog seam (`model/dialog.ts`, `captureService.dialogFor`) already keeps
the one on screen. So a walker that stalls can ask "is a dialog up?" and clear it, rather than
treating it as a wall.

## The one way to get this wrong

**Dismissing a dialog that carries a decision.** A clear-the-popup reflex must never answer a menu, a
text field, or a credential pane — only close a dialog that is purely a notice. Closing sends the
same "close" the player would; answering makes a choice the player did not. And the credential pane
(dialogType 9) is never touched, closed or otherwise.

## Decisions to take when this is built

1. **Close only a no-choice dialog.** A plain-text notice (dialogType 0/1, no options, no input) is
   safe to close. Anything with options or input stops the assistant, exactly as WP17 already does.
   **Taken:** `isPlainNotice` in `dialogScreen.ts` is the one test; a `0x2F` menu never passes it.
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

## Non-goals

- **No answering a menu or a text field to get past it.** Only a no-choice notice is closed.
- **No packet.** The close is a posted key, like every other assistant action.

## Acceptance criteria

1. A plain-text notice that blocks a walk is closed, and the walk continues, in a replay with a
   scripted dialog feed. **Unit test passes** (`walker.test.ts`, "a popup mid-walk"): Escape clears
   it and the walk arrives; a client that ignores Escape gets the click; a client that ignores both
   gets each gesture once and then `blocked`.
2. A dialog with options or input still stops the assistant; it is never auto-answered. **Unit test
   passes**: a menu and a text field both stop with `dialog`, with no key or click posted.
3. A dialogType-9 pane is never closed and always stops the run. **Unit test passes**: `protected`,
   with no Escape and no click; the only key posted was the step whose miss revealed the pane.
4. Nothing sends a packet. **Holds by construction**: the walker's only calls are `pressKey` and
   `click`.

## Live check (hand to Sabrael)

The unit tests prove the logic against a scripted feed. The one fact they cannot prove is which
gesture the client honours on a real popup:

1. Start a walk, and make a notice pop up mid-walk (a clout verdict from a second character, or any
   server notice that opens a `0x30` text dialog).
2. Read the walker log: "A notice is on screen (…); pressing Escape." then either "The notice
   closed; retrying the step." (Escape works, done) or "clicking Close at game (589, 461)" on the
   next stall.
3. If the click closes it and Escape did not, swap the order in `checkPopup` and note it here.
