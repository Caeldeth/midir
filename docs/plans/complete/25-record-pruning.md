# WP25 — character record pruning, and "hide unseen"

**Size:** S. **Depends on:** WP4. Read `00-overview.md` first. **COMPLETE 2026-09-22.** **Card:**
`HTOO-74`.
**Trigger to start:** a character list long enough to be annoying, or a request to hide characters
not seen since a date. Sabrael, 2026-09-22: the low items, all of them.

**What shipped:** `shared/unseen.ts` (`splitUnseen`, `newestSeenMs`, the day choices), the
`hideUnseenDays` setting through the type, the manager, the Zod schema, and the store, and the
control on the Characters list itself with a "N hidden, still on file" line under the list. The
threshold counts back from the **newest sighting in the record**, not the wall clock: the wall
clock would hide every character after a month with Midir off, and everyone but one during a
replay of an old evening. A selection the filter hides falls back to the newest listed character.
Nothing touches the file; Forget is unchanged. Found on the way: the settings store built its
save payload by destructuring fourteen names, so the fifteenth field would have saved as nothing
(the template's HTOO-235); `shared/settings.ts` derives the payload from `DEFAULT_SETTINGS` and
`settingsPayload.test.ts` pins its keys to the schema's.

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
   when it changes. (`Characters.test.tsx`.)
2. The threshold reads capture time: the newest `lastSeenMs` less the days. (`unseen.test.ts`.)
3. A hidden character is never removed from the file.
4. The explicit "Forget" still deletes, exactly as today.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the filter against a record set with known last-seen times, and the setting round-trip
   through the store schema.
