# WP19 — the read-app polish pass

**Size:** M. **Depends on:** WP12. Read `00-overview.md` first. **PLANNED — build after WP12, before
WP13.**

## Goal

Give the read app its finish. This is the one polish pass for the "read" half of Midir (WP1–WP12):
a deliberate wording and terminology sweep, a small visual finish, and the long-list virtualization
that the backlog held. It lands after WP12 because WP12 is the last change to the read app's screens,
and before WP13 because the assistants are a separate surface that does not exist yet.

It is **not** a redesign. The navigation, the branding, and the screen layout stay. The pass changes
words and small visuals, and it virtualizes two lists.

## Why the timing is fixed

- **WP12 rewrites the capture-status wording.** It turns the indicator from one name into a count
  (`N characters`) and grows the Live page a row per client. Polishing that copy before WP12 would
  only be redone, so the wording sweep waits for WP12.
- **The assistants (WP13–WP18) are an unbuilt surface.** Their copy is new and safety-facing (the
  stop, "off by default", the credential-dialog refusal). It cannot be written before the features
  exist. So this pass writes the voice and terminology convention that WP13–WP18 follow, and each
  assistant gets a light copy touch-up as it ships — not a second full pass.

## The one way to get this wrong

- **Do not start before WP12 merges.** The capture-status wording is exactly what WP12 rewrites.
- **Virtualization must not break the icon `<img>` fetch or the `ItemTooltip` anchor.** A windowed
  list unmounts off-screen rows. Confirm tooltips and in-flight `midir-icon://` fetches survive a
  scroll.
- **Keep wording and perf as separate commits.** A copy change is checked by eye in the GUI; a
  virtualization change is measured. They fail differently and are reviewed differently.

## Decisions

1. **Inventory every user-facing string first.** The copy hub is `components/Guidance.tsx` (all the
   empty and guidance states), plus the five pages and the shared components: `CaptureIndicator.tsx`,
   `ItemTooltip.tsx`, `CharacterSheet.tsx`, `TitleBar.tsx`, `ThemePicker.tsx`.
2. **Apply the agreed wording, then normalise voice.** Sabrael holds the specific changes. The pass
   applies them and makes the voice consistent across screens.
3. **The locale is one decision, not per string.** British spelling is consistent now ("Armour",
   "Defence", "colour", "summarise"). Keep it or switch it once, for the whole app.
4. **Write a voice and terminology section in this doc** (below). It fixes the agreed terms for the
   capture states, the character, and the bank, and reserves the terms for the assistants — the stop,
   "off by default", and the refusal copy. WP13–WP18 inherit it.
5. **Rename the Clout Assistant to the Laborer** everywhere in the UI and the user-facing docs. The
   name is settled (WP17); this pass carries it into the copy.
6. **Verify the capture-status wording at realistic scale.** Sabrael runs as many as ~25 clients at
   once. The indicator count and the Live list must read well at 25, not only the `2 characters`
   example in the WP12 doc.
7. **No read-path cap.** A cap on how many characters are read would drop real character data, which
   the charter forbids. The driving path has its own one-window limit (WP13 decisions 9 and 10); the
   read path stays unbounded.
8. **The Appearance card gets a finish.** `components/CharacterSheet.tsx` shows raw sprite integers
   ("Armour sprite" and the rest). Decide how that reads for a player, not a developer.
9. **The theme labels get consistent.** `components/ThemePicker.tsx` gives only two of six themes a
   `(light)`/`(dark)` qualifier. Make the set consistent.
10. **Virtualize the two long lists.** The Items index (`pages/Items.tsx`) and the inventory list in
    `components/CharacterSheet.tsx`. Warm the icon cache for the rows about to show, so an icon is
    present before its row paints — the icon service already caches each rendered PNG in memory, so a
    warm pass is a read-ahead, not new decode work.
11. **Reuse a house virtualization idiom.** Per `CLAUDE.md`, grep a sibling app (`oghma`, `elatha`,
    `creidhne` under `src/renderer`) for the idiom before adding a dependency.

## Voice and terminology (fill in during the pass)

> This section is written during WP19 and becomes the reference WP13–WP18 follow. It is a stub until
> the wording is agreed.

- **Capture states** — the words for `stopped`, `listening`, `decoding`, and `missedHandshake`.
- **The character** — how a live character, a recorded character, and a forgotten character are
  named in the UI.
- **The bank** — "read", "not read", and "empty", said the way the model distinguishes them.
- **Reserved for the assistants** — the stop, "off by default", the window picker, and the
  credential-dialog refusal. WP13–WP18 use these terms unchanged.

## Non-goals (stop-lines)

- **No navigation change**, no new tabs, no reordered screens.
- **No branding or wordmark change.** The title bar identity stays.
- **No new themes.** The six shipped themes are mature; touch only what a finish decision needs.
- **No read-path cap**, ever (decision 7).
- **No new feature copy.** This pass polishes what WP1–WP12 shipped; the assistants bring their own.

## Current state when you start

- [components/Guidance.tsx](../../src/renderer/src/components/Guidance.tsx) — the empty/guidance-state
  hub, and the largest copy surface.
- [pages/Items.tsx](../../src/renderer/src/pages/Items.tsx) and
  [components/CharacterSheet.tsx](../../src/renderer/src/components/CharacterSheet.tsx) — the two long
  lists to virtualize; `CharacterSheet.tsx:288-305` is the Appearance card.
- [components/ThemePicker.tsx](../../src/renderer/src/components/ThemePicker.tsx) — the theme labels
  to make consistent (lines 12-19).
- [components/CaptureIndicator.tsx](../../src/renderer/src/components/CaptureIndicator.tsx) and
  [pages/Live.tsx](../../src/renderer/src/pages/Live.tsx) — the capture-status wording WP12 rewrote;
  verify at ~25 clients.
- [components/ItemIcon.tsx](../../src/renderer/src/components/ItemIcon.tsx) and the `midir-icon://`
  handler in main — the icon cache the warm pass reads ahead into.

## Acceptance criteria

1. Every user-facing string reads in one consistent voice, and the locale is one decision.
2. The Clout Assistant name is gone from the UI and the user-facing docs; the Laborer is in its place.
3. The Appearance card reads for a player, not as raw sprite numbers.
4. Every theme label is consistent.
5. The capture indicator and the Live list read well at one client and at ~25.
6. The Items index and the inventory list render a windowed subset, not every row.
7. An icon is present before its row paints on a scroll of a long list.
8. Nothing in the record, the store, the protocol layer, or the capture path changes.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. **Wording and visual:** no unit test proves copy. Hand a GUI click-through to Sabrael against the
   string inventory, including a ~25-client capture for the indicator and the Live list. Record the
   before/after wording in this doc.
3. **Virtualization:** a unit test that a long list renders a windowed subset, not every row. Frame
   rate and scroll smoothness go to Sabrael on a real long Items index; confirm an icon is present
   before its row paints.
4. `npm run dev` needs a GUI and cannot run headless. The click-throughs go to Sabrael.
