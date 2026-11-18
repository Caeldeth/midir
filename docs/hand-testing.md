# Hand testing

These are the checks by hand that the automated gate cannot do. `npm run dev` needs a real window, and live capture needs Npcap, an adapter and a real game session, so no agent and no CI job can do them. Midir runs on Windows only, so every check here is a Windows check.

Tick each item when it is done. Write the build, the tester and the date beside it. When a check fails, file the fault on the tracker card that the check names, and do not tick the item.

Run `unset ELECTRON_RUN_AS_NODE` (or `Remove-Item Env:ELECTRON_RUN_AS_NODE` in PowerShell) in each shell that runs Midir, the e2e suite or a packaged build. After each `git checkout`, run `npm install`: a branch that changes the lockfile otherwise leaves stale `node_modules`, and the postinstall rebuilds the da-pcap addon for the Electron in use.

## The automated gate

The gate is green on Windows at `64a4a7f` (2026-11-18): `npm run validate` (2554 passed, 6 skipped), `test:coverage`, `build`, `verify:preload` (one specifier, `electron`) and `npm run e2e` (12 passed).

These are covered on each run, so they need no pass by hand:

- Every page opens (`e2e/nav-pages.spec.js`).
- A replayed session fills the character list, the sheet, the bank card, the item index and the Diagnostics cards (`e2e/replay-surface.spec.js`).
- A theme change survives a restart (`e2e/settings-persistence.spec.js`).
- Every theme gallery sample is measured for contrast (`e2e/theme-gallery.spec.js`).
- A settings save or a probe that names a folder nobody picked is refused (`folderGrants.test.ts`, `handlers.test.ts`, `icons.test.ts`).
- Another app's portable variables do not start the sweep, and Midir removes them from its own environment (`portableSweep.test.ts`, `bootOrder.test.ts`).
- The release workflow pins every action, gives write access to the release job only, keeps no checkout credentials, and checks the CodeSignTool digest (`scripts/workflow-policy.test.mjs`).

## The November house round (PR #58)

PR #58 moved Midir to Electron 45, vite 8, electron-vite 6, Vitest 5 and jsdom 31 (HTOO-694). It also made the Dark Ages folder a grant that main owns, and it stopped Midir from trusting another app's portable variables (HTOO-667).

Already done:

- [x] A packaged `--dir` build verifies its fuses. With Balor's three portable variables set, it ran 40 s with its window, its log had no portable line and no error, and capture loaded the addon on Electron 45. (`64a4a7f`, Fintan, 2026-11-18)

### Development build

- [ ] **The window opens (HTOO-694).** Run `npm run dev`. The splash closes, the main window opens, and no white window shows. The DevTools console has no preload error and no sandbox error. The gate cannot see these errors.
- [ ] **A change shows without a restart (HTOO-694).** With `npm run dev` running, change a text in a renderer file and save it. The window shows the change.

### The Dark Ages folder

- [ ] **A picked folder works.** In Settings, click **Choose folder** and pick the Dark Ages folder. The folder dialog opens in that folder if one is set already. The card says "Icons are on." The Items page shows the item icons. The session log has no "Refused a Dark Ages folder" line.
- [ ] **The folder stays after a restart.** Close Midir and start it again. The icons are on with no new pick.
- [ ] **Clear works.** Click **Clear**. The card says "Icons are off. No folder is chosen." Pick the folder again, and the icons come back.
- [ ] **A hand edit of the settings file is trusted.** Close Midir. In `%LOCALAPPDATA%\Erisco\Midir\settings.json`, set `darkAgesPath` to a different folder that holds `legend.dat`, or to the same folder with different letter case. Start Midir. The icons come from that folder, and the log has no refusal line.

### Live capture

These need Npcap, an adapter and a real game session.

- [ ] **Capture reads a login (HTOO-694).** Start capture, then log in. The title bar names the character, and the character sheet fills.
- [ ] **The game files read from the granted folder.** With a character logged in, the Map page draws the current map, and the doll on the Equip card draws the character.
- [ ] **The Walker takes typed fields (HTOO-694).** On the Walker page, type a destination and an end tile, and pin it under a new name. The pin shows the name, and a click on it fills the fields again.

### The portable build

- [ ] **The portable exe starts (HTOO-667).** Run `npm run build:win:portable`, then start the portable exe from Explorer. The window opens, and no NSIS box asks to close Midir.
- [ ] **Midir's own portable launch still sweeps (HTOO-667, HTOO-494).** The sweep now runs only when the launcher's variables name Midir. In Task Manager, end the portable exe's process tree. This leaves its `%TEMP%\ns*.tmp` folder. Wait ten minutes, then start the portable exe again. After 30 s, the session log has a `portable-sweep` line that says it removed one unpack folder, and the old `ns*.tmp` folder is gone. A sweep that did not run writes no line at all, so the line is the proof.

## Carried from WP45 (owed since 2026-10-11)

- [ ] **A fresh clone runs.** Clone the repository to a new folder, then run `npm install` and `npm run dev`. The window opens.
- [ ] **The export picker start folder (HTOO-553).** Export a board. The save dialog opens in the last folder picked this session, or else in the Dark Ages folder.
- [ ] **Every theme by eye (HTOO-572).** In each of the eight themes, open Settings → Appearance → Theme gallery and each page. Text, chips, buttons and alerts read on their backgrounds, and a selected chip looks different from a plain one.

## The first release (HTOO-76)

- [ ] **The pinned workflow runs (HTOO-692).** The first tag runs `release.yml`. "Fetch and verify CodeSignTool" passes the digest check, the sign step reads both signatures back as `Valid`, and the release job publishes the release.
- [ ] **The released files start.** Download the setup exe and the portable exe from the release, and start each one. Each opens its window. A changed app archive exits with no window, so this check is the proof that the package is intact.
- [ ] **The version manifest is published (HTOO-382).** After the release, run `npm run publish:version`. The update check of the next build finds the release.
