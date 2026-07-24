# WP20 — the packet inspector

**Size:** M. **Depends on:** WP11. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a protocol question a scratch `console.log` cannot answer, or a bug report
where the ring buffer alone is not enough.

## Goal

Show every packet, readable or not, in a UI. `session.ts` and `tracker.ts` already describe this
view, and `PacketEvent.body` is kept for it. Nothing renders it yet. WP11 made the body correct for
the wrapped `0x39`/`0x3A` opcodes, which was the last protocol work the inspector needed.

## Decisions

1. **Read from the existing event stream.** `PacketEvent` already carries the opcode, the direction,
   the timestamp, and the body. The inspector is a view over what the tracker already publishes; it
   adds no capture path.
2. **Show the undecoded packet too.** The value of the inspector is the packet that has no decoder
   yet — the one a protocol question is about. Render the raw body as hex, with the opcode and the
   direction named.
3. **The ring buffer is the source.** The inspector shows the recent window the tracker keeps, not a
   full session history. A full log is a recording (WP8), not this view.
4. **No credential leaves the scrub.** The inspector shows what the tracker holds after
   `capture/scrub.ts` has run. It never renders a scrubbed client frame.

## Non-goals (stop-lines)

- **No packet editing or replay-from-the-UI.** The inspector reads; it does not compose.
- **No full-session log.** That is a recording, and it has its own file format and its own cap.

## Current state when you start

- `src/main/capture/tracker.ts` and `session.ts` — describe the view, and keep `PacketEvent.body`.
- `src/main/protocol/` — the decoders name the opcodes the inspector labels.
- WP8's Diagnostics page — the natural neighbour for a developer-facing packet view.

## Acceptance criteria

1. Every recent packet shows, with its opcode, direction, and timestamp.
2. An undecoded packet shows its raw body as hex.
3. A scrubbed client frame never appears.
4. The view reads from the ring buffer with no new capture path.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Drive the view from a recorded session through `replaySource`; assert the rows against the known
   packets, including one undecoded opcode.
3. GUI (hand to Sabrael): open the inspector during a live capture and confirm the recent packets.
