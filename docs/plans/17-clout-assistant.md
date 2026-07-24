# WP17 — the Laborer (clout/labor assistant)

**Size:** L. **Depends on:** WP15 (to arrive), WP13 (to act), WP11 (to read the dialog). Read
`00-overview.md` first. **PLANNED.**

**Name:** the feature is the **Laborer**. Earlier docs call it the "Clout Assistant". The full copy
rename is part of WP19's terminology work.

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
   a new list rather than new code.
3. **Every step is matched on pursuit id plus row text.** Position is a tiebreak, never the key.
4. **An unmatched dialog is a full stop, not a skip.** It says what it saw, in the log, so the next
   run can add the case. Silent recovery is how automations hand items to strangers.
5. **The dialog wrapper is read, never written — for now.** WP11 unwraps `0x39`/`0x3A` to read them.
   Writing one means WP18's proxy, the encrypt path, and the CRC — see below.
6. **Walking is WP15's problem.** This WP asks for a destination and waits for `arrived`. If the
   walker is not there yet, this WP is not either.
7. **The errand is named and explicit.** "Give N to X" is a script the user can read before running
   it. No hidden steps, no inferred goals.
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
