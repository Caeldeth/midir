# WP3 — passive capture

**Size:** L. **Depends on:** WP2. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `6bc9dbb`
(the addon), `05a880b` (the sources), `a896def` (packaging fix).

> Retrospective. Written after the fact from the commits; it records what shipped and why.

## What shipped

Bytes, from the wire to the protocol layer, without touching the game.

- **`packages/da-pcap`** — an N-API addon over Npcap: list adapters, start and stop a capture, and
  `GetExtendedTcpTable` to find which connections the game process owns. Windows only, with a stub
  on other platforms so the tests still run everywhere.
- **`capture/packet.ts`** — Ethernet, IPv4 and TCP parsing, no dependency.
- **`capture/tcpStream.ts`** — reassembly per connection and direction, with a **gap** flag when a
  sequence range is missing.
- **`capture/pcapSource.ts`** — the live source: adapter, filter, the process's own connections.
- **`capture/replaySource.ts`** — the same events from a recorded file.
- **`capture/recorder.ts` + `recording.ts`** — newline-delimited JSON: one header line, then open,
  chunk, and close events.
- **`capture/tracker.ts`** — follows the player across lobby, login, and world, handing each
  redirect's cipher state to the connection that follows it.

## Decisions that are load-bearing

1. **`PacketSource` is the seam.** A live adapter and a recorded file produce the same events, so
   everything above runs with no adapter, no driver, and no game. Every later WP leans on this.
2. **The filter is bare `tcp`, over the connections the game process opens.** Narrowing it by port
   would miss a redirect to an unexpected one. The cost is stated rather than hidden: the capture is
   not only the game protocol, which is why the scrub's caveat exists (WP6).
3. **A gap resets the frame reader.** The reader cannot see a hole inside a frame — a truncated
   frame looks exactly like a longer one — but TCP reassembly can, so the capture layer is the only
   place that knows and it must say so.
4. **A recording is a faithful copy, written beside decoding and never instead of it** (`teeSink`).
5. **The redirect describes the _next_ connection.** The tracker parks a redirect's cipher state
   under the destination it names and hands it over when that connection opens.

## What it deliberately did not do

- No proxy, no injection, no client change. The charter as it stood. **Amended 2026-07-23:** the
  injection and client-change halves still hold absolutely; the proxy is now conditional on WP18's
  spike, which exists because a forged packet needs one.
- No IPv6, and no reassembly of out-of-order segments beyond what the stream needs — a gap is
  reported, not repaired.
- The addon does not filter by process itself; the service asks for the connection table and
  matches.

## Where it lives

`packages/da-pcap/` (`src/addon.cc`, `index.js`, `index.d.ts`, `binding.gyp`) and
`src/main/capture/`. Tests in `capture/__tests__/`, with the shared builders in `helpers.ts`.

## How it is verified

Unit tests over synthetic Ethernet frames, the stream reassembler, and the tracker; a recorded
session drives the whole path in `captureService.test.ts`. **The live path cannot be verified by an
agent** — it needs Npcap, an adapter, and a real game session.
