# Security policy

## What Midir is

Midir is a **local desktop companion for the retail Dark Ages client**. It runs on one machine, for
one player, beside the game. It captures the game client's network traffic through Npcap, decodes
the protocol, and keeps a record of the player's own characters. It has no server, no accounts,
no telemetry, and no network egress of its own: the only bytes Midir touches on the network are
the ones the game client already sends and receives, and Midir only reads them.

Midir also drives the game client, by posting keys and clicks to its window, when the player
starts an assistant. It sends no packet, injects nothing, reads no memory, and never automates a
credential dialog.

That shape decides what a vulnerability in Midir can be. There is no service to attack, no other
user's data to reach, and no session to hijack. What is left is the boundary between untrusted
input and the one process allowed to touch the disk, the network capture, and the game window,
and the record itself, which holds what a player's characters own.

## The trust boundary

The main process is the only code that touches the filesystem, the capture, and the game window.
Everything else asks it to.

| Surface                        | What guards it                                                                                                                                                                                                                                                                                                                      |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Renderer → main IPC            | Handlers accept an IPC only from Midir's own main window, at its own top frame, at a location we loaded (`src/main/windowSecurity.ts`, installed as a proxy over `ipcMain` at the one `registerHandlers` call site). Every payload is Zod-validated at its handler.                                                                 |
| Paths crossing IPC             | A renderer-supplied path is validated against the allowed roots before any filesystem access (`assertInsideDir` in `src/main/paths.ts`): a recording is deleted only from the recordings directory, a log is read only from the logs directory.                                                                                     |
| Item icons                     | Served by the privileged `midir-icon://` protocol from the game's own data files; the scheme carries no data the renderer could not do without, and the game directory is one the player chose in Settings.                                                                                                                         |
| Renderer process               | Runs in the OS sandbox (`sandbox: true`), with context isolation on and Node integration off. The preload imports `electron` and nothing else (`scripts/verify-preload-sandbox.mjs` reads the built file). The renderer reaches the disk only through the IPC row above.                                                            |
| Window navigation              | Windows cannot navigate away from Midir's own content, and no window may open another.                                                                                                                                                                                                                                              |
| Opening a link                 | `http`, `https`, and `mailto` only (`src/shared/externalUrl.ts`). A `file:`, `smb:`, or custom-scheme URL is refused rather than handed to the operating system.                                                                                                                                                                    |
| Content Security Policy        | On the response header and in each document's `<meta>`, the two pinned equal by a test; the splash grants no script source at all.                                                                                                                                                                                                  |
| The game protocol on the wire  | Read only, through Npcap. Every cipher input is on the wire in the clear or a constant, so Midir holds no key that the game does not already show. Nothing is sent.                                                                                                                                                                 |
| Session recordings on disk     | `src/main/capture/scrub.ts` drops every client frame whose opcode can carry a credential before a recording is written, and stops recording a connection's client direction after a TCP gap rather than resynchronise into a credential. Two limits are stated there and in `CLAUDE.md`: the bare `tcp` filter and the HTTP dialog. |
| The game window                | Driven by posted window messages only, through one action layer with a global stop hotkey and a stop on losing the window. No packet, no injected code, no memory read or write. The credential pane (dialog type 9) is never touched, and no assistant types into a login or password field.                                       |
| Settings and app state on disk | Zod-validated on load and save; written atomically (temp → rename) with a backup. A single-instance lock keeps a second Midir from writing the same files.                                                                                                                                                                          |

What is deliberately **not** guarded, and why: the Dark Ages directory the player names in
Settings is trusted by design, because reading the game's data files is the feature; and the
recordings a player replays are their own captures, read through the same decoders as a live
session and never executed.

## Reporting a vulnerability

Open an issue at **<https://github.com/Caeldeth/midir/issues>**. If a report would itself expose
something sensitive, say so in a short issue without the detail and ask for a private channel
rather than posting it.

Midir is distributed to a small group and has no formal SLA. Expect a look within a few days.

## Supported versions

The latest release only. Midir ships forward; there are no maintenance branches.

## Dependency and supply-chain posture

- **Production dependencies are audited in CI.** `npm audit --omit=dev --audit-level=high` runs in
  the `check` job of `ci.yml`, and it currently reports zero.
- **The dev tree is audited by hand**, not gated. Build-time tools do not ship inside the app, so
  an advisory in one is something to schedule rather than something that should block an
  unrelated change. Run a bare `npm audit` whenever you touch dependencies.
- **There is no Dependabot, and that is a decision rather than an oversight.** It was tried across
  these projects and produced noise instead of signal. Dependency and action bumps are made by
  hand, deliberately, when a deprecation or an advisory surfaces one.
- **Windows artifacts are Authenticode-signed** when signing credentials are configured; the step
  self-skips otherwise, so unsigned builds are possible and are what unofficial builds will be.
  **`app.asar` is packaging, not a security boundary**: anyone holding a build can read its
  contents.
- **The native addon** (`packages/da-pcap`) opens a capture handle through Npcap and reads the
  Windows TCP table and window list; it writes to no other process. It is built from source in
  the repository by `@electron/rebuild` at packaging time.

## Known gaps

- **Electron fuses are not yet set** (`runAsNode`, `--inspect`, `NODE_OPTIONS`, asar-only
  loading). Tracked house-wide as HTOO-374; Midir's row is owed.
- **No update check.** A release is found by the player, not announced by the app (HTOO-65).

## Out of scope

Findings that require an attacker to already control the machine, the user account, or the local
filesystem. At that point they have the game client and its data directly, and Midir is not the
weak link.
