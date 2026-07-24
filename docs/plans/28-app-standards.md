# WP28 — app standards audit and adoption

**Size:** S. **Depends on:** the house electron-app-skeleton standard. Read `00-overview.md` first.
**PLANNED.**
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

## Current state — what the audit already found

Present and correct:

- **`appId`** `co.eris.midir` (`electron-builder.yml`) and **`productName`** Midir.
- **`AppUserModelID`** set to the same id (`src/main/index.ts:281`), with a comment on why it must
  equal `appId`.
- **The window icon** (`src/main/index.ts:244`) and the **build icon** (`electron-builder.yml:3`,
  `resources/midir.png`).
- **The NSIS Windows target** (`electron-builder.yml`, `win` / `nsis`).

Missing or to verify:

- **No single-instance lock.** `src/main/index.ts` calls `app.whenReady()` directly; there is no
  `app.requestSingleInstanceLock()` and no `second-instance` handler. **This is the main gap.**
- **The icon format.** The build and window icon is a `.png`. Confirm Windows gets a crisp taskbar
  and installer icon; a 256-px `.ico` is the Windows standard if the `.png` is not enough.
- **Anything else the skeleton lists** that Midir does not have — walk the standard top to bottom and
  record each item as present, fixed, or a deliberate non-goal.

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
   not.
5. **Fix the icon format only if Windows needs it.** If the `.png` renders crisp at every size, keep
   it; if not, add a `.ico`. Verify, do not assume.

## Non-goals (stop-lines)

- **No jump lists, no recent-file lists, no taskbar progress.** Midir is one window and one record;
  these add surface without a use.
- **No OS protocol or deep-link registration.** `midir-icon://` is an internal privileged scheme, not
  an OS-registered protocol, and it stays internal.
- **No auto-launch at login.** Midir runs when the user starts it, before the game (settled decision
  6); a login launcher is a different decision.
- **No multi-window app.** The single-instance lock enforces one window on purpose.

## Current state when you start

- `src/main/index.ts:274` — `app.whenReady()`; the lock is acquired before this.
- `src/main/index.ts:281` — `setAppUserModelId`, already correct.
- `src/main/index.ts:300-307` — the `activate` handler, the pattern a `second-instance` focus follows.
- `electron-builder.yml` — `appId`, `productName`, `icon`, and the `win` / `nsis` targets.
- The document repo's `docs/architecture/electron-app-skeleton.md` — the standard to audit against.

## Acceptance criteria

1. A second launch of Midir quits itself and focuses the first instance's window.
2. Only one instance ever writes the store.
3. The taskbar shows the Midir icon and the Midir name, in a dev run and a packaged run.
4. Every item in the skeleton standard is present, fixed, or recorded here as a deliberate non-goal.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit-test the second-instance path where it is testable behind a seam; the lock itself is a
   process-level behaviour and goes to the GUI check.
3. GUI (hand to Sabrael): launch Midir twice and confirm the second launch focuses the first window
   and does not start a second process. Check the taskbar icon and name in a packaged build.
