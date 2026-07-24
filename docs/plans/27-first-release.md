# WP27 — cut the first release

**Size:** M. **Depends on:** the quality gate, and WP28. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** handing Midir to somebody who is not Sabrael.

## Goal

Cut the first release. `package.json` is `0.1.0`, the changelog holds one `[Unreleased]` section, and
`release.yml` came from the template unexercised. The build is Windows-only and unsigned. This WP
turns that into a versioned, downloadable build.

## Decisions

1. **Exercise the template's `release.yml`.** It came from the house skeleton and has never run.
   Confirm it produces the portable Windows build, then tag against it.
2. **Fill the changelog.** Move the `[Unreleased]` section into a versioned entry. State what the
   release does and what it does not (Windows-only, unsigned, retail-only).
3. **State the credential caveats in the release notes.** A recording is not free of credentials
   without the known limits (the bare `tcp` filter, the HTTP dialog). A first release says so plainly.
4. **Windows-only and unsigned, and say so.** Signing is a separate decision with its own cost; this
   release does not block on it, but it names the gap.
5. **Gate on quality.** The full gate (`typecheck`, `lint`, `test`, `build`) is green, and the GUI
   checks handed to Sabrael for the shipped features have passed.
6. **App standards are in place first (WP28).** The single-instance lock, the taskbar identity, and
   the icon are correct before a build goes to anyone. A release with two instances writing one store
   is not shippable.

## Non-goals (stop-lines)

- **No code signing** in this WP. It is named as a gap, not closed.
- **No auto-update.** A first release is a download, not a channel.
- **No non-Windows build.** Retail is Windows; the addon is Windows-only with a stub elsewhere.

## Current state when you start

- `package.json` at `0.1.0`; the changelog's single `[Unreleased]` section.
- `release.yml` — from the template, unexercised.
- `npm run build:win:portable` — the packaged portable Windows build.

## Acceptance criteria

1. `release.yml` produces the portable Windows build from a tag.
2. The changelog names the release and its limits.
3. The release notes state the credential caveats.
4. The full gate is green before the tag.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. `npm run build:win:portable` produces a runnable portable build.
3. GUI (hand to Sabrael): install the portable build on a clean machine and confirm it launches.
