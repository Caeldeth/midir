# WP34 — dismiss the dialog popups that block movement

**Size:** S. **Depends on:** WP11 and WP17 PR1 (the dialog decode), WP15 (the walker), WP14 (the
position). Read `00-overview.md` first. **PLANNED.**

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
2. **Close the way the client does**, with the same key the player presses to dismiss a notice. That
   key is the live-check fact, like the walker's arrow keys.
3. **The walker gains a "clear a notice" step** before it calls a stall a block: if a no-choice
   dialog is on screen, close it and retry the step rather than counting it as a stall.
4. **Never a credential pane** (dialogType 9), and never a dialog the errand did not expect while an
   errand runs — WP17's stop-lines hold.

## Non-goals

- **No answering a menu or a text field to get past it.** Only a no-choice notice is closed.
- **No packet.** The close is a posted key, like every other assistant action.

## Acceptance criteria

1. A plain-text notice that blocks a walk is closed, and the walk continues, in a replay with a
   scripted dialog feed.
2. A dialog with options or input still stops the assistant; it is never auto-answered.
3. A dialogType-9 pane is never closed and always stops the run.
4. Nothing sends a packet.
