# Changelog

All notable user-facing changes to Midir are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning is
[Semantic Versioning](https://semver.org/).

<!--
Release process (the notes are authored HERE, not edited on GitHub after the fact):
  1. As you land a PR, add its user-facing change under ## [Unreleased]
     (Added / Changed / Fixed / Removed / Deprecated / Security).
  2. To cut a release: rename ## [Unreleased] to ## [X.Y.Z] - YYYY-MM-DD, add a
     fresh empty ## [Unreleased] above it, and bump package.json to X.Y.Z
     (npm version X.Y.Z --no-git-tag-version).
  3. Tag vX.Y.Z and push. The release workflow runs scripts/changelog-extract.mjs
     to pull THIS version's section into the GitHub release body, then appends the
     auto-generated PR list below it.
Keep entries user-facing — internal refactors/tests show up in the appended auto list.
-->

## [Unreleased]

### Added

- Passive packet capture through Npcap. Midir reads the game client's own TCP connections and never sends a packet, never connects to the game server, and never changes the client.
- A live character sheet: statistics, health and mana, equipped items, inventory, visible appearance, legend marks, gold, title, and guild. It fills as the packets arrive.
- A character list. Every character you log in on is recorded and kept, with the time it was last seen.
- A capture indicator in the title bar. It says whether Midir is stopped, listening, or reading a named character.
- A clear warning when Midir starts after you log in. Midir learns each session's keys from the login handshake, so it has to be running first.
- Settings for the network adapter, for starting capture when Midir opens, and for the theme.
- An Items view: every item across every character, searchable by name. Each row gives the total and names each character that holds it once, whatever the number of slots. Hover a name for the slot, the durability, and how long ago that character was last read.
- Session recording, for working out a packet Midir does not understand yet. A recording holds everything the client and the server exchanged, including your character name, so treat the file as private.
- A Diagnostics view. It reads Midir's own log, which you can filter by level or by text and copy into a bug report, and it lists your session recordings with their size and start time.
- A log file under `%LOCALAPPDATA%\Erisco\Midir\logs`. Midir writes one file each time it opens and keeps the last ten. An installed build has no console, so this is how a failure can be reported at all. A failure in the window is written there too, and no longer leaves a blank screen.
- Bank contents. Retail has no bank packet, so Midir reads the bank from the NPC dialog when you visit a banker and choose “Withdraw Item”. What it held then appears on the character sheet and in the Items view, always with the time it was read.
- A limit on the disk that recordings use. Midir deletes the oldest ones when a capture starts, and never the one it is writing. The limit is a setting; the default is 1024 MB and zero means no limit. You can also delete recordings one at a time, or all at once, in Diagnostics.

### Security

- A session recording no longer holds your account password. Midir removes every game packet that carries one before it writes the file: signing in, creating an account, and changing a password. A recording still holds your character name and that session's keys, so keep treating the file as private. Delete any recording made by an earlier build: the password in it can be recovered.

### Fixed

- The pre-login placeholder is no longer saved as a character. The connections before the world server are keyed from a stand-in name such as `socket[295]`; it is a real encryption seed but nobody at all. A placeholder saved by an earlier build is removed the next time Midir loads.
