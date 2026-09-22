# WP21 — e2e coverage of the capture surface

**Size:** S. **Depends on:** WP6, WP8, WP9. Read `00-overview.md` first. **COMPLETE 2026-09-22.**
**Card:** `HTOO-70`.
**Trigger to start:** a regression that the unit tests and the replay both miss. Sabrael,
2026-09-22: the low items, all of them.

**What shipped:** `MIDIR_REPLAY=<recording>` in `main/index.ts` makes the capture service play
that file in place of an adapter for the whole launch, through `createSource`, the seam the
service already had; with `autoStartCapture` seeded the views fill on their own. It is the e2e
suite's source and a way to look at an old session again. `e2e/replay-surface.spec.js` asserts
the character list and sheet, the bank card with its "as of", the item index and its search, and
the Diagnostics log and recordings cards. **The fixture is synthesised, not cut from 2026-07-23**
as the plan expected: this repository is public and a real recording carries names and other
players' chat. `src/main/__tests__/e2eFixture.test.ts` builds `e2e/fixtures/session.ndjson`
from plaintext packets and the test helpers' cipher, compares it byte for byte, and proves it
decodes through the tracker. **The spec found its first regression on the first run**: the
character store's `refresh` replaced the list with the file's, and the file is a second behind a
live change (the save debounce), so a page that mounted inside that second dropped the record a
push had already delivered. `mergeListed` in `characterStore.ts` keeps the newer sighting by name.

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

1. The Items index renders the expected rows from a fixture recording. (Done, with the search.)
2. The Diagnostics log and recordings cards render and respond to their controls. (Done: the
   log's session and lines, the recordings table and total.)
3. The bank card shows the read state and the "as of" time. (Done.)
4. The whole spec runs from `replaySource` with no game. (Done: `MIDIR_REPLAY`.)

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. The new e2e spec runs green against the fixture recording.
