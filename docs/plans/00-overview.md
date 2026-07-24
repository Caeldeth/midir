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

A companion app for **retail Dark Ages** (USDA client 7.41, `da0.kru.com`). It captures
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

## The charter changed on 2026-07-23

Midir was read-only for its first eleven WPs, and that rule is in every doc under `complete/`. It
ended when **DA Walker and DA Speaker were folded in**, together with a third feature that needs
both of them: the Laborer, which walks to an NPC and then works the dialog.

What the two legacy tools actually do, read out of the binaries in `E:\Games\Dark Ages\Walker`.
**Both tools are much older than the copies on disk** — those are `.NET` builds stamped 2016 and
2017, which is when this copy was made, not when the tools were written. Their age is the point:
they solve a 7.41-era problem with the only technique available before anyone had decoded the
protocol.

- **DA Walker** — `OpenProcess` + `ReadProcessMemory` + `SearchDAProcessMemory`, against the pointer
  table in `DAData.xml` (absolute addresses and offset chains for the map number, the coordinates,
  the slots, the bank, and the window state in 7.41). It **moves by `PostMessage`/`SendMessage`** —
  synthesized keystrokes to the game window. `WorldMap.dat` is a map graph with warp coordinates,
  and `InitDistRouteTables` / `BPath` / `doorWalk` pathfind over it.
- **DA Speaker** — `PostMessage` and a timer, and nothing else. No memory access at all.

**Neither injects a packet, writes memory, injects a library, or patches the client.** So most of
the old charter survived the fold: what died was "it listens, it does not speak", and nothing else.
Decisions 1 to 4 below are what replaced it; the rest of that list is unchanged.

**Midir can also do better than the tools it replaces.** DA Walker reads memory because it has no
protocol decode. Midir has one, so the same facts come off the wire — `SLocation 0x04`,
`SUserMove 0x0B`, `SMapInfo 0x15`, `SMapChangePending 0x67`, `SMapChangeCompleted 0x1F` — and
`ReadProcessMemory` never enters the app. The capture layer already resolves the game's process id
(`processIdsByName`, `tcpConnectionsForPid`), so the action layer can bind a **window to a
connection**, which neither legacy tool can do at all.

## Settled decisions (do not relitigate)

1. **Reading is passive, and stays passive.** Capture is through Npcap and nothing else. **Midir
   does not read the client's memory**, though the tool it replaces did: a pointer table is a
   maintenance debt against one build, and the wire carries everything that table pointed at. No
   injected DLL, no client patch, no write to the client's memory or files — ever, in any mode.
2. **Acting is through the client's own input queue by default.** Posting keys and clicks sends no
   packet, is validated by the client, and does nothing a player could not do by hand. It covers
   walking and speaking completely.
3. **A forged packet is allowed per feature, and only after the spike.** It is the right answer only
   where driving the UI is genuinely unreliable, which in practice means a dialog step. **It is not
   cheap:** Midir cannot write into the client's own TCP socket, so it means a proxy, a full encrypt
   path, the integrity bytes, the submission terminator, the `0x39`/`0x3A` wrapper as a writer, and
   re-numbering. WP18 is the spike, and nothing sends a packet before it lands.
4. **Every driving feature ships off, with one stop that always works**, and none of them may ever
   automate a credential dialog or a password field. **A driving assistant targets one selected
   window at a time**: the user picks one open game window, Midir brings it to the foreground on
   start, and the driver binds to that window's connection (WP13 decisions 9 and 10). The read path
   still decodes every client (WP12); the one-window limit is on driving only.
5. **Retail is the only target.** Hybrasyl is not supported. Hybrasyl artefacts survive only where
   they are evidence — a loopback capture recovered the redirect-token layout, and the salt-table
   fixture is named for where it came from.
6. **Decryption needs the handshake, so Midir must run before the player logs in.** Every cipher
   input is on the wire in the clear or is a constant. Because each encrypted packet carries its own
   sequence and seeds, decryption is stateless per packet — a dropped packet does not break the next
   one — but a missed handshake means a whole connection cannot be read. That is a **first-class UI
   state, not an error** (`missedHandshake`, the Guidance card).
7. **A recording never holds a credential from the game protocol.** `capture/scrub.ts` drops every
   client frame whose opcode is in `SECRET_BEARING_CLIENT_OPCODES` before the recording is written,
   and stops recording a connection's client direction after a TCP gap. Add to the set rather than
   special-casing, and never add a recorder path that bypasses it. Two limits are **stated, not
   fixed**: the gap rule, and the bare `tcp` filter, which also catches non-game traffic from the
   same process (one dialog type sends an id and password in a plaintext HTTP URL).
8. **Main owns all disk, network, and IPC I/O; the renderer only calls the typed `window.api`.** A
   feature is a handler, then a preload method, then a `shared/` type.
9. **`PacketSource` is the test seam.** Everything above it must run from a recorded session with no
   adapter, no driver, and no game. This is why WP11 moved the record onto capture time, and it is
   why the action layer is an interface with one real implementation (WP13).
10. **The record runs on capture time, not the wall clock.** `TrackedEvent.timestampMs` carries the
    time the bytes were captured. They are the same live and very different in a replay.
11. **The protocol layer is pure.** Decoders take a `Uint8Array` and return a typed object. No disk,
    no sockets, no Electron under `src/main/protocol/`.
12. **A bank is read or not read — never assumed empty.** An empty bank sends no reply at all, so
    only the player's own request (`0x39` pursuit `0x45`) can make "empty" a claim Midir is entitled
    to. See WP9 and WP11.
13. **Every `CharacterRecord` field must be named in the store schema, and a fresh login must not
    replace what it cannot know.** Zod drops what it does not name; `mergeCharacter` is the other
    half. Both cost real user data before WP11 found them.
14. **Commits carry no AI co-author trailer.** Sabrael is the only contributor. This overrides any
    global preference.
15. **Documentation and comments follow ASD-STE100 Simplified Technical English.**

## Dependency graph

```text
WP1 (scaffold)   COMPLETE
 └── WP2 (protocol: cipher, framing, decoders)   COMPLETE — pure, and the spine
      ├── WP3 (da-pcap addon + passive capture)   COMPLETE
      │    └── WP4 (character record, reducer, store)   COMPLETE
      │         ├── WP5 (character sheet, live view, settings)   COMPLETE
      │         │    ├── WP6 (cross-character item index + credential scrub)   COMPLETE
      │         │    │    └── WP7 (item icons via dalib-ts)   COMPLETE — complete/07-item-icons.md
      │         │    └── WP8 (diagnostics log + recordings)   COMPLETE
      │         ├── WP9 (bank from the NPC dialog)   COMPLETE
      │         ├── WP10 (live character lifecycle / logoff)   COMPLETE
      │         │    └── WP12 (multiple clients)   COMPLETE — complete/12-multiple-clients.md
      │         │         └── WP19 (read-app UI fixes + character redesign)   PLANNED — after WP12, before WP13
      │         └── WP11 (dialog wrapper + the empty bank)   COMPLETE
      └── (nothing else depends on WP2 directly — the protocol layer is the spine)

the assistants, after the charter change:

WP13 (the action layer: window, keys, the stop)   PLANNED
 ├── WP16 (Speaker)   PLANNED — the smallest user of WP13, and its proof
 └── WP15 (Walker)   PLANNED
      └── WP17 (Laborer)   PLANNED — needs WP15 to arrive and WP11 to read the dialog
WP14 (position and map, off the wire)   PLANNED — what WP15 steers by
WP18 (the packet-send spike)   PLANNED — gates every forged packet; WP17 is the only caller waiting

triggered follow-ons (each carries its promotion trigger in its own doc header):

WP20 (packet inspector)   PLANNED — needs WP11
WP21 (e2e of the capture surface)   PLANNED — needs WP6, WP8, WP9
WP22 (Deposit Item 0x43 decode)   PLANNED — needs WP11; blocked on a capture sample
WP23 (0x39 response tail decode)   PLANNED — needs WP11; feeds WP17
WP24 (route graph from ceridwen)   PLANNED — needs WP15; blocked on ceridwen
WP25 (record pruning / hide unseen)   PLANNED — needs WP4
WP26 (bug report to cernunnos)   PLANNED — needs WP20, WP8
WP28 (app standards audit)   PLANNED — needs the skeleton standard; do before WP27
WP27 (cut the first release)   PLANNED — needs the quality gate and WP28
```

WP7 was the one gap in the shipped run. It was specified, deferred for the protocol work that kept
paying better, and the WPs after it kept their numbers rather than closing the hole. It is now
built: item icons come off the game's own `legend.dat`, drawn through a privileged protocol.

## Work packages

| WP   | Size | Title                                     | Status                                       |
| ---- | ---- | ----------------------------------------- | -------------------------------------------- |
| WP1  | S    | Scaffold from the house template          | COMPLETE — `complete/01-scaffold.md`         |
| WP2  | L    | The retail protocol layer                 | COMPLETE — `complete/02-protocol.md`         |
| WP3  | L    | Passive capture (`da-pcap` + sources)     | COMPLETE — `complete/03-capture.md`          |
| WP4  | M    | The character record and its store        | COMPLETE — `complete/04-character-record.md` |
| WP5  | M    | The character sheet and the live view     | COMPLETE — `complete/05-character-sheet.md`  |
| WP6  | M    | Cross-character item index, and the scrub | COMPLETE — `complete/06-item-index.md`       |
| WP7  | M    | Item icons via dalib-ts                   | COMPLETE — `complete/07-item-icons.md`       |
| WP8  | M    | Diagnostics log and recordings            | COMPLETE — `complete/08-diagnostics.md`      |
| WP9  | M    | The bank, out of the NPC dialog           | COMPLETE — `complete/09-bank.md`             |
| WP10 | S    | The live character's lifecycle            | COMPLETE — `complete/10-live-lifecycle.md`   |
| WP11 | M    | The dialog wrapper, and the empty bank    | COMPLETE — `complete/11-dialog-wrapper.md`   |
| WP12 | S    | Multiple clients at once                  | COMPLETE — `complete/12-multiple-clients.md` |
| WP19 | M    | Read-app UI fixes + character redesign    | PLANNED — `19-read-app-polish.md`            |

### The assistants (after the charter change)

| WP   | Size | Title                          | Status                              |
| ---- | ---- | ------------------------------ | ----------------------------------- |
| WP13 | M    | The action layer, and the stop | PLANNED — `13-action-layer.md`      |
| WP14 | M    | Position and map, off the wire | PLANNED — `14-position-and-map.md`  |
| WP15 | L    | Walker                         | PLANNED — `15-walker.md`            |
| WP16 | S    | Speaker                        | PLANNED — `16-speaker.md`           |
| WP17 | L    | Laborer (was Clout Assistant)  | PLANNED — `17-clout-assistant.md`   |
| WP18 | M    | The packet-send spike          | PLANNED — `18-packet-send-spike.md` |

Build order: **WP13, then WP16** — Speaker is the smallest thing that proves the action layer, and
it needs nothing else. WP14 and WP15 are the walker's two halves, WP17 needs both plus WP11's
dialog decode, and WP18 gates any forged packet WP17 turns out to want.

### Triggered follow-ons

Each is a real WP with a doc, but is trigger-gated: it starts when its trigger fires, not before. The
trigger is in each doc's header.

| WP   | Size | Title                           | Status                                           |
| ---- | ---- | ------------------------------- | ------------------------------------------------ |
| WP20 | M    | The packet inspector            | PLANNED — `20-packet-inspector.md`               |
| WP21 | S    | e2e of the capture surface      | PLANNED — `21-e2e-capture-surface.md`            |
| WP22 | S    | Deposit Item `0x43` decode      | PLANNED — `22-deposit-item-decode.md` (blocked)  |
| WP23 | S    | The `0x39` response tail decode | PLANNED — `23-pursuit-response-tail.md`          |
| WP24 | M    | Route graph from ceridwen       | PLANNED — `24-ceridwen-route-graph.md` (blocked) |
| WP25 | S    | Record pruning / hide unseen    | PLANNED — `25-record-pruning.md`                 |
| WP26 | M    | The bug report to cernunnos     | PLANNED — `26-bug-report.md`                     |
| WP27 | M    | Cut the first release           | PLANNED — `27-first-release.md`                  |
| WP28 | S    | App standards adoption          | PLANNED — `28-app-standards.md`                  |

`00a-backlog.md` now holds only what is not a WP: the non-goals, the debts owed to another repo, and
the one conditional rule.

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
