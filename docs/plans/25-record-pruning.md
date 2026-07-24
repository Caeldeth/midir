# WP25 — character record pruning, and "hide unseen"

**Size:** S. **Depends on:** WP4. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a character list long enough to be annoying, or a request to hide characters
not seen since a date.

## Goal

Give the character record a retention policy. A character deleted on the server stays in the file
forever today. There is a delete handler (`recordings.ts` has the byte cap and delete paths; the
record has a per-character forget), but there is no policy that hides or prunes on its own.

## Decisions

1. **Hide before delete.** The first want is "hide characters not seen since", which is a filter over
   the list, not a deletion. Deletion stays the explicit "Forget" the user already has.
2. **The clock is capture time.** "Not seen since" reads `TrackedEvent.timestampMs`, the capture
   time, not the wall clock — the same rule the rest of the app runs on.
3. **Never lose data silently.** A hidden character is still in the file and comes back when the
   filter changes. Only the explicit "Forget" removes a record.
4. **The policy is a setting.** The "hide unseen" threshold lives with the settings, Zod-validated,
   like every other preference.

## Non-goals (stop-lines)

- **No automatic deletion.** Hiding is reversible; deletion stays a user action.
- **No server-side check.** Midir does not know a character was deleted on the server; it only knows
  it has not seen it. "Not seen" is the signal, not "deleted".

## Current state when you start

- `src/main/store/` — the record persistence and `characterSchema`; a new setting must be named in
  its schema or it is dropped on load.
- `src/main/recordings.ts` — the existing delete paths and the byte cap, for the pattern.
- The Characters page — where the "seen X ago" row and the hide filter live.

## Acceptance criteria

1. A "hide unseen since" filter hides characters not seen since the threshold, and shows them again
   when it changes.
2. The threshold reads capture time.
3. A hidden character is never removed from the file.
4. The explicit "Forget" still deletes, exactly as today.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the filter against a record set with known last-seen times, and the setting round-trip
   through the store schema.
