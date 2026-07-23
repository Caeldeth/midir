# Midir implementation — overview & conventions

Read this before any work package (WP). Every WP doc assumes you have.

**Doc layout:** built-and-merged WP docs live in `complete/`; planned and in-progress WPs stay at
the top level of `docs/plans/`. This file (the index) and `00a-backlog.md` (the register) stay put.

**These docs are partly retrospective.** WP1 to WP6 and WP8 to WP11 shipped before any WP doc
existed, so their docs record **what was built and why**, not a plan that was written first. They
were reconstructed from the commit history on 2026-07-23 and from the rules already pinned in
`CLAUDE.md`. WP7's number is not a reconstruction: it was named before it was written, skipped, and
the WPs after it kept their own numbers. Treat a completed doc as a record, and `CLAUDE.md` as the
law it has to agree with.

## What Midir is

A read-only companion app for **retail Dark Ages** (USDA client 7.41, `da0.kru.com`). It captures
the game client's own network traffic through Npcap, decodes the protocol, and keeps a persistent
record of every character the player logs in on. That record drives a searchable cross-character
item index and a per-character detail view. The model is Altoholic for World of Warcraft.

**Repo rules (authoritative):** `CLAUDE.md` at the repo root — read it first and treat it as the
charter. This file does not repeat it; it records the decisions behind the code.
**Retail protocol, house description:** the document repo's `docs/protocol/`.
**Retail protocol, second description:** `Repos/darkages-741-re/docs/network/`.
**House working practices:** the document repo's `docs/architecture/dev-practices.md`.
**Electron stack standard:** the document repo's `docs/architecture/electron-app-skeleton.md`.
**Template of origin:** `Repos/hyb-electron-template`.

## Settled decisions (do not relitigate)

1. **Midir never sends a packet.** Capture is passive, through Npcap. No proxy, no injected DLL, no
   client patch, no write to the client's memory or files. A feature that seems to need one stops
   and asks. This is the charter; everything below serves it.
2. **Retail is the only target.** Hybrasyl is not supported. Hybrasyl artefacts survive only where
   they are evidence — a loopback capture recovered the redirect-token layout, and the salt-table
   fixture is named for where it came from.
3. **Decryption needs the handshake, so Midir must run before the player logs in.** Every cipher
   input is on the wire in the clear or is a constant. Because each encrypted packet carries its own
   sequence and seeds, decryption is stateless per packet — a dropped packet does not break the next
   one — but a missed handshake means a whole connection cannot be read. That is a **first-class UI
   state, not an error** (`missedHandshake`, the Guidance card).
4. **A recording never holds a credential from the game protocol.** `capture/scrub.ts` drops every
   client frame whose opcode is in `SECRET_BEARING_CLIENT_OPCODES` before the recording is written,
   and stops recording a connection's client direction after a TCP gap. Add to the set rather than
   special-casing, and never add a recorder path that bypasses it. Two limits are **stated, not
   fixed**: the gap rule, and the bare `tcp` filter, which also catches non-game traffic from the
   same process (one dialog type sends an id and password in a plaintext HTTP URL).
5. **Main owns all disk, network, and IPC I/O; the renderer only calls the typed `window.api`.** A
   feature is a handler, then a preload method, then a `shared/` type.
6. **`PacketSource` is the test seam.** Everything above it must run from a recorded session with no
   adapter, no driver, and no game. This is why WP11 moved the record onto capture time.
7. **The record runs on capture time, not the wall clock.** `TrackedEvent.timestampMs` carries the
   time the bytes were captured. They are the same live and very different in a replay.
8. **The protocol layer is pure.** Decoders take a `Uint8Array` and return a typed object. No disk,
   no sockets, no Electron under `src/main/protocol/`.
9. **A bank is read or not read — never assumed empty.** An empty bank sends no reply at all, so
   only the player's own request (`0x39` pursuit `0x45`) can make "empty" a claim Midir is entitled
   to. See WP9 and WP11.
10. **Every `CharacterRecord` field must be named in the store schema, and a fresh login must not
    replace what it cannot know.** Zod drops what it does not name; `mergeCharacter` is the other
    half. Both cost real user data before WP11 found them.
11. **Commits carry no AI co-author trailer.** Sabrael is the only contributor. This overrides any
    global preference.
12. **Documentation and comments follow ASD-STE100 Simplified Technical English.**

## Dependency graph

```text
WP1 (scaffold)   COMPLETE
 └── WP2 (protocol: cipher, framing, decoders)   COMPLETE — pure, and the spine
      ├── WP3 (da-pcap addon + passive capture)   COMPLETE
      │    └── WP4 (character record, reducer, store)   COMPLETE
      │         ├── WP5 (character sheet, live view, settings)   COMPLETE
      │         │    ├── WP6 (cross-character item index + credential scrub)   COMPLETE
      │         │    │    └── WP7 (item icons via dalib-ts)   PLANNED — 07-item-icons.md
      │         │    └── WP8 (diagnostics log + recordings)   COMPLETE
      │         ├── WP9 (bank from the NPC dialog)   COMPLETE
      │         ├── WP10 (live character lifecycle / logoff)   COMPLETE
      │         │    └── WP12 (multiple clients)   PLANNED — 12-multiple-clients.md
      │         └── WP11 (dialog wrapper + the empty bank)   COMPLETE
      └── (nothing else depends on WP2 directly — the protocol layer is the spine)
```

WP7 is the one gap in the shipped run. It was specified, deferred for the protocol work that kept
paying better, and the WPs after it kept their numbers rather than closing the hole.

## Work packages

| WP   | Size | Title                                     | Status                                       |
| ---- | ---- | ----------------------------------------- | -------------------------------------------- |
| WP1  | S    | Scaffold from the house template          | COMPLETE — `complete/01-scaffold.md`         |
| WP2  | L    | The retail protocol layer                 | COMPLETE — `complete/02-protocol.md`         |
| WP3  | L    | Passive capture (`da-pcap` + sources)     | COMPLETE — `complete/03-capture.md`          |
| WP4  | M    | The character record and its store        | COMPLETE — `complete/04-character-record.md` |
| WP5  | M    | The character sheet and the live view     | COMPLETE — `complete/05-character-sheet.md`  |
| WP6  | M    | Cross-character item index, and the scrub | COMPLETE — `complete/06-item-index.md`       |
| WP7  | M    | Item icons via dalib-ts                   | PLANNED — `07-item-icons.md`                 |
| WP8  | M    | Diagnostics log and recordings            | COMPLETE — `complete/08-diagnostics.md`      |
| WP9  | M    | The bank, out of the NPC dialog           | COMPLETE — `complete/09-bank.md`             |
| WP10 | S    | The live character's lifecycle            | COMPLETE — `complete/10-live-lifecycle.md`   |
| WP11 | M    | The dialog wrapper, and the empty bank    | COMPLETE — `complete/11-dialog-wrapper.md`   |
| WP12 | S    | Multiple clients at once                  | PLANNED — `12-multiple-clients.md`           |

Everything not scheduled lives in `00a-backlog.md`, with the trigger that would promote it.

## Conventions every WP follows

- **Gate before committing:** `npm run typecheck && npm run lint:check && npm test && npm run build`.
- **`npm run dev` needs a GUI.** It cannot run headless or sandboxed. An agent verifies with the
  gate and a replay; GUI click-throughs are handed to Sabrael, and the doc says so plainly.
- **The live capture path cannot be verified by an agent** — it needs Npcap, an adapter, and a real
  game session. Use `replaySource` and a recorded session for everything below the seam.
- **A protocol claim cites its source.** Both descriptions get read, because neither is a superset
  of the other, and where they disagree the document repo wins. A claim verified against a live
  capture says so, with the numbers.
- **Never name the internal document repo** in commits, PR titles, PR bodies, or branch names. Call
  it "the document repo".
