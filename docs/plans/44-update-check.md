# WP44 — the house update check

**Size:** S. **Depends on:** WP28 (the house Electron standard, and `appIdentity.ts`). Read
`00-overview.md` first. **PLANNED.** **Card:** `HTOO-495`.
**Trigger to start:** none. Sabrael queued this with `HTOO-382` on 2026-09-28. The manifest is already live (cernunnos `a774b9a`), and nothing ahead of Midir in the rollout gates the read side: a key with no entry is the answer this WP has to handle anyway.

## Goal

Adopt the house update-check module, so Midir tells the player when a newer version exists.

It is a **port, not a design**. The design is settled in the document repo's
`docs/architecture/update-check-module.md`, and the template holds the reference copy (`21a147f`).
Midir copies five files and wires them, exactly as it took the Report Issue module in WP26.

## Decisions

1. **The module as it stands, not a variant.** Five files, each carrying the header
   `// house module: update-check v1 — change it in the template, then port`. A change belongs in the
   template first. Eleven apps with eleven notions of "newer" is the fault this module exists to end:
   four apps grew their own checker before anyone put one in the template.
2. **It reads the manifest, never the releases API.** One keyed `versions.json` on cernunnos `main`,
   over `raw.githubusercontent.com` (design §2, §3). Midir is public, so a releases-API read would
   work — and that is exactly how the house ends up with two mechanisms again. The manifest also
   means a private app can use the same module.
3. **Midir has no entry until its first release**, and that is a working state, not a failure: a key
   with no entry answers `no-entry` and the notice never shows. So this WP can land before WP27, and
   WP27's release then adds one step — `npm run publish:version` — rather than a feature.
4. **It notifies. It does not install.** There is no update channel and no code path that writes over
   the installation. The download link is the GitHub release page (design §9.8).
5. **The check runs once, ten seconds after start, and from a Check for updates button** on the
   Settings About card (design §9.5). No timed re-check, no metered-connection detection: one small
   GET per launch is not what makes a metered connection expensive.
6. **Closing the notice hides that version for good** (design §9.6). Both of the MUI faults the house
   found stay fixed in the copy: a click away does not close the notice, and the close button is ours
   inside `action` rather than one MUI decides whether to render. Their tests come with the files and
   fail without the fixes.
7. **`README.md` and the security posture get the edit this feature owes.** This is Midir's **first
   outbound request**. Every adopter has owed this edit and taliesin's row is where the house learned
   it: the documents that say what leaves the machine stop being true the moment the check ships. One
   HTTPS GET per launch, no user data, no identifier beyond a User-Agent, nothing downloaded.

## Non-goals (stop-lines)

- **No auto-update, and no `electron-updater`.** Noticing a release and installing one are different
  claims, and only the first is in scope.
- **No second version rule.** `isNewerVersion` comes with the module.
- **No change to the module while porting.** A fault found here is fixed in the template and ported
  back, so the other ten apps get it.

## Current state when you start

- `src/shared/appIdentity.ts` — the one per-app file WP26 established; `updateKey` and `releaseUrlPrefix` belong beside the Report Issue fields. The template holds both field names and their comments.
- `src/main/handlers/index.ts` — `registerHandlers`, where the handler is wired, behind the sender
  guard every channel inherits.
- `src/preload/index.ts` and `src/shared/types.ts` — the bridge and the API type.
- `src/renderer/src/components/AboutCard.tsx` — where the button goes.
- `src/renderer/src/App.tsx` — where the notice mounts.
- `package.json` — where `publish:version` is defined. Midir has **no release document**: the template documents the step in its `README.md`, and WP27 decides whether Midir needs a page of its own.

## Acceptance criteria

1. The five files are in, each with the module's version header, and their tests pass unchanged.
2. `updateKey` and `releaseUrlPrefix` are in `appIdentity.ts`, and nothing else in Midir names them.
3. A manifest entry newer than the running version shows the notice; the same version shows nothing;
   a key with no entry answers `no-entry` and shows nothing.
4. Closing the notice hides that version, and a click away does not close it.
5. The Check for updates button on the About card answers, including when there is nothing to show.
6. `README.md` states the one outbound request, and the credential caveats it already carries are
   untouched.
7. The full gate is green, and the preload sandbox check still passes.

## Verification

1. The module's own tests, ported with the files.
2. A run against the live `versions.json` with Midir's key absent, which is the real state until WP27. Checked on 2026-09-28: the file answers 200 and holds seven keys (balor, creidhne, dagda, epona, mabon, oghma, taliesin), with no `midir`. The check answers `no-entry` and the UI is unchanged.
3. A run with a pretend older version, which is how the template proved it: 1.5.0 offered 1.6.0.
