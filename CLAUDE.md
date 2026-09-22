# Midir

Midir is a companion app for **retail Dark Ages** (USDA client 7.41, `da0.kru.com`). It captures the game client's network traffic, decodes the protocol, and keeps a persistent record of every character the player logs in on. The record drives a searchable cross-character item index and a per-character detail view. The model is Altoholic for World of Warcraft.

Retail is the only target. Hybrasyl is not supported.

## The rules that make this app what it is

**Midir reads from the wire and acts through the client.** The two halves have different rules, and
the split is the charter. It replaced a plain "read-only" rule on 2026-07-23, when DA Walker and DA
Speaker were folded in — see `docs/plans/00-overview.md` for what changed and why.

**Reading is passive, and stays passive.** Capture is through Npcap and nothing else. Midir does not
read the client's memory, and must not start: DA Walker used `ReadProcessMemory` and a pointer table
only because it had no protocol decode. Midir has one, so the map, the coordinates, the slots, and
the bank all come off the wire. A pointer table for one build is also a maintenance debt that a wire
format is not.

**Acting is through the client's own input queue by default.** Midir posts keys and clicks to the
game window, exactly as DA Walker and DA Speaker do. It sends no packet in this mode, the client
validates every action, and nothing happens that a player could not do by hand.

**A forged packet is allowed per feature, and it is not cheap.** It is the right answer only where
driving the UI is genuinely unreliable — a dialog step, not a footstep. Know the cost before
choosing it: Midir cannot write into the client's own TCP socket, so a forged packet means a
**proxy** (the client connects to Midir, Midir connects to the server), a full encrypt path, the
client-direction integrity bytes, the submission terminator, the dialog wrapper for `0x39`/`0x3A`,
and re-numbering of everything downstream. That ends the "no proxy" rule, so it is a spike before it
is a feature. **Nothing sends a packet until that spike lands** (WP18).

**These stay forbidden, whichever mode a feature uses:** no injected DLL, no client patch, no write
to the client's memory or files, and no read of its memory.

**Every driving feature ships off, with a stop that always works.** Off by default, one obvious
global stop, and it stops on losing the game window. Midir must never automate a credential dialog
or a password field.

If a feature seems to need something this section forbids, stop and ask.

**Decryption needs the handshake.** Every cipher input is on the wire in the clear or is a constant: the startup key, the seed-table selector and key from `SVersionCheck` (S→C `0x00`, transform None), and the character name from `STransferServer` (S→C `0x03`, transform None) which seeds the MD5 session key. Because each encrypted packet carries its own sequence and seed bytes, decryption is **stateless per packet** — a dropped packet does not break the next one. But Midir must be running **before** the player logs in. That is a first-class UI state, not an error.

**A session recording never holds a credential from the game protocol.** `capture/scrub.ts` removes every client frame whose opcode is in `SECRET_BEARING_CLIENT_OPCODES` before the recording is written. The frame is found without a key, because the header states its length and the cipher leaves the opcode in the clear. Dropping a packet is safe: decryption is stateless per packet, and the character name comes from CTransferServer `0x10`. Do not add a recorder path that bypasses this, and add to the set rather than special-casing.

Two limits are known and stated, not fixed. The scrubber **stops recording a connection's client direction after a TCP gap**, because a walk that has lost its place cannot be resynchronised safely — see the `onGap` comment for the two ways it used to leak. And the capture filter is bare `tcp` over every connection the game process opens, so it is not only the game protocol: one dialog type is documented to send an ID and password in a plaintext HTTP URL from that same process, and the frame walk does not touch HTTP. Do not describe a recording as free of credentials without that caveat.

**Commits carry no AI co-author trailer.** Sabrael is the only contributor to this repo. This overrides any global `Co-Authored-By` preference.

**Documentation and comments follow ASD-STE100 Simplified Technical English.** One instruction per sentence, present tense, active voice, short sentences, no idioms.

## Work packages

`docs/plans/` holds the work packages. **`docs/plans/00-overview.md` is the index — read it before
any WP**, and `00a-backlog.md` is the register of everything known and not scheduled, each entry
with the trigger that would promote it. Shipped WP docs live in `docs/plans/complete/`; planned ones
stay at the top level. WP1 to WP6 and WP8 to WP11 are retrospective records of what shipped, not
plans written first. This file stays the law; a WP doc has to agree with it.

## Canonical references (read these first)

- **Retail protocol, house description** — the document repo's `docs/protocol/`. Per-opcode files under `client/` and `server/`, plus `WIRE-FORMATS.md`, `OPCODE-MAP.md`, `CLIENT-FRAMING.md`, and `DISCREPANCIES.md`. Many entries carry binary verification against the USDA client and note which paths are dead in that build. **Where the two sources disagree, follow this one.**
- **Retail protocol, second description** — `Repos/darkages-741-re/docs/network/`. `packet-transforms.md` has the complete cipher. `transport.md` has the frame and greeting. `server/*.md` and `client/*.md` have byte-exact wire formats.
- **House working practices** — the document repo's `docs/architecture/dev-practices.md` (git and commit discipline, PR prep, verify-before-commit, security posture).
- **Electron stack standard** — the document repo's `docs/architecture/electron-app-skeleton.md`. Midir is a copy of `Repos/hyb-electron-template`.

**Read both protocol sources.** They are not a superset and a subset. Each holds opcodes and details the other lacks, and they disagree on real fields. Deciding the credential-scrub set needed both: `darkages-741-re` alone gives three password-bearing client opcodes, the document repo gives five and binary-verifies a field the other describes as unused.

Never name the internal document repo in commits, PR titles, PR bodies, or branch names. Call it "the document repo".

## Commands

```bash
npm run dev            # electron-vite dev — launches the app; needs a GUI (see Verifying)
npm test               # vitest run (node + jsdom projects)
npm run typecheck      # tsc --build
npm run lint:check     # eslint, no writes
npm run lint           # eslint --fix
npm run format         # prettier --write .
npm run build          # electron-vite build (main + preload + renderer)
npm run build:win:portable   # packaged portable Windows build
```

Gate before committing: `npm run typecheck && npm run lint:check && npm test && npm run build`.

## Stack

electron-vite 5 · React 19 (classic JSX runtime — `import React`; use `React.JSX.Element`) · TypeScript 5.7 strict · MUI v9 + Emotion (style with `sx`, never styled-components) · Zustand 5 · Zod 4 · Vitest 4 (node and jsdom projects). Package manager: **npm**.

## Layout

```text
packages/
  da-pcap/          native N-API addon — Npcap capture + GetExtendedTcpTable. Windows only,
                    with a stub on other platforms so tests still run
src/
  main/             main process — the only code that touches disk, the network, or the addon
    protocol/       cipher, framing, opcode transform tables, per-opcode decoders, session state.
                    Pure TypeScript. No Electron import, so the vitest node project covers it all
    capture/        PacketSource interface, live pcap source, replay source, recorder, redirect tracker
    model/          pure (state, packet) => state reducer for a character record
    store/          crash-safe JSON persistence
    handlers/       plain handler fns + registerHandlers registry
    log.ts          per-launch diagnostic log; paths.ts (assertInsideDir); recordings.ts (list,
                    delete, and the byte cap)
    index.ts        thin lifecycle shim; settingsManager.ts; splash.ts
  preload/          index.ts — typed contextBridge contract exposed as window.api; index.d.ts augments Window
  renderer/src/
    App.tsx         ThemeProvider + CssBaseline + hydration gate
    components/ pages/ store/ (zustand) themes/ (6 themes) lib/ __tests__/
                ErrorBoundary catches a render failure and reports it to main's log
  shared/           types.ts — pure TS, NO electron/node imports; importable by all three processes
```

Aliases: `@renderer` to `src/renderer/src`, `@shared` to `src/shared`.

## Load-bearing house patterns (do not reinvent)

- **Main owns all disk, network, and IPC I/O. The renderer only calls the typed `window.api`.** Adding a feature means handler, then preload method, then `shared/` type.
- **Handlers are plain functions taking `(ctx, ...args)`** (no IPC event argument) so they are directly unit-testable. `registerHandlers({ ipcMain, ... }, ctx)` wires them to channels.
- **`shared/` stays free of Electron and Node imports** so both processes and the vitest node project can import it.
- **The protocol layer is pure and testable.** Decoders take a `Uint8Array` and return a typed object. Keep disk, sockets, and Electron out of `src/main/protocol/`.
- **`PacketSource` is the test seam.** Anything above it must run from a recorded session with no adapter, no driver, and no game.
- **Frameless window and custom title bar**, `contextIsolation: true`, `sandbox: false`.
- **Splash and `app:ready` reveal handshake**. The main window stays hidden until the renderer hydrates settings, with a 15 s backstop.
- **Main-process diagnostics go through the logger, never `console.*`.** `main/log.ts` writes one
  `session-<stamp>.log` for each launch under `%LOCALAPPDATA%\Erisco\Midir\logs` and keeps the
  newest ten. A packaged build has no console, so a `console.error` is a message nobody can read.
  Pass the `Logger` in (`createSettingsManager`, `createSplashWindow`, `HandlerContext.log`) rather
  than importing a singleton. The renderer reports its own failures over `diagnostics.report`, so
  one file answers "why did it fail" whichever process broke.
- **The recordings cap never deletes the file capture is writing.** `pruneRecordings` and every
  delete path take the path from `captureService.status().recordingPath` and skip it. Removing a
  file under the recorder would corrupt the running session.
- **Hand-rolled crash-safe JSON settings** under `%LOCALAPPDATA%\Erisco\Midir` (resolve `LOCALAPPDATA` yourself on win32), atomic tmp to rename with a `.bak`, Zod-validated on save.
- **Path safety**: validate every renderer-supplied path against allowed roots (`assertInside*`).
- **Six shared themes** — four Dark Ages (hybrasyl default, chadul, danaan, grinneal) plus the corporate pair (mundanes light, dubhaimid dark). Cinzel and Crimson fonts. Scrollbar colors go to `:root` CSS variables. The `ThemeName` union lives in `shared/`.

## Decoding notes that are easy to get wrong

- **`SStatus 0x08` is flag-gated.** The byte after the opcode selects which blocks follow (`0x20` core stats, `0x10` health and mana, `0x08` experience and currency, `0x04` combat modifiers, `0x01` mail state, `0xC0` privilege level). A partial update must **merge** into the stored record. It must not replace it.
- **Trailing bytes are not fields.** The retail parsers stop at the last field they read. A decoder must accept a body that is longer than the fields it consumes.
- **The retail protocol has no bank opcode.** Bank contents arrive as NPC dialog: `SScreenMenu 0x2F`, menu type 4, **pursuit `0x56`**. The pursuit is a server-wide constant, not a per-NPC dialog id — three bank NPCs used it, and a _shop_ buy list from one of those same NPCs used `0x4a`. The row is `[u16 sprite][u8 color][u32 count][string8 name][string8 desc]`; both protocol sources call that `u32` a price, but in a bank it is the **quantity held**. Bank data is opportunistic — it updates only when the player opens the bank. Always show the "as of" time.
- **An empty bank sends no reply at all**, so silence on its own is identical to never having opened one, to a missed packet, and to capture starting late. **The player's request is what tells them apart.** `CMerchant 0x39` pursuit `0x45` is "withdraw item", and a request with no list behind it, on a connection that lost no bytes, is an empty bank. That is the only thing that may render one as empty; a record with no bank at all is still unread, never empty. The wait is `BANK_REPLY_WINDOW_MS` in `model/character.ts`, against observed replies of 119 to 253 ms. See `protocol/decode/dialog.ts`.
- **Client opcodes `0x39` and `0x3A` carry a second layer under the transform.** The dialog-response inner wrapper is a random header, a custom CRC16, and an incrementing XOR, and only these two opcodes have it. A body that decrypts cleanly and matches no known layout is this, not a decrypt bug. The CRC is the proof the outer key was right. See `protocol/dialogWrapper.ts` and `protocol/crc16.ts`, whose CRC16 is **not** CRC-16/XMODEM.
- **The world map is an edge that needs a click, not a map.** A gateway map's edge tiles open `SFieldMap 0x2E`, a pane of points; the walk continues only when a point is clicked, and the client echoes that point's four words as `CFieldMapClick 0x3F`. Retail fills those words as checksum 0, the destination map id, and the arrival tile, so the walker picks the point by map id and clicks the position the wire gives. `WorldMap.dat`'s exit-line ints are DA Walker's click pixel for the same hop, kept as `via` on the exit by the importer; the header ints are the map size. See `route/graph.ts` and `decode/fieldMap.ts`. The client's `0x3F` is the only proof a posted click landed; wait for it, not for the map change. Every screen coordinate the wire or a legacy tool gives is in the game's 640 x 480 space; `actionLayer.click` scales it to the window's physical client size (Windows display scaling made a 960 x 720 window in the live check, and Windows translates a posted message's coordinates into a DPI-unaware window's space, so the physical size is right for an aware and an unaware window alike); callers pass game coordinates and never scale themselves. And `WorldMap.dat` is sometimes a tile off: corrections go in `scripts/worldmap-overrides.json`, with the observation, never in the `.dat` or the JSON.
- **A dialog row is chosen by a click, never by a number key.** The client ignores a posted digit on a dialog (live check, 2026-09-21). The rows' screen positions are the client's layout (`lnpcd.txt`, `lnpcd2.txt` in `setoa.dat`: 18 px pitch, x 193 to 579) plus one measured fact the layout does not hold: the pane grows upward, so the last row's centre is at y 335 and the rest stack above it (`rowY` in `laborer.ts`). A dialog's text field has focus when it opens, so text is `typeText` (characters, then Enter), not `typeLine`, whose opening Enter is for chat. The pane watcher pairs a hand click with the row the client sends, which is how the positions were measured and how a wrong one is caught.
- **A popup holds the character still; the walker closes it and never chooses.** A dialog the walker did not open was pushed on the character (a verdict; another player's prayer or fellowship invite, which is a `0x30` _with options_), and the pane's own Close is what the player does with it: it chooses no row, types no text, and the server reads it as no answer. The dismiss is a click on the dialog's Close at (589, 461) — a posted Escape did not close a dialog (live, 2026-09-21), as a posted digit does nothing on a row; one that survives the click stops the walk as `dialog`. The credential pane (type 9) is never touched. The rule and the gestures are `dialogScreen.ts`; the walker asks it before a missed step counts as a stall (`checkPopup`), and the Laborer's close step clicks the same button — the Laborer keeps its stricter "stop on a dialog it did not expect", because its dialogs are ones it asked for. **An exchange window is not a dialog**: it is `SExchange 0x42` (`model/exchange.ts`), it opens when another player drags an item onto the character, Escape is its own cancel (never OK) and `pressKey` posts Escape as a real press does (down with scan code, `WM_CHAR` 0x1B, up: a bare down-and-up left it open), its Cancel button's place is unknown (the `_nexch.txt` layout gives the button, not the pane's position, and the centred guess missed) until the pane watcher measures it from a hand click paired with the client's `0x4A` cancel, and the client's one-button confirm after the close ("Exchange cancelled.") is local and holds the character too, so the reducer holds an `alert` state from the close and the walker gives it one Escape of its own (its button is at (403, 167) by hand click). The party byte is 0 for the player and 1 for the partner; the document repo's page has it the other way round, and the client binary and Hybrasyl agree on this one.
- **A right-click on empty ground is a walk; two right presses close together on a creature are an attack.** The client plans a right-click walk itself (breadth-first over the walls it has drawn for the current view) and sends the ordinary `CWalk 0x06` steps, so the walker confirms each tile as it does for a key; it aims at most eight tiles along its own A* path, short of every warp tile and of every tile something solid stands on, and re-plans from wherever the client stops (WP35, `clickStretch` in `walker.ts`). The client makes its double right-click itself, from a second press under 1000 ms and within 2 px, so `actionLayer.rightClick` waits out `RIGHT_CLICK_GAP_MS` (1500) before any second press: the double is impossible there, not in the callers. What stands where is `model/entities.ts`, from `SDrawObjects 0x07` (retail batches up to 152 objects in one packet; type 0 is a solid monster, 1 walk-through, 2 an NPC with its name), `0x0C`, `0x0E`, and `0x33`, cleared on a new map and on a loss. A tile's ground is at the WP17 view centre (312, 199) plus the isometric offset (`groundPoint` in `laborer/view.ts`); the pane watcher logs every hand right-click with the tile the projection names and the tile the character stops on, which is the check. The mode is the `walkerRightClick` setting, off by default; a stop halts Midir at once and the client finishes the stretch it was given.
- **A server notice is not a refusal on its own.** `SSystemMessage 0x0A` type 3 carries the refusal of a step ("(( Register first … ))", "<name> doesn't need any jobs done"), but the same packet carries a footnote beside a dialog ("(( 4 Temauiran days = 12 Terran hours ))"), the word after a close ("You stop supporting …"), and world chat. A driving assistant reads a notice only when a step of its own got no dialog within the wait, and reports the first one after the step. See `model/notice.ts` and the Laborer's `waitForDialog`.
- **Registration is read from positive signals only, and citizenship is the `nation` byte.** Neither is a field the wire states outright. "Your expiration date is 8-22" (`0x0A` type 3 at login) means registered; "(( Register first … ))" and "((Register at … ))" mean unregistered; the legend's "Unregistered" mark means unregistered but is not always there. Silence means nothing, and the newest signal wins because a registration expires. Citizenship is the SelfLook `nation` byte, on the record as `citizenship` (4 Mileth, 6 Rucesion, 3 Loures; `NATION_OF_TOWN`), not the legend: only Mileth and Rucesion mark it, Medenia does not remove other towns' marks, and Sylphid is nation 7 with a stale Rucesion mark. Value 0 is a citizenship of nowhere and a fact once seen (it bars the Commons and clout), which is why the record carries `citizenship` beside `appearance.nation`, whose default is 0. The Mileth Commons admits Mileth and Loures, the Rucesion Commons Rucesion and Loures, no other map is gated, and a gate refuses with "Only a <Town> citizen may enter here"; the walker plans around the gates its character cannot pass, and treats the gate's own refusal as the authority for the session. See `model/access.ts` and `route/access.ts`.
- **The two directions have separate transform tables and separate sequence counters.** Do not share one counter.
- **Logging off is two packets, and only the second one counts.** `CClientExit 0x0B` sends `endSignal = 1` when the quit dialog opens and `endSignal = 0` when the player confirms. Reading them the other way round reports a player gone every time they open the prompt and change their mind. The connection close is the signal that always arrives, because a client that crashes sends no exit packet at all — handle both.
- **A logged-in character belongs to its connection, not to the service.** `captureService` keys live characters by connection id so a close or an exit clears the right one. This is also what a future multi-client mode needs; only `CaptureStatus` still narrows it to one name.
- **The record runs on capture time, not on the wall clock.** `TrackedEvent.timestampMs` carries the time the bytes were captured, and everything above the source seam uses it. They are the same during a live capture and very different during a replay, where the wall clock would collapse a whole evening into one second and break anything that measures elapsed time.
- **A field the store schema does not name is dropped on load, silently.** Add every new `CharacterRecord` field to `characterSchema`. The bank was missing from it, so every reading was lost at the next start. `mergeCharacter` is the other half: a fresh login knows nothing about the bank, so it must not replace one, and the write queue merges the same way the file does.

## Verifying changes

`npm run dev` launches a real Electron window and **cannot run headless or sandboxed**. Verify with `npm test`, `npm run typecheck`, and `npm run build`. Hand GUI click-throughs to the user.

The live capture path needs Npcap, an adapter, and a real game session. It cannot be verified by an agent. Use `replaySource` and a recorded session file for everything below the `PacketSource` seam, and say plainly when a check is handed to the user.

## MUI v9 gotchas

Prop APIs differ from v5 to v7 and fail typecheck with unclear messages:

- `ListItemText` has no `primaryTypographyProps`. Use `slotProps={{ primary: { … } }}`.
- `Stack`: put `alignItems` and `justifyContent` in `sx`, not in top-level props.
- Icons v9 drops deprecated base names. Use `HelpOutlineOutlined`, not `HelpOutline`.

When you are not sure of a v9 prop shape, grep a sibling app (`oghma`, `elatha`, `creidhne` under `src/renderer`) for the working idiom. Do not guess.
