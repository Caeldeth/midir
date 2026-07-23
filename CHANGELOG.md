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
- An Items view: every item across every character, searchable by name. Each row gives the total, the characters that hold it, the slot each one is in, and how long ago that character was last read.
- Session recording, for working out a packet Midir does not understand yet. A recording holds everything the client and the server exchanged, including your character name, so treat the file as private.

### Security

- A session recording no longer holds your account password. Midir removes the login packet before it writes the file. Delete any recording made by an earlier build: the password in it can be recovered.

### Fixed

- The pre-login placeholder is no longer saved as a character. The connections before the world server are keyed from a stand-in name such as `socket[295]`; it is a real encryption seed but nobody at all. A placeholder saved by an earlier build is removed the next time Midir loads.
