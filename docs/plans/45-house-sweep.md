# WP45 — Windows only, Electron 44, and the house rows of 2026-10-11

**Size:** M. **Depends on:** WP28 (the first standards pass) and WP44 (the update check). Read `00-overview.md` first. **IN PR** on `chore/house-sweep-2026-10`. **Card:** the Midir row of every house Electron card named below. This is a record of what the branch did, as WP28 is, not a plan written first.

## Goal

On 2026-10-11 Epona merged nine PRs that closed its rows on the house Electron cards, and the template took the same changes. Midir's row was the other one that held most of those cards open. This WP closes Midir's rows: each card is present, fixed here, not applicable with a reason, or waiting on a named trigger.

## Windows only

The house macOS standard (the document repo's `docs/architecture/macos-chrome.md`) asks every app for a native title bar, an application menu, ⌘-only shortcuts and the launch-env modules. **Midir takes none of it, because the Dark Ages client runs on Windows only** (Sabrael, 2026-10-11). Midir reads that client's traffic through Npcap and drives its window with posted input, so a macOS or Linux build has nothing to read and nothing to drive.

So the branch makes the build Windows-only rather than leaving the template's other platforms in place. The mac, dmg, linux and appImage blocks, the `build:mac` and `build:linux` scripts, `desktopName`, the release jobs for both platforms, and the macOS tile, the Linux icon set and their generator are removed. `scripts/icons.test.mjs` pins the absence, because every port from the template brings them back. The Linux unit-test job in `ci.yml` stays: the suite is platform-neutral.

That decision answers several cards at once. HTOO-512 (git from the Dock) was already not applicable, because Midir runs no git. HTOO-543 (e2e on Linux and macOS against the real settings) and HTOO-287 (Dark Ages file-name case on Linux) are not applicable, because Midir does not run there. **WP28's HTOO-287 row was wrong in its reasoning**: it said Midir opens one game file, `legend.dat`, by its exact case. Midir opens about seven, all by lowercase names (`legend.dat`, `setoa.dat`, `khanpal.dat`, the `khan*` pairs, `ia.dat`, `maps/lod*.map`), and a stock install writes `Legend.dat`. On NTFS that is the same file; on ext4 it is not. The right answer is "Windows only", not "exact case".

## The rows, 2026-10-11

| Item | Card | Before | Now |
| --- | --- | --- | --- |
| Electron 41 is end-of-life | HTOO-553 | `electron ^41.1.0`; `postinstall` without `install-electron`; `tsc --build`. | **Fixed.** `^44.7.0`, `install-electron && electron-builder install-app-deps` (da-pcap rebuilds for ABI 149), `tsc --build --force`, the splash `flex-shrink` rider, the three TypeScript server settings, `.nvmrc` 24. |
| Electron 43: a picker opens in Downloads | HTOO-553 | The Dark Ages folder picker had no start folder; the board export gave a bare file name. | **Fixed.** `main/pickerStart.ts` (taliesin's, with the parent window first) wraps the dialog once in `index.ts`: the last pick, then the Dark Ages folder in memory, then Documents, then home. |
| Electron 44: the main-process clipboard is a Promise | HTOO-553 | `writeClipboard` was `void`, so the issue page opened before the copy finished. | **Fixed.** `copyToClipboard` awaits the write, bounded at 3 s; `OpenIssueResult.copied`; a failed copy still opens the page and no message promises a clipboard. A test holds the write open. |
| `npm audit` | HTOO-553 | 10 findings (2 high), all build-time. | **Fixed. 0.** `electron-builder ^26.17.0`, the scoped `global-agent@3` override the template carries, and `npm update` for `source-map-js` and `http-cache-semantics`. |
| npm 12 install-script approvals | HTOO-542 | `electron` approved, `electron-winstaller` approved, no `fsevents`. | **Fixed.** By name: `esbuild` yes, `electron-winstaller` no (NSIS and portable, no Squirrel), `fsevents` yes, `electron` gone (no script since 42). `npm install-scripts ls` is clean. The hook half is n/a: Midir removed its pre-push hook in `f220b3d`. |
| Fuses, read back from the package | HTOO-374 | No `electronFuses` block. | **Fixed.** The template's block and `verify-fuses.mjs`; the release job reads `midir.exe` before signing. Checked on a `--dir` package: the reader passes; stock `electron.exe` fails all five; the app starts and loads the asar-unpacked da-pcap addon. |
| Embedded asar integrity | HTOO-381 | Off. | **Fixed.** On. One changed byte in `app.asar` exits 1 with `ASAR Integrity Violation`. The README and the CHANGELOG header now say to start the packaged build before a tag. |
| Release signing on a current JDK | HTOO-517 | `sslcom/esigner-codesign` on its bundled JDK 11, which fails since 2026-09-30; `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`. | **Fixed.** `release.yml` is the template's without the macOS and Linux jobs: Temurin 17, the pinned CodeSignTool jar, each signature read back as `Valid`, Node 24 actions, `release-signing.test.mjs`. **The job now builds and signs both targets the config declares**, the NSIS installer and the portable exe; it built the portable exe only. A tag run is still owed. |
| CI checkout depth | HTOO-328 | A note in `ci.yml` that said "Same note in release.yml", and `release.yml` had none. | **Fixed.** A CHECKOUT DEPTH block heads both workflows, with a pointer at every checkout. |
| The version-manifest reminder | HTOO-382 | No reminder step. | **Fixed** (the step). The row turns done when the first release (WP27) runs `publish:version`. |
| `publish-version` test with a fake git | HTOO-516 | Real git, 16 s, and a 5 s timeout that failed under load. | **Fixed.** The template's two files; the file runs in about 2 s. Red probe: with `pull --ff-only` removed, two cases fail. |
| Nav spec and the Node-global source check | HTOO-393 | WP28 marked this done, but `rendererNodeGlobals.test.ts` did not exist although the spec cited it, and the spec's hand-kept list missed the World tab. | **Fixed.** The source check is ported; the spec reads `VIEWS` from `NavBar.tsx`, waits 250 ms per page and fails on a `pageerror`. Red probes for both. `e2e/README.md` gains "What automation cannot reach". |
| Remote Desktop in the README | HTOO-325 | The code was in; the README never named `MIDIR_DISABLE_GPU`. | **Fixed.** The template's section, worded for Midir. A check on a real RDP session is still owed by hand, as for every app. |
| `.gitattributes` | HTOO-236 | No `*.webp`; a test file held a literal NUL, so git read it as binary. | **Fixed.** The template's binary list; the NUL is written as an escape. `format:check` is a script and part of `validate`. |
| The canonical house palette | HTOO-572, HTOO-355 | The pre-572 values in five themes and an unscoped chip fill. | **Separate branch**, `feat/house-palette`, because it touches only the renderer's themes. |
| macOS title bar, menu, ⌘ keys, launch-env | `macos-chrome.md`, HTOO-512 | Template defaults on a build that cannot run. | **Not applicable: Windows only.** |
| e2e on Linux and macOS isolated from real settings | HTOO-543 | Windows-only `LOCALAPPDATA` line. | **Not applicable: Windows only.** The e2e job runs on Windows, where `LOCALAPPDATA` is the redirect. |
| Dark Ages file-name case on Linux | HTOO-287 | WP28: "n/a, exact case" (wrong; see above). | **Not applicable: Windows only.** |

Already done and unchanged: HTOO-54, HTOO-65, HTOO-341, HTOO-351, HTOO-467, HTOO-494 (WP28 and PR #49), and HTOO-399 and HTOO-466 are `n/a`. Two optional findings stay open on purpose: HTOO-467's dev-server URL hardening (balor#62 shape) and HTOO-494's required `fs` argument.

## CLAUDE.md

The root `CLAUDE.md` was 52,006 characters, over Claude Code's 40,000 limit (HTOO-525). The decoding notes (about 28,000) moved to `src/main/CLAUDE.md`, which Claude Code loads when work enters `src/main/`. The card's worry was that they are cited from `model/`, `route/`, `store/` and the Laborer, not only from `protocol/`; all of those are under `src/main/`, so that file is loaded for the right half of the work. The root keeps the heading and a pointer, and is about 26,000 characters with this branch's three new rules.

## Verified

On Windows: `npm run validate` (lint, format, `typecheck --force`, 1844 unit tests), `npm run build`, `verify:preload` (one specifier, `electron`), e2e 11 of 11, and the packaged checks above. **Owed by hand:** a tag run of `release.yml` with the `ES_*` secrets (HTOO-517), and the first release itself (WP27).
