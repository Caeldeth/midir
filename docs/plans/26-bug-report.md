# WP26 — the bug report to cernunnos

**Size:** M. **Depends on:** WP20, WP8. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** the first bug a user cannot describe without one.

## Goal

Turn the Diagnostics ring buffer into a bug report. WP8 built the ring buffer to be attached to one.
This WP is the workflow that gathers the diagnostic state — the log, the recent packets, the app
version — into a report a user can send.

## Why it waits for WP20

The report wants the packet inspector more than it wants another button. A bug that needs a report is
usually a protocol or capture bug, and the packet view (WP20) is what makes the recent packets
legible in the report. So WP20 comes first, and this WP packages what WP20 renders.

## Decisions

1. **The report is the ring buffer plus context.** The recent log, the recent packets (WP20), the
   app version, the adapter, and the capture state. Nothing the scrub did not already clear.
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
- WP20's packet inspector — the recent packets the report includes.
- `capture/scrub.ts` — the guarantee the report inherits.

## Acceptance criteria

1. A report gathers the log, the recent packets, the version, and the capture state into one file.
2. No scrubbed frame appears in the report.
3. The report states the known credential caveats.
4. Nothing is sent without the user.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit test that the assembled report holds the expected sections and no scrubbed frame.
3. GUI (hand to Sabrael): generate a report during a live capture and read it back.
