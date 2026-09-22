# WP28 — app standards audit and adoption

**Size:** S, grown to M by the standard's own growth. **Depends on:** the house
electron-app-skeleton standard. Read `00-overview.md` first. **COMPLETE 2026-09-22.** **Card:**
`HTOO-77`, and the Midir row of every house Electron card named below.
**Trigger to start:** before the first release (WP27), or when a second instance or a wrong taskbar
identity becomes a real problem.

## Goal

Audit Midir against the house Electron app standard, and adopt what is missing. The document repo's
`docs/architecture/electron-app-skeleton.md` and `Repos/hyb-electron-template` are the standard. This
WP is a checklist pass: confirm each OS-integration standard is present and correct, and close the
gaps.

## Why the single instance is the load-bearing item

**The crash-safe JSON store assumes one writer.** A second Midir instance would open the same files
under `%LOCALAPPDATA%\Erisco\Midir` and both would write the record, the settings, and the
recordings. The atomic tmp-to-rename that keeps one writer safe does not coordinate two processes, so
two instances can lose data. The single-instance lock is therefore a **durability** fix, not only a
taskbar nicety.

## The audit, 2026-09-22

The standard grew between this doc and this pass: the template took single instance, hide on
close, the remote-session predicate, `windowSecurity.ts`, the Linux icons, and the CSP header on
2026-09-20, and the house tracker carries a card per item with a per-app roster. Sabrael: "we also
have cards labeled electron in oghma that Midir may owe things to." So the audit is that roster,
one row per card, each present, fixed here, deferred with a reason, or a deliberate non-goal.

| Item                                                            | Card                 | Before                                                                                                                      | Now                                                                                                                                                                                                          |
| --------------------------------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Single-instance lock; a second launch surfaces the window       | HTOO-351             | None. `app.whenReady()` was the first thing after `setPath`.                                                                | **Fixed.** `requestSingleInstanceLock` after `setPath` and the GPU call, `app.exit(0)` on loss, `second-instance` → restore, show, focus; `bootOrder.test.ts` pins the order.                                |
| Remote Desktop: drop to software rendering                      | HTOO-325             | None.                                                                                                                       | **Fixed.** `remoteSession.ts` (the template's), `MIDIR_DISABLE_GPU` in both directions, the CSS half on `dom-ready` (all four fantasy themes carry the blur), `systemRemote` unwired.                        |
| Hide on close, no white flash                                   | HTOO-456             | None; the splash had no `backgroundColor`.                                                                                  | **Fixed.** `win.on('close', hide)` with no guard (the capture flush in `before-quit` asks the renderer nothing); the splash controller sets `#00000000`; `windowClose.test.ts`.                              |
| Splash backstops (the four)                                     | —                    | The naive splash: `ready-to-show` alone, no self-destruct, no floor.                                                        | **Fixed.** The template's controller (`dismiss(onDone)`, 150 ms fallback show, 600 ms floor, 20 s self-destruct, destroyed with the main window), 14 tests, the logger kept.                                 |
| Renderer-boundary hardening (`windowSecurity.ts`, R-006)        | HTOO-61              | A bare `setWindowOpenHandler` → `shell.openExternal`; no `will-navigate` guard; no IPC sender check. All three findings.    | **Fixed.** The template's module: `hardenWindow`, `registerTrustedWindow`, `guardIpc` over `ipcMain` at the one `registerHandlers` call, `externalUrl.ts` in `shared/`; the e2e rogue window.                |
| CSP as a response header                                        | HTOO-467             | `<meta>` only.                                                                                                              | **Fixed.** `installContentSecurityPolicy` at `ready`; the renderer policy is the tag's, with `midir-icon:` in `img-src`; the splash gets its tighter policy; both pinned equal by test.                      |
| `sandbox: true` on the main window                              | HTOO-54              | `sandbox: false`, because the preload imported `@electron-toolkit/preload` to expose `window.electron`, which nothing read. | **Fixed.** The package is gone, `sandbox: true`, `contextIsolation` and `nodeIntegration` stated; `scripts/verify-preload-sandbox.mjs` reads the built preload (one specifier, `electron`).                  |
| A nav e2e spec: every page opens, none crashes                  | HTOO-393             | Three specs; no page walk. Hole 1 (a Node global in the renderer) is clean.                                                 | **Fixed.** `e2e/nav-pages.spec.js` over the nine tabs, on a `page-<view>` marker per view and the error boundary's `error-boundary-fallback`. The e2e suite runs locally: eight specs pass.                  |
| The Hybrasyl theme's `primary.main` is the page background      | HTOO-341             | `#0d182f` for both, so an active `color="primary"` control vanished.                                                        | **Fixed.** The template's palette (`main` `#4d84d1`, navy `contrastText`); `palette.test.ts` pins the contrast for all six themes.                                                                           |
| Linux icons: a generated `build/icons` directory, `mac.icon`    | HTOO-38              | One 1024 px PNG as the only icon, in `resources/`.                                                                          | **Fixed.** `build/icon.png` (the Red Hyb variant, Windows), `build/icon-square.png` (the `_fixed` tile), `scripts/make-icons.mjs` → `build/icon-mac.png` and `build/icons/`, `icons.test.mjs`.               |
| `desktopName` and `syncDesktopName`                             | HTOO-63              | Neither.                                                                                                                    | **Fixed.** `package.json` `desktopName: midir.desktop`, `linux.syncDesktopName: true`.                                                                                                                       |
| The window icon and the runtime logo assets                     | R-002                | The 1024 px master as the window icon; no title-bar logo.                                                                   | **Fixed.** `resources/midir-icon-256.png` (PNG32) for the window, `resources/midir-splash.webp`, `src/renderer/src/assets/midir.webp` in the title bar left of the name (Sabrael's ask).                     |
| `.gitattributes` and the `.vscode/settings.json` trailing comma | HTOO-236             | `.gitattributes` present; the scaffold's trailing comma present.                                                            | **Fixed.** The comma.                                                                                                                                                                                        |
| A CI gate                                                       | HTOO-390             | `release.yml` with a `validate` job on tag and dispatch; the pre-push hook.                                                 | **Fixed.** `ci.yml`, manual like the house's: `check` (typecheck, lint at zero warnings, tests, build, the preload check, the production audit) and `e2e` on `windows-2022`.                                 |
| `fetch-depth` at the checkout                                   | HTOO-328             | No answer recorded.                                                                                                         | **Recorded** in `ci.yml`: nothing in Midir reads git; depth 1 stays.                                                                                                                                         |
| `lint:check --max-warnings 0`                                   | §3                   | `eslint .`                                                                                                                  | **Fixed.**                                                                                                                                                                                                   |
| Report Issue / diagnostics (the house module)                   | HTOO-75              | None; the session log and the renderer's error forwarding were WP8's half.                                                  | **Fixed, as WP26.** balor's port over Midir's log: the dialog, the title-bar bug button, the About card, the error boundary's button, main's error nets, `app:midir` on the intake.                          |
| `allowScripts` in `package.json`                                | §3                   | None. npm 12 blocked electron's postinstall silently, so a fresh checkout had no runtime binary.                            | **Fixed.** The template's block: `electron`, `esbuild`, `electron-winstaller`, with its comment. Found by the `npm audit` pass that took Electron to 41.10.7 (GHSA-9f4c-93c8-jc8g) and cleared the dev tree. |
| `SECURITY.md` with a trust-boundary table                       | §7                   | None.                                                                                                                       | **Fixed.** Eleven surfaces, what is deliberately not guarded, two known gaps.                                                                                                                                |
| `appId`, `productName`, `AppUserModelID`, NSIS and portable     | §6                   | Present and correct.                                                                                                        | Unchanged.                                                                                                                                                                                                   |
| Electron fuses                                                  | HTOO-374             | No block.                                                                                                                   | **Deferred.** The card says the template's row is fixed first; Midir takes balor's two-layer shape when it lands there. Named in `SECURITY.md` as a known gap.                                               |
| The update check                                                | HTOO-65              | None. The repository is public, so the check would work.                                                                    | **Deferred** to WP27 (the first release), which is when a version to check against exists. Named in `SECURITY.md`.                                                                                           |
| Filename case on Linux                                          | HTOO-287             | Not audited.                                                                                                                | **Audited, n/a.** Midir opens one game file by name, `legend.dat`, for the item icons, through `dalib-ts`; capture needs Npcap, so Linux is a build target with the addon's stub, not a play platform.       |
| asar integrity, the version manifest, the portable stub flash   | HTOO-381, -382, -466 | —                                                                                                                           | Backlog or n/a on their cards; nothing owed here.                                                                                                                                                            |

## Decisions

1. **Acquire the single-instance lock first.** Call `app.requestSingleInstanceLock()` before
   `app.whenReady()`. If the lock is not held, the second instance quits at once.
2. **The first instance takes the focus.** On `second-instance`, restore and focus the existing main
   window (un-minimise if needed), so a second launch surfaces the running app instead of doing
   nothing.
3. **The lock guards the store, not just the taskbar.** State the durability reason in the code, so a
   later change does not remove the lock as "just cosmetic".
4. **Audit against the skeleton, do not invent.** The standard is the document repo's
   `electron-app-skeleton.md` and the template. Adopt what it lists; do not add integrations it does
   not. Every module here is the template's file, copied and renamed, so the house has one copy to
   keep in agreement.
5. **The icon set is the standard's.** Two masters in `build/`, the generator, the three runtime
   assets cut from the Windows master with the recipe beside each use. `resources/midir.png` is
   gone; the master never ships.

## Non-goals (stop-lines)

- **No jump lists, no recent-file lists, no taskbar progress.** Midir is one window and one record;
  these add surface without a use.
- **No OS protocol or deep-link registration.** `midir-icon://` is an internal privileged scheme, not
  an OS-registered protocol, and it stays internal.
- **No auto-launch at login.** Midir runs when the user starts it, before the game (settled decision
  6); a login launcher is a different decision.
- **No multi-window app.** The single-instance lock enforces one window on purpose.
- **No automatic CI trigger.** The house decided manual (HTOO-390) after one day of doubled runs
  exhausted the allowance; the pre-push hook is the gate that always runs.

## Acceptance criteria

1. A second launch of Midir quits itself and focuses the first instance's window.
2. Only one instance ever writes the store.
3. The taskbar shows the Midir icon and the Midir name, in a dev run and a packaged run.
4. Every item in the skeleton standard is present, fixed, or recorded here as a deliberate non-goal.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`, then
   `npm run verify:preload` and `npm run e2e`: 1214 unit tests, the built preload's one
   specifier, eight e2e specs including the nav walk and the rogue window.
2. GUI (hand to Sabrael): launch Midir twice and confirm the second launch focuses the first window
   and does not start a second process (`npm run build && npx electron .` twice is the dev
   recipe; the lock is keyed on `userData`, which dev and packaged share). Check the taskbar icon
   and name, the icon left of the title, and no white flash on close. `MIDIR_DISABLE_GPU=1` is
   how the remote path is tried without a Remote Desktop session.
