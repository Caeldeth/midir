# E2E (Playwright + Electron)

End-to-end specs that drive the **built** app via Playwright's `_electron` launcher — the
house standard for cross-boundary behavior Vitest can't reach (disk round-trips, real window
geometry, full themed renders). Full rationale + patterns: see the document repo's
`docs/architecture/e2e-playwright-electron.md`.

## Running

```bash
npm run e2e        # builds (electron-vite) then runs all specs
npm run e2e:only   # runs specs against the existing out/ build
```

Local-only for now. CI would need a virtual display (headed/xvfb), so this isn't in the
`release.yml` validate job yet.

## What's here

- **`helpers.js`** — the reusable harness:
  - `launchApp({ seedSettings?, localAppData?, replay?, env? })` — launches the built app,
    strips `ELECTRON_RUN_AS_NODE`, and redirects `%LOCALAPPDATA%` to a temp dir so runs are
    hermetic. Reuse `localAppData` across two launches to test persistence. `replay` is a
    recording path: the app plays it in place of an adapter (`MIDIR_REPLAY`), and with
    `autoStartCapture` seeded the views fill on their own.
  - `getMainWindow(app, { bridge? })` — skips the splash and returns the real main window. It
    finds it by the `window.api` bridge (absent on the splash, which has no preload). Midir has
    no `window.electron` toolkit bridge since WP28.
  - `readGeometry(app, page, selector?)` — native window bounds + a DOM element's on-screen
    left edge, for measuring layout/offsets (see the offset-spec pattern in the house doc).
- **`app-boot.spec.js`** — smoke: splash → main window revealed → hydrated UI on screen.
- **`settings-persistence.spec.js`** — change theme → wait for the write to hit disk →
  relaunch same userData → assert it hydrated. The full renderer → IPC → disk → reload loop.
- **`nav-pages.spec.js`** — opens every tab in the real renderer and asserts none went to the
  error boundary (HTOO-393). A new view needs one line here; its marker is `page-<view>`.
- **`ipc-guard.spec.js`** — the main window reaches a privileged channel, and a rogue window
  with the same preload at the same URL is refused (`windowSecurity.ts`, R-006).
- **`replay-surface.spec.js`** — the views after a session, from a recording (WP21): the
  character list and sheet, the bank card with its "as of", the item index and its search,
  the Diagnostics log and recordings cards. No Npcap, no adapter, no game.
- **`fixtures/session.ndjson`** — that recording. Synthesised, not captured: this repository is
  public and a real recording carries names and other players' chat.
  `src/main/__tests__/e2eFixture.test.ts` builds it from plaintext packets and compares, so a
  cipher or packet change fails there; `WRITE_E2E_FIXTURE=1 npx vitest run e2eFixture`
  rewrites it.

## Adding specs

- **`USERDATA_SUBPATH`** in `helpers.js` must match `src/main/index.ts`'s userData dir
  (`['Erisco', 'Midir']`).
- Add specs for behavior the app actually has. Good candidates (all have an `epona/e2e/`
  reference): theme-switch smoke (all themes render, no `pageerror`), window-geometry
  invariants, filesystem-effecting IPC flows against a temp dir.
- The live capture path cannot run here — it needs Npcap, an adapter, and a game session.
  Drive that layer from a recorded session file through `replaySource` instead.

## Gotchas

1. `ELECTRON_RUN_AS_NODE` set in env → Electron boots as plain Node and crashes at
   `app.setPath`. `launchApp` strips it.
2. Splash window → `firstWindow()` can grab it. `getMainWindow` selects by the preload bridge.
3. Main window is hidden until the renderer signals `app:ready` → wait for `isVisible()`.
4. Test the **built** app; rebuild after any `src/` change (`npm run e2e` does `build &&` first).
