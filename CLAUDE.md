# Midir

Midir is a companion app for **retail Dark Ages** (USDA client 7.41, `da0.kru.com`). It captures the game client's network traffic, decodes the protocol, and keeps a persistent record of every character the player logs in on. The record drives a searchable cross-character item index and a per-character detail view. The model is Altoholic for World of Warcraft.

Retail is the only target. Hybrasyl is not supported. Windows is the only platform: the game client runs on nothing else, so Midir builds no macOS or Linux package, and a house standard for those platforms (the macOS title bar and menu, Linux icons) does not apply. `scripts/icons.test.mjs` keeps `electron-builder.yml` Windows-only.

## The rules that make this app what it is

**Midir reads from the wire and acts through the client.** The two halves have different rules, and the split is the charter. It replaced a plain "read-only" rule on 2026-07-23, when DA Walker and DA Speaker were folded in — see `docs/plans/00-overview.md` for what changed and why.

**Reading is passive, and stays passive.** Capture is through Npcap and nothing else. Midir does not read the client's memory, and must not start: DA Walker used `ReadProcessMemory` and a pointer table only because it had no protocol decode. Midir has one, so the map, the coordinates, the slots, and the bank all come off the wire. A pointer table for one build is also a maintenance debt that a wire format is not.

**Acting is through the client's own input queue by default.** Midir posts keys and clicks to the game window, exactly as DA Walker and DA Speaker do. It sends no packet in this mode, the client validates every action, and nothing happens that a player could not do by hand.

**A forged packet is allowed per feature, and it is not cheap.** It is the right answer only where driving the UI is genuinely unreliable — a dialog step, not a footstep. Know the cost before choosing it: Midir cannot write into the client's own TCP socket, so a forged packet means a **proxy** (the client connects to Midir, Midir connects to the server), a full encrypt path, the client-direction integrity bytes, the submission terminator, the dialog wrapper for `0x39`/`0x3A`, and re-numbering of everything downstream. That ends the "no proxy" rule, so it is a spike before it is a feature. **Nothing sends a packet until that spike lands** (WP18).

**These stay forbidden, whichever mode a feature uses:** no injected DLL, no client patch, no write to the client's memory or files, and no read of its memory.

**Every driving feature ships off, with a stop that always works.** Off by default, one obvious global stop, and it stops on losing the game window. Midir must never automate a credential dialog or a password field.

If a feature seems to need something this section forbids, stop and ask.

**Decryption needs the handshake.** Every cipher input is on the wire in the clear or is a constant: the startup key, the seed-table selector and key from `SVersionCheck` (S→C `0x00`, transform None), and the character name from `STransferServer` (S→C `0x03`, transform None) which seeds the MD5 session key. Because each encrypted packet carries its own sequence and seed bytes, decryption is **stateless per packet** — a dropped packet does not break the next one. But Midir must be running **before** the player logs in. That is a first-class UI state, not an error.

**A session recording never holds a credential from the game protocol.** `capture/scrub.ts` removes every client frame whose opcode is in `SECRET_BEARING_CLIENT_OPCODES` before the recording is written. The frame is found without a key, because the header states its length and the cipher leaves the opcode in the clear. Dropping a packet is safe: decryption is stateless per packet, and the character name comes from CTransferServer `0x10`. Do not add a recorder path that bypasses this, and add to the set rather than special-casing.

Two limits are known and stated, not fixed. The scrubber **stops recording a connection's client direction after a TCP gap**, because a walk that has lost its place cannot be resynchronised safely — see the `onGap` comment for the two ways it used to leak. And the capture filter is bare `tcp` over every connection the game process opens, so it is not only the game protocol: one dialog type is documented to send an ID and password in a plaintext HTTP URL from that same process, and the frame walk does not touch HTTP. Do not describe a recording as free of credentials without that caveat.

**Commits carry no AI co-author trailer.** Sabrael is the only contributor to this repo. This overrides any global `Co-Authored-By` preference.

**Documentation and comments follow ASD-STE100 Simplified Technical English.** One instruction per sentence, present tense, active voice, short sentences, no idioms.

## Work packages

`docs/plans/` holds the work packages. **`docs/plans/00-overview.md` is the index — read it before any WP**, and `00a-backlog.md` is the register of everything known and not scheduled, each entry with the trigger that would promote it. Shipped WP docs live in `docs/plans/complete/`; planned ones stay at the top level. WP1 to WP6 and WP8 to WP11 are retrospective records of what shipped, not plans written first. This file stays the law; a WP doc has to agree with it.

## Canonical references (read these first)

- **Retail protocol, house description** — the document repo's `docs/protocol/`. Per-opcode files under `client/` and `server/`, plus `WIRE-FORMATS.md`, `OPCODE-MAP.md`, `CLIENT-FRAMING.md`, and `DISCREPANCIES.md`. Many entries carry binary verification against the USDA client and note which paths are dead in that build. **Where the two sources disagree, follow this one.**
- **Retail protocol, second description** — `Repos/darkages-741-re/docs/network/`. `packet-transforms.md` has the complete cipher. `transport.md` has the frame and greeting. `server/*.md` and `client/*.md` have byte-exact wire formats.
- **House working practices** — the document repo's `docs/architecture/dev-practices.md` (git and commit discipline, PR prep, verify-before-commit, security posture).
- **Electron stack standard** — the document repo's `docs/architecture/electron-app-skeleton.md`. Midir is a copy of `Repos/hyb-electron-template`.

**Read both protocol sources.** They are not a superset and a subset. Each holds opcodes and details the other lacks, and they disagree on real fields. Deciding the credential-scrub set needed both: `darkages-741-re` alone gives three password-bearing client opcodes, the document repo gives five and binary-verifies a field the other describes as unused.

Never name the internal document repo in commits, PR titles, PR bodies, or branch names. Call it "the document repo".

**Do not edit the document repo's protocol pages from this repo, and not without express permission.** A measurement Midir makes that a page does not hold is filed as a card on the ERISCO board, labelled `Comhaigne`, for the owner of the page to accept or refuse. `darkages-741-re` belongs to another author, so anything for it is an upstream report at most.

**A claim that Chaos-Server is right where Hybrasyl is wrong must be defended rigorously.** Hybrasyl is built for retail compatibility; Chaos makes no such promise. So the prior runs the other way, and the burden is on the claim against Hybrasyl. A difference the client cannot observe — trailing bytes past the field it reads, for one — is trivia about a serializer and is not evidence of either. State what was measured, and stop there.

## Commands

```bash
npm run dev            # electron-vite dev — launches the app; needs a GUI (see Verifying)
npm test               # vitest run (node + jsdom projects)
npm run typecheck      # tsc --build --force (--build alone misses changed types in node_modules)
npm run lint:check     # eslint, no writes
npm run lint           # eslint --fix
npm run format         # prettier --write .
npm run build          # electron-vite build (main + preload + renderer)
npm run build:win:portable   # packaged portable Windows build
npm run format:check   # prettier --check . (in validate)
npm run verify:fuses -- dist/win-unpacked/midir.exe   # read the fuses off a package
```

Gate before committing: `npm run validate && npm run build` (`validate` is lint, format, typecheck and the unit tests).

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
- **Frameless window and custom title bar**, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. The preload imports `electron` and nothing else at run time; `scripts/verify-preload-sandbox.mjs` reads the built preload, because a package import there breaks the sandboxed loader only in the packaged app. `windowSecurity.ts` guards navigation, child windows, external links, and every IPC's sender (a proxy over `ipcMain` at the one `registerHandlers` call), and puts the CSP on the response. The single-instance lock, the remote-session predicate, and hide-on-close sit at module scope in `index.ts` in an order `bootOrder.test.ts` pins (WP28).
- **Splash and `app:ready` reveal handshake**. The main window stays hidden until the renderer hydrates settings, with a 15 s backstop. The splash is the template's controller: `dismiss(onDone)` shows it if it never painted, holds it for its 600 ms floor, then destroys it and reveals the main window from the callback; it destroys itself after 20 s and with the main window.
- **Main-process diagnostics go through the logger, never `console.*`.** `main/log.ts` writes one `session-<stamp>.log` for each launch under `%LOCALAPPDATA%\Erisco\Midir\logs` and keeps the newest ten. A packaged build has no console, so a `console.error` is a message nobody can read. Pass the `Logger` in (`createSettingsManager`, `createSplashWindow`, `HandlerContext.log`) rather than importing a singleton. The renderer reports its own failures over `diagnostics.report`, so one file answers "why did it fail" whichever process broke.
- **Report an issue is the house module** (`docs/architecture/report-issue-module.md`, balor's port) **over Midir's own log**: `main/diagnostics.ts` builds the block from the logger's newest warnings and errors and scrubs it there, the one scrub site, because the log is the Diagnostics tab's record on the player's machine and is not scrubbed at capture. The dialog is opened from the title bar, the About card, and the error boundary; every send copies the full report to the clipboard first. `appIdentity.ts` is the one per-app file; the intake is `hybrasyl/cernunnos` under `app:midir`.
- **The update check is the house module, and it is Midir's one outbound request.** `docs/architecture/update-check-module.md`, ported from the template with the version header on all five files; a fault is fixed in the template and ported back, never patched here. It reads one keyed `versions.json` on cernunnos over `raw.githubusercontent.com`, **never the GitHub releases API**: that API answers 404 and not 403 for a private repository, so the old house copy read "no releases" forever and said nothing, and Midir being public is exactly how the house ends up with two mechanisms again. Three rules are load-bearing. **"Up to date" and "could not tell" are different values** (`{ ok: true, update }` against `{ ok: false, reason }`), which is the fault that silence caused. **A release URL is refused unless it is `https` and under `appIdentity.releaseUrlPrefix`** — other maintainers can write the manifest, so this is what stops an edit there sending Midir's users elsewhere; Midir is the one house app outside `hybrasyl/` and `eriscorp/`, so its prefix is its own. And **`fetchImpl` is `net.fetch`, never the global one**, because `net` takes the system proxy and the OS certificate store, which is the difference behind a corporate MITM root. It notices a release and installs nothing. A key with no entry answers `no-entry` and shows nothing, which is the live state until the first release, so the notice is proved by a test and not by a release. `SECURITY.md` and `README.md` state the request; that edit is owed by whichever app ships the check first, and it is Midir's now (WP44).
- **Every picker goes through `withPickerStart`** (`main/pickerStart.ts`, HTOO-553). Since Electron 43 a dialog with no `defaultPath` opens in Downloads, so `index.ts` wraps the dialog once, the way `guardIpc` wraps `ipcMain`, and a handler takes a `PickerDialog` with the parent window first. The start folder is the last pick this session, then the Dark Ages folder in memory, then Documents, then home. Never call `settingsManager.load()` to find it: a load that recovers from the backup writes the backup back.
- **The main-process clipboard is a Promise since Electron 44, and the report flow awaits it** (`copyToClipboard` in `main/diagnostics.ts`, bounded at 3 s). The issue page is opened only after the copy settles, because the page tells the user to paste; a failed copy still opens it, and `OpenIssueResult.copied` makes every message stop promising a clipboard.
- **The fuses are on, and a changed `app.asar` is a dead app** (HTOO-374, HTOO-381). `electronFuses` in `electron-builder.yml` turns off `runAsNode`, `NODE_OPTIONS` and the inspect arguments and turns on asar-only loading and embedded asar integrity; `verify-fuses.test.mjs` pins the block, and the release job reads the wire off `midir.exe` before signing. A changed archive exits 1 with `ASAR Integrity Violation` and no window, so start the packaged build before a tag. The da-pcap addon is `asarUnpack`'d and loads with the fuses on; check that again after any change to `asarUnpack`.
- **A resolved `flush()` means the file is written, whoever started the write.** The capture service's debounce timer flushes unawaited; every `flush` joins one promise chain, so `stop()` and a test never return with a write still in the air (the WP36 test's `ENOTEMPTY` flake). Do not add a second save path that bypasses `flush`.
- **The recordings cap never deletes the file capture is writing.** `pruneRecordings` and every delete path take the path from `captureService.status().recordingPath` and skip it. Removing a file under the recorder would corrupt the running session.
- **The settings save payload is derived, never listed.** `shared/settings.ts` builds it from `DEFAULT_SETTINGS`'s keys (plus the optional `darkAgesPath` when set), and `settingsPayload.test.ts` pins the keys to the Zod schema's. A destructured list was silent data loss on the next field added (the template's HTOO-235). Adding a setting is: the type and default, `withDefaults` in the manager, the schema, the store setter.
- **Hand-rolled crash-safe JSON settings** under `%LOCALAPPDATA%\Erisco\Midir` (resolve `LOCALAPPDATA` yourself on win32), atomic tmp to rename with a `.bak`, Zod-validated on save.
- **Path safety**: validate every renderer-supplied path against allowed roots (`assertInside*`).
- **A pinned destination carries its own label.** A map's name is often not what the player calls the spot on it: "Mileth Altar" is a reactor on Mileth Village, map 500. So a pin is `{ label, destination, tile? }` (`WalkerPin`), the chip shows the label and its tooltip shows the place and tile, and naming it is its own step when it is pinned. `pinOf` in `shared/actionLayer.ts` reads the older form, one string like `Place @ x,y`, so a settings file written before this keeps its pins. The **renderer reads a stored pin through `pinOf` as well**, although main normalises what it loads: the page reads `pin.destination` on every render, and a pin in the older form took the whole page down four times in one day while the main process had not restarted on the new code (the log of 2026-09-27). A value the store cannot read is dropped, never rendered.
- **A picked game window is remembered by its window handle, never by its connection id.** A connection id is minted per login, and a logged-out client holds no connection at all (one recording has 102 seconds of none), so keying the picker on it made the window vanish from under the player the moment they logged out. `AssistWindow.connectionId` is therefore optional and `windowHandle` is the identity: `windowKey`, `pickedWindow`, and `connectionOf` in `shared/actionLayer.ts` are the three helpers every driving tab uses, and a client with nobody logged in stays in the list with its buttons off.
- **A push is the ordinary path, and the window's own return is the check.** The capture status goes to the renderer on `capture:status-changed` and the title bar follows it. Nothing proved that push, and the indicator read wrong until a visit to Settings — the one tab that asks main again (Sabrael, 2026-09-27). So `App` re-reads the status when the window takes focus or becomes visible (`captureStore.reconcile`, the status alone: the adapter list costs a device enumeration and does not change while Midir runs). **A login is a refresh of everything a login moves.** Every driving tab reads its window list again on any status change, and the Walker reads its **destinations** again when the character list changes, because reachability is from where the character stands (WP39) and a connection that opens and closes moves nobody. Main logs a login and a logout by name, because a report that the indicator read wrong had no evidence either way.
- **A killed portable stub leaks its unpack folder, so a portable launch sweeps.** The portable exe is an NSIS stub: it unpacks into `%TEMP%\ns*.tmp`, runs the app, and deletes the folder when the app exits — after a normal close, a second launch, and a crash alike, because it is still waiting on the app. **Kill the stub and nothing runs its `RMDir`.** `portableSweep.ts` removes what earlier launches left, 30 s after boot, under four rules that are the safety case: only as the portable exe and only when it can find its own unpack folder, only `ns*.tmp` folders holding `app\<exe>` and `app\resources\app.asar`, only folders older than ten minutes, and **rename before delete** because Windows refuses the rename while anything runs from the folder. **Pass `original-fs`, never `fs`:** Electron's patched `fs` opens any path ending in `app.asar` and keeps the handle, so every rename is then refused — oghma's first packaged build skipped every real leftover that way while its unit tests passed under plain Node. `original-fs` is external in `electron.vite.config.mjs` or Rollup cannot resolve it (HTOO-494).
- **`portable.unpackDirName` is `true`, not the documented `false`.** Unset or `false`, app-builder-lib bakes one KSUID into the exe at build time, so every copy of a build extracts to the same `$TEMP` directory: a second launch does `RMDir /r` on the directory the **running** app executes from, fails on the locked exe, and shows NSIS's own "Midir cannot be closed" Retry/Cancel box. The single-instance lock cannot stop that, because the stub runs before Electron starts. `true` is the one value that leaves `UNPACK_DIR_NAME` undefined, so NSIS uses `$PLUGINSDIR`, unique per process. Do not "correct" it to `false`; creidhne's config carries the artifact-byte measurement that proved the docs wrong. The cost is that a killed launch's folder is never reclaimed by name, which is what the sweep above is for (HTOO-351, fault 2).
- **The portable target has no `splashImage`, on purpose.** With one the NSIS stub runs in GUI mode and re-shows its own hidden "Setup" dialog after the app exits, which is a blank window flashing on every close, with no hook to stop it. Without one the stub runs silent. The cost is a busy cursor while it unpacks, which the in-app splash cannot cover because Electron has not started yet. Midir never had the image; `scripts/portable-config.test.mjs` is what stops one being added (HTOO-466).
- **The Items index is windowed above 60 rows, and the bounded lists are not.** A row there is not cheap — the item's icon, and a tooltip for each holder — and the index grows with every character: 25 characters make 703 rows and 1375 holders, which measured 9532 DOM nodes and 1866 ms of mounting before anything reached the screen, and 2805 rows measured 5738 ms. Windowed it mounts 14 rows, 278 nodes, in 245 ms, and the cost stops following the record: the same page at four times the data measured 221 ms. `@tanstack/react-virtual` is the house choice (oghma, taliesin), with oghma's table pattern — a threshold, spacer rows holding the scroll height, and `measureElement` on every row because a held-by cell wraps and a row with a dozen holders is several times the height of a row with one. **The window is in force only once it has placed something**: a scroller it cannot measure would otherwise be an empty table, which is worse than a slow one, so the full list renders until a measurement arrives (jsdom has no `ResizeObserver`, which is exactly that case). **A windowed table states its column widths, and its layout is `fixed`.** The automatic layout sizes a column from the cells that are in the DOM, and windowing means that is fourteen rows out of hundreds, so every scroll put a different longest item name in view and the first column jumped under the pointer (Sabrael, 2026-09-28). `COLUMN_WIDTHS` and a `<colgroup>` state all four: the bounded columns take fixed room and the two text columns share the rest. Both paths carry it, because narrowing the search under the threshold swaps the window for the full list and two layout rules there would move the columns again. The row heights are still measured; it is the widths that cannot be left to the rows. The inventory, bank and legend lists stay unwindowed on purpose: 60 slots, 65 rows and 100 marks are bounded, and the inventory is behind a collapsed accordion already (HTOO-85).
- **Six shared themes, and they are the house template's files** — four Dark Ages (hybrasyl default, chadul, danaan, grinneal) plus the corporate pair (mundanes light, dubhaimid dark). Cinzel and Crimson fonts. Scrollbar colors go to `:root` CSS variables. The `ThemeName` union lives in `shared/`. Each theme file is the template's file plus one spread of `themes/midirOverrides.ts` (the accordion and tooltip overrides the template does not have), so a palette fix is made in the template and ported by copying the six files; `midirOverrides.test.ts` fails if a theme loses the spread. Each theme spreads the template's `themes/filledControls.ts` first and `midirOverrides` second; `midirOverrides` must not set `MuiButtonBase` or `MuiAlert`, or it replaces the shared fragment. The template's tests come with them (`themes/__tests__/`): contrast 3:1 and 4.5:1 for every theme with no exemption list, the rendered selected chip, the filled controls, the rendered title bar. `midirMarks.test.ts` holds Midir's own marks (the Map tab's warps and path) at 3:1 on an open tile. **A selected chip is `color="primary"`, never a variant alone**: each theme tints a plain chip in both variants, so filled and outlined look the same. A selection mark or a line drawn over the page takes `primary.main`, the token held at 4.5:1 on the page and on paper, not `.light`. **`secondary` is a fill only**: the bar colour, with `secondary.contrastText` on it, never text, an outline or a mark on the page. `text.dark` is not text on `info.main`; use `info.contrastText`. Every decorated bar (hybrasyl, chadul, danaan, grinneal) is dark with light, keylined text; the engrave is gone (HTOO-572, HTOO-355).
- **The title bar is the house module, title-bar v1** (`components/TitleBar.tsx` and `components/titleChrome.ts`, copied from the template as they are). It reads no store and no `window.api`. `components/AppTitleBar.tsx` is Midir's wiring: the theme, `midir.webp`, the product name, the window calls, and the capture indicator as a child. Change the house files in the template and port them; change `AppTitleBar` here. `AppTitleBar` passes `platform="win32"`: Midir is Windows-only, its window is frameless with no `hiddenInset` stoplights, and on `darwin` the house bar leaves out the window buttons. `PLAIN_CHROME_THEMES` lives in `titleChrome.ts`, not `shared/`.
- **The theme gallery** (`pages/ThemeGallery.tsx`, the template's page with Midir's icon and name) opens from Settings → Appearance. It is the `gallery` view, which has no tab. `e2e/theme-gallery.spec.js` measures every sample in the real renderer and writes the low ratios to `theme-gallery.json` in its output folder.

## Decoding notes that are easy to get wrong

**They are in [`src/main/CLAUDE.md`](src/main/CLAUDE.md)**, which Claude Code loads when work enters `src/main/`. Every rule there is cited from code under `src/main/` (the protocol layer, `model/`, `route/`, `store/`, the walker, the Laborer, capture). Read it before any change to the decode, the record, the route graph or a driving assistant, and add a new decoding rule there, not here (HTOO-525).

## Verifying changes

`npm run dev` launches a real Electron window and **cannot run headless or sandboxed**. Verify with `npm test`, `npm run typecheck`, and `npm run build`. Hand GUI click-throughs to the user.

The live capture path needs Npcap, an adapter, and a real game session. It cannot be verified by an agent. Use `replaySource` and a recorded session file for everything below the `PacketSource` seam, and say plainly when a check is handed to the user. `MIDIR_REPLAY=<recording> npm run dev` plays a recording into the whole app in place of an adapter (start capture on any device name); the e2e suite runs on `e2e/fixtures/session.ndjson`, a synthesised recording, never a real one, because the repository is public.

## MUI v9 gotchas

Prop APIs differ from v5 to v7 and fail typecheck with unclear messages:

- `ListItemText` has no `primaryTypographyProps`. Use `slotProps={{ primary: { … } }}`.
- `Stack`: put `alignItems` and `justifyContent` in `sx`, not in top-level props.
- Icons v9 drops deprecated base names. Use `HelpOutlineOutlined`, not `HelpOutline`.

When you are not sure of a v9 prop shape, grep a sibling app (`oghma`, `elatha`, `creidhne` under `src/renderer`) for the working idiom. Do not guess.
