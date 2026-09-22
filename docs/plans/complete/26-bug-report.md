# WP26 — the bug report to cernunnos

**Size:** M. **Depends on:** WP8. Read `00-overview.md` first. **COMPLETE 2026-09-22, with
WP28.** **Card:** `HTOO-75`.
**Trigger to start:** the first bug a user cannot describe without one. Sabrael, 2026-09-22: "the
bug report is a standard pattern we can adopt now without any additional work."

**What shipped:** the house Report Issue module (`docs/architecture/report-issue-module.md`),
balor's TypeScript port, composed over Midir's own session log rather than a second one.
`shared/{appIdentity,scrub,osName,diagnostics,issueUrl}.ts`, `main/diagnostics.ts` (the
clipboard and the browser injected), `main/errorHandlers.ts` (main's uncaught exceptions and
rejections into the log, which no console showed before), the `diagnostics:build`, `:openIssue`,
and `:copyReport` channels, `ReportIssueDialog` with the editable block and the open, copy, and
reveal-logs triad, the bug button in the title bar, the About card in Settings with the version,
Report an issue, and Reveal recordings folder, and the error boundary's own Report an issue.
Reports go to `hybrasyl/cernunnos` under `app:midir`. **The one divergence from the house
module:** Midir scrubs the assembled report, not the log at capture, because the log is the
Diagnostics tab's record on the player's own machine and predates the module; the dialog says
the log files are not scrubbed. **The recording is not attached automatically**: it is a file, so
the About card reveals the folder and the player attaches it by hand after reading it, which is
what decision 2 wants anyway.

## Goal

Turn the Diagnostics ring buffer into a bug report. WP8 built the ring buffer to be attached to one.
This WP is the workflow that gathers the diagnostic state — the log, the recent packets, the app
version — into a report a user can send.

## Why it does not wait for WP20

It used to: the packet view (WP20) was to make the recent packets legible in the report. Sabrael,
2026-09-22: it should not depend on WP20. A bug report needs the packets as data, not as a view,
and Midir already has that: the session log (WP8) and the session recording, which is the scrubbed
`.ndjson` the capture writes for every launch. The report packages what exists; a later WP20 makes
the same packets readable on screen, and neither needs the other.

## Decisions

1. **The report is the log plus context.** The session log, the session recording (already
   scrubbed), the app version, the adapter, and the capture state. Nothing the scrub did not
   already clear.
2. **No credential in the report.** The report gathers what the tracker holds after `capture/scrub.ts`
   has run. It never includes a scrubbed frame, and it states the known caveats (the bare `tcp`
   filter, the HTTP dialog).
3. **The user sends it, not the app.** Midir writes the report to a file the user attaches. It does
   not upload on its own — sending is the user's decision.

## Non-goals (stop-lines)

- **No automatic upload.** The app does not send anything without the user.
- **No credential**, and no bypass of the scrub.
- **No telemetry.** This is a report the user chooses to make, not a background stream.

## Current state when you start

- WP8's Diagnostics ring buffer and the `session-<stamp>.log` files.
- The session recording under `recordings/`, which is the packets the report includes.
- `capture/scrub.ts` — the guarantee the report inherits.

## Acceptance criteria

1. A report gathers the log's newest warnings and errors, the version, and the OS into one block
   the user reviews; the recording is beside it, revealed, for the user to attach.
2. No scrubbed frame appears in the report: the block holds log lines, never packets.
3. The report's dialog states what is and is not scrubbed.
4. Nothing is sent without the user: the clipboard, then the browser, on a button.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit test that the assembled report holds the expected sections and no scrubbed frame.
3. GUI (hand to Sabrael): generate a report during a live capture and read it back.
