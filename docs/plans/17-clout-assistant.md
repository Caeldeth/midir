# WP17 — the Laborer (clout/labor assistant)

**Size:** L. **Depends on:** WP15 (to arrive), WP13 (to act), WP11 (to read the dialog). Read
`00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-67`.

**Both PRs are merged on `main`.** What is left needs a live game, and only that: the `npcTile` and
`steps` values for all 11 errands, and the three gestures the GUI check proves. An errand with no
steps walks to the map and stops rather than acting, so the current state fails safely.

**Name:** the feature is the **Laborer**. Earlier docs call it the "Clout Assistant". The full copy
rename is part of WP19's terminology work.

## As built (three PRs)

Built in two PRs off `main`, both provable with no game.

**PR1 — the protocol and matcher foundation.**

- `protocol/decode/pursuit.ts` decodes `SPursuitMessage 0x30`: the text, the options, and the
  text-entry fields. It flags `dialogType == 9` as `isProtected`, the credential pane. Both protocol
  sources agree on the layout and on this detection.
- `protocol/decode/dialog.ts` gains `decodeScreenMenu`: the bank first, then the general NPC menus
  (types 0, 2, 3, 6, 7). The registry points `0x2F` at it. The bank path is unchanged.
- `laborer/matcher.ts` is the pure matcher. It normalises both dialogs into one view and matches on
  the pursuit id and the row text, refuses an ambiguous match, and reports the credential pane first.
- `laborer/errands.ts` holds the built-in errands. The values need a live capture (see below).

**PR2 — the driver, the walk, and the UI.**

- `model/dialog.ts` (`reduceDialog`) keeps the newest dialog on screen per connection, stamped with
  the capture time, and `captureService.dialogFor` exposes it. The Laborer polls it the way the
  walker polls `positionFor`, so the whole driver runs from a scripted feed.
- The walker gains a within-map tile goal (`WalkRequest.tile`): after it reaches the map, it steps to
  a tile beside the NPC. This bridges the missing NPC coordinates until WP24.
- `laborer.ts` is the driver: walk, then read the dialog, match a step, post the keys, and wait for
  the next dialog before the next step. It stops on a protected pane, an unmatched dialog, a timeout,
  a lost character, or the global stop. Nothing sends a packet.
- The IPC, the preload, and a **Laborer tab** beside Walker and Speaker follow the Speaker shape.

**The gestures, as the live check of 2026-09-21 settled them:**

1. **Opening the first dialog is a click on the NPC** (`openConversation`), where the client draws
   it: the character's tile is drawn at (312, 199), measured from Sabrael's hand click on Eduardo
   (the middle of the world window across, and 42 px below the `MAP` region's middle down), and a
   tile (dx, dy) away is drawn at (dx − dy) × 28, (dx + dy) × 13.5 from there
   (`laborer/view.ts`). The errand's `npcTile` and the position off the wire give the point; the
   click aims a little above the tile at the body. Three clicks, each waited on for a dialog; then,
   or when the NPC's tile is not known, the player opens the conversation (`FIRST_DIALOG_WAIT_MS`,
   30 s). A spot to stand on is a preference: when the walker cannot reach it (someone stands
   there, or the map cache calls it a wall) it settles for a tile beside it, and when the walk
   still falls short on the right map within six tiles of the NPC, the errand goes on from where
   the character is (Gabrael at Mileth Town Hall, 2026-09-21). The pane watcher logs the view
   centre each hand click on a known NPC implies. The NPC
   tiles are the world repo's `Old*.xml`, except the officials (measured) and Riona (not in the
   xml; her errand still waits for the player's click).
2. **Selecting a row is a click, and nothing else.** The first live run posted the row's number key
   and the client sent nothing. The client's own layouts (`lnpcd.txt`, `lnpcd2.txt` in `setoa.dat`)
   give the row pitch (18 px) and the row's width (193 to 579 on screen); the hand run of the same
   night (forty clicks over 2-, 3-, 6-, and 12-row panes, paired by the pane watcher with the row the
   client sent) showed the pane grows upward: the last row's centre stays at y 335 and each row above
   is one pitch higher (`rowY`). Every measured click is within half a row of that.
3. **Answering a text field** uses `typeText`: characters into the field, which has focus when the
   dialog opens, then Enter. Not `typeLine`, whose opening Enter is for chat and would submit the
   field empty.
4. **Closing a notice dialog** (a `close` step) clicks the layout's `CloseBtn` (589, 461).

**The built-in errands name the real NPCs.** The roster is 11 errands, one for each NPC: six clout
(Maria, Angelo, Eduardo, Aingeal, Riona, Arilan) and five labor (Antonio, Cassidy, Jilt, Lamont,
Argus). Each entry names the NPC, the building it is in, and the tile to stand on (WP33). The
`steps` (the pursuit id and the row text) come from a recorded session, not a guess. The matcher
refuses any mismatch, so an errand with no steps walks to the NPC and stops rather than acting, and
its stop line names every pursuit id the dialog carried, so that run is itself the capture.

**PR3 — the clout conversation, from the recordings.**

- The three Rucesion clout errands have their steps. The conversation is the same on Maria, Angelo,
  and Eduardo, from four recordings (July and August 2026, and Sabrael's run of 2026-09-21 with the
  player's answers): the menu row "Rucesion Civics" (1612), then under the civic pursuit (588)
  "Support a Citizen", "I am sure", and the citizen's name into a text field.
- **An errand can take a parameter.** The citizen is `{citizen}`, asked for on the Laborer tab and
  filled into the step at run time (`Errand.params`, `ErrandRequest.params`, `fillStep`). No name is
  in the errand data, and the run refuses to start without a value.
- **A step can name the prose it expects (`when`).** The civic pursuit is one id for a whole
  conversation, so the pursuit alone does not say which dialog is up. A step with `when` matches
  only a dialog that says it; the matcher's order stays credential pane, pursuit and prose, row.
- **An errand can branch.** A second "Support a Citizen" inside the four-day window shows
  "<name> is in Temuair now. You can attempt to withdraw your support from the Aisling." in place of
  the confirmation. `Errand.branches` are tried when the next step does not match, and a branch's
  `then` says what follows: the wanted citizen is already supported, so `done`; another is, so
  "Withdraw support" and `restart` from the menu, which the player opens again. A second restart
  stops the run.
- The wait for the first dialog is its own, longer constant (`FIRST_DIALOG_WAIT_MS`): the player
  opens the conversation, and a player is slower than a server.
- The recorded exchange is a fixture (`laborer/__tests__/fixtures/clout-exchange-2026-09-21.json`),
  and the driver replays it whole and posts the keys the player pressed: acceptance criterion 1.
- **The five labor errands have their steps**, from Sabrael's capture of the same night (Evenue at
  Antonio): the menu row "Labor" (1335), then under the labor pursuit (311) "I want to work" and the
  Aisling's name into a text field, as `{aisling}`. An Aisling holds six days of labor, which come
  back over time. The ids are from recordings; a pursuit is a server-wide script id (588 on three
  civic NPCs, 0x56 on three banks), so Antonio's serve every bank NPC, and a wrong one is a safe
  stop that names the right one.
- **Five labor-fix errands**, one per bank NPC: "Labor", then "((labor fix))", then a notice dialog
  the errand closes and reports: "This will reset your labor to one hour. You can only do this
  once." the first time, "You have already reset your labor." when it is too soon (both captured).
- **`SSystemMessage 0x0A` is decoded** (`decode/message.ts`, WP32 decision 1 brought forward), and
  the newest notice is a live fact beside the dialog (`model/notice.ts`, `captureService.noticeFor`).
  The server's verdict on a step is often a notice, not a dialog: "(( Register first: … ))" for an
  unregistered character's Labor or civic action, "<name> doesn't need any jobs done" for a full
  Aisling. **A notice on its own is not a refusal**: the same packet carries "(( 4 Temauiran days =
  12 Terran hours ))" beside the confirmation, "You stop supporting …" beside the close after a
  withdrawal, and world chat. So the Laborer reads a notice only when a step of its own gets no
  dialog within the wait, and then stops with `serverNotice` and the first notice's text; and after
  the last step it waits `OUTCOME_WAIT_MS` for the server's word and reports it on `done`.

- **The Mileth clout errands have their ids** from Gabrael at Riona the same night: the menu row
  "Mileth Civics" (1603) and the civic pursuit (579), the same conversation as Rucesion's under
  its own two ids. Gabrael is unregistered, so that dialog offered only "Renounce Citizenship", and
  the rows past it are Sabrael's word that the labels match; a wrong one is a safe stop that names
  what it saw.

**Every errand has steps.** The labor verdicts the run reports on `done`, all captured: "You work
for <name> for 1 day" (a whole day given), "You work for <name>, although the Aisling didn't need
much done" (less than a day; the Aisling is full now), and "<name> doesn't need any jobs done. The
Aisling hasn't done anything" (nothing given). "You were distracted" with a close is the server's
exploit prevention, not a refusal (Sabrael): it means try again, so the run goes back to the first
step and waits for the player to open the conversation again, twice at most. What no capture reached yet:
the clout rows past the first dialog on a Mileth NPC, which a registered character's run will show.

**Two follow-ups this surfaced.** `WP33` (complete, 2026-09-21) made every errand destination
route: the walker crosses the world map, every building is a node, and each errand carries the tile
to stand on. What each errand still needs is its dialog `steps`, from a capture. `WP34` lets an
assistant dismiss a movement-blocking notice popup, which a walker reads as a stall today.

## Goal

Walk to the right NPC and work the dialog: the errand that is pure repetition. It is the first
feature that is neither of the legacy tools — it is what having both of them in one app, on top of
a protocol decode, makes possible.

## Why this is the feature the decode was for

The legacy tools cannot do this. DA Walker can arrive; DA Speaker can type; **neither can tell what
the dialog on screen actually says**, so a legacy attempt is a fixed sequence of keys on a timer,
and it desynchronises the first time the server says something unexpected.

Midir already reads the conversation. WP11 decodes both sides:

- `SScreenMenu 0x2F` — the menu the server is showing, its type, its pursuit id, and its rows.
- `SPursuitMessage 0x30` — the conversation step (**undecoded today**, and this WP's first job).
- `CMerchant 0x39` and `CPursuit 0x3A` — what the client sent back, wrapper and all.

So the loop is closed: **read the dialog state, choose the option, post the keys, confirm from the
next packet.** That is a different class of tool from a timed key sequence, and it is the argument
for folding these features into Midir rather than rewriting them standalone.

## The one way to get this wrong

**Choosing an option by its position on screen.** Menu rows move; a server-side change, a different
NPC, an extra option for a quest the character has open, and row 3 is no longer what it was. Choose
by **what the row says and what the pursuit id is**, both of which are in the packet, and refuse to
choose when the menu is not the one expected. A dialog automation that guesses is one that hands
over an item to the wrong NPC.

Second, close behind: **an automation that runs on without confirmation.** Every step waits for the
server's next dialog packet. If it does not come, the assistant stops — it never fires the next
keystroke into an unknown state.

## Decisions

1. **Decode `SPursuitMessage 0x30` first.** It is the half of the conversation Midir cannot see, and
   nothing else in this WP is safe without it. It has a page in both protocol sources; read both.
2. **A run is a script of expectations, not a script of keys.** Each step is "expect this dialog,
   answer with this option"; the driver matches, acts, and waits. Steps are data, so a new errand is
   a new list rather than new code. A branch is a step the server may show in place of the next
   one, with what follows it; the next step is always tried first (PR3).
3. **Every step is matched on pursuit id plus row text.** Position is a tiebreak, never the key.
   Where one pursuit id serves a whole conversation, the step also names the prose it expects
   (`when`), so the id and the words both have to agree (PR3).
4. **An unmatched dialog is a full stop, not a skip.** It says what it saw, in the log, so the next
   run can add the case. Silent recovery is how automations hand items to strangers.
5. **The dialog wrapper is read, never written — for now.** WP11 unwraps `0x39`/`0x3A` to read them.
   Writing one means WP18's proxy, the encrypt path, and the CRC — see below.
6. **Walking is WP15's problem.** This WP asks for a destination and waits for `arrived`. If the
   walker is not there yet, this WP is not either.
7. **The errand is named and explicit.** "Give N to X" is a script the user can read before running
   it. No hidden steps, no inferred goals. A value the user has to give, such as the citizen to
   support, is a declared parameter with a field on the tab, never a constant in the errand (PR3).
8. **It stops on anything unexpected**: an unmatched dialog, a lost character, a map change it did
   not ask for, a timeout, or the global stop.
9. **The Laborer drives one selected window** (WP13 decisions 9 and 10). It runs on the window the
   walker bound and foregrounded (WP15 decision 8); it does not choose a second window or fan out.

## Where the packet question actually lands

This is the one feature with a real argument for a forged packet. A dialog response is a single
`0x39` or `0x3A` with a known body; posting keys to select it is several keystrokes against a UI
that can move. **Build it on keys first anyway**, and only then decide:

- If the key-driven version is reliable in practice, WP18 never has to happen.
- If it is not, WP18 spikes the proxy, the encrypt path, the client integrity bytes, the submission
  terminator, and the `0x39`/`0x3A` wrapper as a **writer** — and this WP gains a second backend
  behind the same step interface.

Deciding after the key version exists is the whole reason "decide per feature" is a rule rather than
a coin toss. Do not build the packet path speculatively.

## Non-goals (stop-lines)

- **No unattended or scheduled running.** The user starts an errand and can watch it.
- **No inventory decisions.** The script names the item; the assistant does not choose what to give
  away.
- **No credential dialog, ever** — including the protected ID and password pane the protocol docs
  describe as a type-9 pursuit. If a run reaches one, it stops.
- **No purchasing, no selling, no banking of anything the script did not name.**
- **No forged packet before WP18 lands.**
- **No screen reading.** Everything comes from the wire.

## Current state when you start

- [decode/merchant.ts](../../src/main/protocol/decode/merchant.ts) — `0x39` and `0x3A` decoded,
  wrapper off, `0x3A`'s typed text included (WP11 decision 4, made for exactly this feature).
- [decode/dialog.ts](../../src/main/protocol/decode/dialog.ts) — `decodeBankContents` reads
  `SScreenMenu 0x2F` menu type 4; the general menu is not modelled, and this WP needs it.
- **`SPursuitMessage 0x30` has no decoder.** The document repo's `server/0x30-pursuit.md` and
  `darkages-741-re`'s `048-0x30-pursuit-message.md` both describe it, including the type-9 protected
  pane this WP must refuse.
- WP15's `walker:go`, WP13's `ActionLayer`.
- The recordings from 2026-07-23 contain real dialog exchanges to test the matcher against, and one
  of them is the clout errand itself.

## Contracts

```ts
export interface DialogStep {
  /** The pursuit the server must be showing for this step to apply. */
  pursuit: number
  /** Matched against the row text, case-insensitively. */
  choose: string
  /** For a text step: what to type. Never a credential. */
  answer?: string
}

export interface Errand {
  name: string
  destination: string | number
  npcName: string
  steps: DialogStep[]
}

export type ErrandOutcome =
  | { kind: 'done' }
  | {
      kind: 'stopped'
      reason: 'user' | 'unmatchedDialog' | 'timeout' | 'lostCharacter' | 'walker'
      saw?: string
    }
```

| Channel        | Shape                                        |
| -------------- | -------------------------------------------- |
| `errand:run`   | `(errand: Errand) => Promise<ErrandOutcome>` |
| `errand:stop`  | `(connectionId: string) => Promise<void>`    |
| `errand:state` | event: `{ connectionId, step, waitingFor }`  |

## Acceptance criteria

1. A recorded clout exchange replays through the matcher and selects the same options a player did.
   (PR3: the driver replays the 2026-09-21 exchange whole and posts the player's keys.)
2. A dialog whose rows moved is still matched, because the match is on text and pursuit.
3. A dialog that matches nothing stops the run and logs what it saw, including the pursuit id.
4. A step with no reply within the timeout stops the run.
5. The run refuses to start if the character is not the one named, or is not live.
6. A type-9 protected pursuit stops the run immediately, before any key is posted.
7. The global stop halts it between steps.
8. Nothing sends a packet.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. **The matcher is pure and gets the heaviest tests**, driven from the real recorded dialogs: the
   match, the moved row, the unmatched dialog, the protected pane.
3. The driver against WP13's fake action layer and a scripted packet feed — the whole run with no
   game.
4. GUI (hand to Sabrael, and the only check that proves it): one real errand, watched end to end,
   then a deliberate unmatched dialog to confirm it stops rather than guesses.
