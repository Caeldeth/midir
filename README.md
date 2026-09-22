# Midir

Midir is a companion app for retail Dark Ages. It reads the game client's network traffic, decodes it, and keeps a record of each character that you log in on. The record stays on your computer.

Midir does for Dark Ages what Altoholic does for World of Warcraft. It answers the question "which of my characters holds that item?", and it answers it while the character is offline.

Midir also drives the client for you. It walks your character to a place that you name, it speaks lines for you, and it works an NPC errand. Each of these features is off until you turn it on.

## What Midir shows you

- **Live** — the character that is logged in now: statistics, health and mana, equipment, inventory, appearance, legend marks, gold, title, and guild. The sheet fills as the packets arrive.
- **Characters** — each character that you log in on, and the time Midir last read it.
- **Items** — each item across all of your characters, searchable by name. A row gives the total, and names each character that holds it. Point at a name to see the slot, the durability, and the time Midir last read that character. The bank is included.
- **Boards** — the posts from the town boards and from your mailbox, kept for you to read again. Midir can also read a board for you: it opens the board through the game's own pane, and it reads each post to the oldest one. It writes nothing and it posts nothing.
- **Map** — the map that your character stands on, drawn as a grid from the game's own map cache. The grid shows the blocked tiles, the warps, each live character, and the route that the Walker planned. You can also correct a warp here.
- **Diagnostics** — Midir's own log, and your session recordings. You can filter the log, copy it into a report, and delete a recording.

## What Midir does for you

Each of these features is off until you turn it on. One stop control halts all of them.

- **Walker** — name a place, and Midir walks your character there across maps. Midir reads each step from the network. It plans again when a step does not land, and it stops when something else moves your character.
- **Speaker** — Midir says your lines in one game window, on an interval that you set.
- **Errands** — Midir walks to an NPC, then works the dialog. It reads the conversation from the network, and it selects each option by the words of that option. It stops at a dialog that it does not expect.

The Walker and the Speaker replace DA Walker and DA Speaker. These two community tools read the game's memory. Midir reads the network instead.

## What Midir learns while you play

- **The way between maps.** Your character walks through a warp, and Midir learns that warp from the wire. After two crossings, Midir plans routes through it.
- **A correction that you make.** The Map tab shows each warp that Midir knows, and where the warp came from. You can accept a warp, refuse it, move it to the correct tile, or add one. Your correction has more authority than the map data that Midir imported.
- **A place that Midir cannot reach.** The Walker makes such a place dim, and the Go button stays off. Walk that warp one time by hand, or add the warp on the Map tab.
- **The name of each map.** Midir learns the game's own name for a map on your first visit there. Until then it uses the names in its own data files.
- **The bank, the legend, and the boards.** The game sends these only when you open them. Midir keeps what it reads, and always gives the time that it read them.

## Your Dark Ages files

This step is optional. In Settings, under **Legacy data files**, select your Dark Ages folder. Midir then draws the icon of each item, and a picture of your character in its equipment. Midir reads these files only. It never changes them. With no folder selected, each view works as before.

## How Midir works with the client

Midir reads from the network, and acts through the game's own window.

- **It reads passively.** Capture is with Npcap, the same driver that Wireshark uses. Midir does not read the game's memory, and it does not need to. The map, your position, your items, and your bank are all on the wire.
- **It acts as you do.** The assistant features send keys and clicks to the game window. The client examines each action, and nothing occurs that you cannot do by hand.
- **It never changes the game client, its memory, or its files.** There is no injected library and no patch.
- **Each assistant feature is off until you turn it on**, and one stop halts all of them.
- **Midir never types your password.** No feature operates a login dialog or a password field.

Automation of a game is against the terms of service of most operators. You turn on an assistant feature at your own risk.

## Requirements

- Windows 10 or later.
- Retail Dark Ages, client version 7.41.
- [Npcap](https://npcap.com/), installed in **WinPcap API-compatible mode**.

If you install Npcap with the option "Restrict Npcap driver's access to Administrators only", you must run Midir as an administrator. Midir shows this instruction if it cannot open the adapter.

## Start Midir before you log in

Midir learns the encryption keys from the login handshake. If you start Midir in the middle of a game session, it cannot read that session. Start Midir first, then start Dark Ages.

## Commands

| Script                        | What it does                                                       |
| ----------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                 | Launch with HMR                                                    |
| `npm run typecheck`           | `tsc --build` (node and web projects)                              |
| `npm run lint` / `lint:check` | ESLint (flat config), with and without `--fix`                     |
| `npm test` / `test:coverage`  | Vitest (node and jsdom projects)                                   |
| `npm run e2e` / `e2e:only`    | Playwright E2E on the built app (with and without a rebuild first) |
| `npm run build:win`           | Package Windows nsis and portable                                  |
| `npm run build:win:portable`  | Portable exe only                                                  |
| `npm run build:unpack`        | Unpacked build for local smoke tests                               |

Run this gate green before you commit: `npm run typecheck && npm run lint:check && npm test && npm run build`.

## Releasing

Release notes are written in **`CHANGELOG.md`**. Do not edit the GitHub release after it is published.

1. As PRs land, add the user-facing change under `## [Unreleased]` (Keep a Changelog format).
2. To cut a release, promote `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `[Unreleased]` above it, and bump the version with `npm version X.Y.Z --no-git-tag-version`.
3. Tag `vX.Y.Z` and push. `release.yml` builds and signs the artifacts. Then `scripts/changelog-extract.mjs` pulls that version's section into the release body, and `generate_release_notes` appends the automatic PR list below it.

A missing section falls back to the automatic notes, so a forgotten entry never fails the release.

## Troubleshooting

If `npm run dev` builds but the main process stops with `Cannot read properties of undefined (reading 'isPackaged')`, or no window opens, look for a leaked `ELECTRON_RUN_AS_NODE=1` in your shell. Some Electron-hosted terminals set it, which makes Electron run as plain Node. Clear it and try again:

```powershell
Remove-Item Env:ELECTRON_RUN_AS_NODE; npm run dev
```

```bash
unset ELECTRON_RUN_AS_NODE && npm run dev
```
