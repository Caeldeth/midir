# Midir

Midir is a companion app for retail Dark Ages. It watches the game client's network traffic, decodes it, and keeps a record of every character that you log in on.

Two views come out of that record:

- **Items** — a searchable index of the items in your inventories and banks, with the count of each item and the character that holds it.
- **Characters** — the details of each character: statistics, equipped items, visible appearance, legend marks, gold, class, title, and guild.

Think of Altoholic for World of Warcraft, for Dark Ages.

## Read-only by design

Midir listens. It does not speak.

- It never sends a packet and never connects to the game server.
- It never modifies the game client, its memory, or its files.
- It captures with Npcap, the same driver that Wireshark uses.

## Requirements

- Windows 10 or later.
- Retail Dark Ages, client version 7.41.
- [Npcap](https://npcap.com/), installed in **WinPcap API-compatible mode**.

If you install Npcap with the option "Restrict Npcap driver's access to Administrators only", you must run Midir as an administrator. Midir shows this instruction if it cannot open the adapter.

## Start Midir before you log in

Midir learns the encryption keys from the login handshake. If you start Midir in the middle of a game session, it cannot read that session. Start Midir first, then start Dark Ages.

## Commands

| Script | What it does |
| --- | --- |
| `npm run dev` | Launch with HMR |
| `npm run typecheck` | `tsc --build` (node and web projects) |
| `npm run lint` / `lint:check` | ESLint (flat config), with and without `--fix` |
| `npm test` / `test:coverage` | Vitest (node and jsdom projects) |
| `npm run e2e` / `e2e:only` | Playwright E2E on the built app (with and without a rebuild first) |
| `npm run build:win` | Package Windows nsis and portable |
| `npm run build:win:portable` | Portable exe only |
| `npm run build:unpack` | Unpacked build for local smoke tests |

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
