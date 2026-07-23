# WP10 — the live character's lifecycle

**Size:** S. **Depends on:** WP4. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `8f56f3e`
(PR #5).

> Retrospective. Written after the fact from the commit; it records what shipped and why.

## What shipped

A character stops being shown as logged in when they log off.

- **`protocol/decode/client.ts`** — `decodeClientExit` for `CClientExit 0x0B`.
- **`captureService.ts`** — live characters keyed by connection id, cleared by an exit or a close.

## The bug it fixed

Nothing ever cleared the name, so a character stayed "logged in" in the title bar until capture
stopped.

## The protocol fact, and the trap in it

**Logging off is two packets, and only the second one counts.** `CClientExit 0x0B` sends
`endSignal = 1` when the quit dialog **opens** and `endSignal = 0` when the player **confirms**.
Reading them the other way round reports a player gone every time they open the prompt and change
their mind. A live capture shows the exchange six times, identically:

```text
C->S  0b 01 00     the dialog opened
S->C  4c 01 00 00  the server acknowledges
C->S  0b 00 00     the player confirmed
then the world connection closes, and the login connection after it
```

The third byte is not a field.

## Decisions that are load-bearing

1. **A logged-in character belongs to its connection, not to the service.** `liveCharacters` is a
   map keyed by connection id, so a close or an exit clears the right one — and the shape is already
   what a multi-client mode needs. Only `CaptureStatus` still narrows it to one name (WP12).
2. **Handle both signals.** The exit packet is the earlier one; the connection close is the one that
   always arrives, because a client that crashes or is killed sends no exit packet at all.
3. **The most recent login wins** while several are live, because the status has room for one name.

## What it deliberately did not do

- No session history, no "last logged off at". The record's `lastSeenMs` already says when.
- No change to `CaptureStatus`'s single `characterName` — deliberately left as the one narrowing,
  and scheduled as WP12.

## Where it lives

`src/main/protocol/decode/client.ts`, `src/main/captureService.ts`,
`src/renderer/src/components/CaptureIndicator.tsx` (unchanged; it reads the status).

## How it is verified

`captureService.test.ts` drives a recorded login plus each ending: the confirm, the dialog-only
signal that must **not** clear the name, the connection close, and a fresh login after a logoff.
