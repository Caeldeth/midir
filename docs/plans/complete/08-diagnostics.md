# WP8 — the diagnostics log and recordings

**Size:** M. **Depends on:** WP5. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `069535e`
(PR #2), with the layout fix in `44aed18` (PR #3).

> Retrospective. Written after the fact from the commits; it records what shipped and why.

## What shipped

The answer to "why did it fail", for a build with no console.

- **`main/log.ts`** — one `session-<stamp>.log` per launch under
  `%LOCALAPPDATA%\Erisco\Midir\logs`, keeping the newest ten, plus an in-memory ring buffer the UI
  reads.
- **`main/recordings.ts`** — list, delete, and a byte cap that prunes the oldest.
- **`main/paths.ts`** — `assertInsideDir`, so a renderer-supplied path can never point outside its
  allowed root.
- **`handlers/diagnostics.ts`** and **`pages/Diagnostics.tsx`** — the log and the recordings, in the
  app.
- **`components/ErrorBoundary.tsx`** — a render failure is caught and reported to main's log over
  `diagnostics.report`, so one file answers the question whichever process broke.

## Decisions that are load-bearing

1. **Main-process diagnostics go through the logger, never `console.*`.** A packaged build has no
   console, so a `console.error` is a message nobody can read.
2. **The `Logger` is passed in, not imported as a singleton** — `createSettingsManager`,
   `createSplashWindow`, `HandlerContext.log`. It keeps the log testable and the dependency visible.
3. **The renderer reports its own failures to the same file.** Two logs would mean the wrong half is
   always the one you have.
4. **The recordings cap never deletes the file capture is writing.** `pruneRecordings` and every
   delete path take the path from `captureService.status().recordingPath` and skip it. Removing a
   file from under the recorder would corrupt the running session.
5. **Every renderer-supplied path is validated against an allowed root** before it is opened or
   deleted.
6. **A log pane is bounded and scrolls inside its own card** (`44aed18`). An unbounded pane grew the
   page until the layout was unusable — the fix is a real height, not `overflow: auto` alone.

## What it deliberately did not do

- No log upload, no crash reporter, no telemetry. The log is a file on the user's machine, and the
  user decides whether it goes anywhere.
- No packet inspector. The ring buffer was built with a bug report in mind; the report and the
  inspector are both in `00a-backlog.md`.

## Where it lives

`src/main/log.ts`, `recordings.ts`, `paths.ts`, `handlers/diagnostics.ts`;
`src/renderer/src/pages/Diagnostics.tsx`, `components/ErrorBoundary.tsx`.

## How it is verified

`main/__tests__/log.test.ts`, `recordings.test.ts`, `paths.test.ts` and `diagnostics.test.ts` run
over temp directories, including the "never delete the file being written" case and the path guard.
