# WP21 — e2e coverage of the capture surface

**Size:** S. **Depends on:** WP6, WP8, WP9. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a regression that the unit tests and the replay both miss.

## Goal

Extend the end-to-end coverage to the views built after `e2e/capture-surface.spec.js`. That spec
exists and is thin. The Items index (WP6), the Diagnostics views (WP8), and the bank card (WP9) have
no e2e spec, so a regression in the rendered surface can pass every unit test.

## Decisions

1. **Drive from a recorded session, not a live game.** The e2e path uses `replaySource` and a fixture
   recording, the same seam every other check uses. No Npcap, no adapter, no game.
2. **Assert what the user sees, not the internals.** The unit tests already cover the reducer, the
   decoders, and the store. The e2e spec covers the rendered result: the Items rows, the Diagnostics
   log and recordings cards, and the bank card with its "as of" time.
3. **One fixture, several views.** A single recording that logs a character in, opens a bank, and
   writes a recording exercises all three surfaces in one run.

## Non-goals (stop-lines)

- **No live-capture e2e.** The live path needs Npcap and a game and cannot run in CI. That check
  stays a hand-off to Sabrael.
- **No new UI.** This WP is tests only.

## Current state when you start

- `e2e/capture-surface.spec.js` — the thin existing spec to extend.
- WP6's Items page, WP8's Diagnostics page, WP9's bank card — the uncovered views.
- The recordings from 2026-07-23 — real fixtures with a bank open and a logoff.

## Acceptance criteria

1. The Items index renders the expected rows from a fixture recording.
2. The Diagnostics log and recordings cards render and respond to their controls.
3. The bank card shows the read state and the "as of" time.
4. The whole spec runs from `replaySource` with no game.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. The new e2e spec runs green against the fixture recording.
