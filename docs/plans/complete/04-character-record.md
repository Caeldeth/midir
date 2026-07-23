# WP4 — the character record and its store

**Size:** M. **Depends on:** WP3. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `cf584e1`,
with the identity corrections in `c2f6503`, `86bff7d` and `bb85709`.

> Retrospective. Written after the fact from the commits; it records what shipped and why.

## What shipped

The middle of the app: a pure reducer from packets to one character, a crash-safe store, the
service that joins capture to both, and the handler and preload surface the renderer sees.

- **`model/character.ts`** — `reduce(state, input)`, pure, so a whole login replays in a test.
- **`store/characterStore.ts` + `jsonStore.ts`** — hand-rolled atomic JSON: write a temp file,
  rename over the target, keep a `.bak`, validate with Zod on load, quarantine a corrupt file rather
  than discard it.
- **`captureService.ts`** — one reducer state per connection, a debounced save, and the status the
  title bar reads.
- **`handlers/`** — plain `(ctx, ...args)` functions plus a `registerHandlers` registry.

## Decisions that are load-bearing

1. **Merge, never replace.** `SStatus` is flag-gated; a packet carrying only current health must not
   wipe the level, the gold, or the inventory.
2. **A record is only a character once it has a name _and_ the server has described it.** The
   connections before the world server are keyed from a placeholder such as `socket[295]`. That
   value is a real key seed and a real nobody — used for decryption, never as an identity
   (`isPlaceholderName`, `bb85709`).
3. **The name has a preference order.** A drawn entity that matches our own id is authoritative; the
   key name from the login redirect is a good first answer; a name from the opaque token is a
   fallback, and only when it could be a name at all.
4. **One reducer state per connection**, so two logins never bleed into each other.
5. **Handlers are plain functions taking `(ctx, ...)`**, with no IPC event argument, so they are
   unit-testable without Electron.
6. **The earliest first-seen time survives** across sessions; each login starts a fresh reducer and
   only the file remembers the first meeting.

## What it deliberately did not do

- No pruning, no history, no per-session diff. The record is the current truth plus when it was
  seen.
- No sqlite. One JSON file, keyed by character name, which is unique on a retail server.

## Where it lives

`src/main/model/character.ts`, `src/main/store/characterStore.ts`, `src/main/jsonStore.ts`,
`src/main/captureService.ts`, `src/main/handlers/`, `src/shared/character.ts`.

## How it is verified

The reducer has a large unit suite driven by decoded-packet literals; the store has one over a temp
directory including the heal-from-backup and quarantine paths; the service is driven end to end from
a synthetic recording.

## Corrected later

WP11 found two data-loss bugs that this WP shipped: `characterSchema` did not name the `bank` field
Zod would later have to keep, and a fresh login replaced the stored record whole. Both are recorded
as settled decision 10 in `00-overview.md`.
