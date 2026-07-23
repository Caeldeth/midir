# Midir

Midir is a companion app for **retail Dark Ages** (USDA client 7.41, `da0.kru.com`). It captures the game client's network traffic, decodes the protocol, and keeps a persistent record of every character the player logs in on. The record drives a searchable cross-character item index and a per-character detail view. The model is Altoholic for World of Warcraft.

Retail is the only target. Hybrasyl is not supported.

## The rules that make this app what it is

**Midir is read-only. It never sends a packet, never connects to the game server, and never modifies the client, its memory, or its files.** Capture is passive, through Npcap. Do not add a proxy, an injected DLL, or a client patch. If a feature seems to need one, stop and ask.

**Decryption needs the handshake.** Every cipher input is on the wire in the clear or is a constant: the startup key, the seed-table selector and key from `SVersionCheck` (S→C `0x00`, transform None), and the character name from `STransferServer` (S→C `0x03`, transform None) which seeds the MD5 session key. Because each encrypted packet carries its own sequence and seed bytes, decryption is **stateless per packet** — a dropped packet does not break the next one. But Midir must be running **before** the player logs in. That is a first-class UI state, not an error.

**A session recording never holds an account credential.** `capture/scrub.ts` removes every client frame whose opcode is in `SECRET_BEARING_CLIENT_OPCODES` before the recording is written. The frame is found without a key, because the header states its length and the cipher leaves the opcode in the clear. Dropping a packet is safe: decryption is stateless per packet, and the character name comes from CTransferServer `0x10`. Do not add a recorder path that bypasses this, and add to the set rather than special-casing.

**Commits carry no AI co-author trailer.** Sabrael is the only contributor to this repo. This overrides any global `Co-Authored-By` preference.

**Documentation and comments follow ASD-STE100 Simplified Technical English.** One instruction per sentence, present tense, active voice, short sentences, no idioms.

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
    index.ts        thin lifecycle shim; settingsManager.ts; splash.ts
  preload/          index.ts — typed contextBridge contract exposed as window.api; index.d.ts augments Window
  renderer/src/
    App.tsx         ThemeProvider + CssBaseline + hydration gate
    components/ pages/ store/ (zustand) themes/ (6 themes) lib/ __tests__/
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
- **Hand-rolled crash-safe JSON settings** under `%LOCALAPPDATA%\Erisco\Midir` (resolve `LOCALAPPDATA` yourself on win32), atomic tmp to rename with a `.bak`, Zod-validated on save.
- **Path safety**: validate every renderer-supplied path against allowed roots (`assertInside*`).
- **Six shared themes** — four Dark Ages (hybrasyl default, chadul, danaan, grinneal) plus the corporate pair (mundanes light, dubhaimid dark). Cinzel and Crimson fonts. Scrollbar colors go to `:root` CSS variables. The `ThemeName` union lives in `shared/`.

## Decoding notes that are easy to get wrong

- **`SStatus 0x08` is flag-gated.** The byte after the opcode selects which blocks follow (`0x20` core stats, `0x10` health and mana, `0x08` experience and currency, `0x04` combat modifiers, `0x01` mail state, `0xC0` privilege level). A partial update must **merge** into the stored record. It must not replace it.
- **Trailing bytes are not fields.** The retail parsers stop at the last field they read. A decoder must accept a body that is longer than the fields it consumes.
- **The retail protocol has no bank opcode.** Bank contents arrive as NPC dialog (`SScreenMenu 0x2F`, `SPursuitMessage 0x30`). Bank data is opportunistic — it updates when the player opens the bank. Always show the "as of" time.
- **The two directions have separate transform tables and separate sequence counters.** Do not share one counter.

## Verifying changes

`npm run dev` launches a real Electron window and **cannot run headless or sandboxed**. Verify with `npm test`, `npm run typecheck`, and `npm run build`. Hand GUI click-throughs to the user.

The live capture path needs Npcap, an adapter, and a real game session. It cannot be verified by an agent. Use `replaySource` and a recorded session file for everything below the `PacketSource` seam, and say plainly when a check is handed to the user.

## MUI v9 gotchas

Prop APIs differ from v5 to v7 and fail typecheck with unclear messages:

- `ListItemText` has no `primaryTypographyProps`. Use `slotProps={{ primary: { … } }}`.
- `Stack`: put `alignItems` and `justifyContent` in `sx`, not in top-level props.
- Icons v9 drops deprecated base names. Use `HelpOutlineOutlined`, not `HelpOutline`.

When you are not sure of a v9 prop shape, grep a sibling app (`oghma`, `elatha`, `creidhne` under `src/renderer`) for the working idiom. Do not guess.
