# WP19 — read-app UI fixes and the character-screen redesign

**Size:** M. **Depends on:** WP12. Read `00-overview.md` first. **COMPLETE 2026-07-24** — PR #8.

## What shipped

Seven UI fixes across the read half, and the character-screen redesign.

- **`CaptureIndicator.tsx`** — the missed-handshake pip reads `Idle`, not `Start Midir first`. The
  warning colour and the tooltip stay.
- **`Live.tsx`** — the join-late label is now "Midir is ready" / "Log in with a fresh character
  session to begin."
- **`shared/character.ts` + `pages/Items.tsx` + `components/GoldTooltip.tsx`** — a new
  `summariseGold(records)` totals the gold and each character's share. The Items header shows the
  total below the item summary, and a hover breaks it down by character with the age of each reading.
- **`components/CharacterSheet.tsx` + `components/EquipScreen.tsx`** — the sheet is an identity card,
  an Equip screen (equipment item icons in the client slot layout, a placeholder in the centre), a
  vitals card, and collapsible Statistics, Inventory, Bank, and Legend sections. The Equipment and
  Appearance cards merged into the Equip screen; the raw sprite integers are dropped.
- **`shared/types.ts`, `main/handlers/settings.ts`, `main/settingsManager.ts`,
  `store/settingsStore.ts`, `NavBar.tsx`, `App.tsx`** — a persisted `showDiagnostics` (default true)
  in the Capture settings shows or hides the Diagnostics tab. `App` moves off the Diagnostics view
  when it hides while open.
- **`pages/Settings.tsx` + `components/InfoTip.tsx`** — the record-sessions and recordings-cap
  subtexts became (i) tooltips. The cap has its own label, on one line with the field.
- **The six themes** — `MuiAccordion` and `MuiTooltip` overrides, so the accordions and every
  tooltip read as the app's own surfaces.
- **Tests** — `summariseGold`, the `NavBar` Diagnostics filter, the `CaptureIndicator` "Idle" state,
  and the updated `CharacterSheet` structure.

## Goal

Give the read app its finish. This pass fixes seven UI points across the read half (WP1–WP12): two
capture-state words, a total-gold view, the character-screen redesign, a Diagnostics-tab toggle, and
two Settings tooltips. It lands after WP12 because WP12 is the last change to the read app's screens,
and before WP13 because the assistants are a separate surface that does not exist yet.

The character screen is a redesign. The other six items are small. The redesign replaces the flat
grid of equal cards with an identity card, an Equip screen, a vitals card, and collapsible detail
sections.

## Why the timing is fixed

- **WP12 rewrote the capture-status wording.** It turned the indicator from one name into a count,
  so polishing that copy before WP12 would only be redone.
- **The assistants (WP13–WP18) are an unbuilt surface.** Their copy is new and safety-facing. This
  pass does not touch it.

## The one way to get this wrong

- **A new persisted setting must travel the whole path.** `showDiagnostics` needs the shared type,
  the Zod schema, `withDefaults`, and the store save-whitelist. A field missing from `withDefaults`
  or the whitelist is dropped silently on the next start.
- **The Equip screen shows item icons, not a character doll.** The client draws a composited
  `HumanImage` in the centre. Midir cannot: the icon pipeline renders only `legend.dat` item icons.
  The centre keeps a placeholder. The composited doll is a later WP.

## Decisions

1. **The idle pip reads "Idle".** `components/CaptureIndicator.tsx` labelled the missed-handshake
   state `Start Midir first`. The pip now reads `Idle`. The warning colour and the tooltip stay, and
   the full instruction moves to the Live page (decision 2).
2. **The Live "joined too late" label is shorter.** `pages/Live.tsx` now reads "Midir is ready" /
   "Midir is set up correctly. Log in with a fresh character session to begin."
3. **The Items page tabulates gold.** A new `summariseGold(records)` in `shared/character.ts`
   returns the total and each character's share, most first. The Items header shows the total, below
   the item summary. A hover tooltip (`components/GoldTooltip.tsx`, modelled on `ItemTooltip.tsx`)
   lists each character's gold and the age of the reading. Only characters that hold gold read on the
   breakdown.
4. **The character screen is redesigned.** `components/CharacterSheet.tsx`:
   - An **identity card**: name, level and class, citizenship, guild, title, waiting mail, and last
     seen.
   - An **Equip screen** (`components/EquipScreen.tsx`): the equipment item icons in the client's
     Equip-screen slot layout, with a placeholder in the centre. It absorbs the old Equipment and
     Appearance cards.
   - A **vitals card**: health and mana bars, then gold, weight, items carried, and items banked.
   - Collapsible **Statistics**, **Inventory**, **Bank**, and **Legend** sections. Statistics opens
     by default.
5. **The Appearance card is gone.** Class and nation moved to the identity card. The raw sprite
   integers (hair, face, body, skin) read for a developer, not a player, so they are dropped.
6. **The Diagnostics tab is a Settings toggle.** A persisted `showDiagnostics` (default true) hides
   or shows the Diagnostics tab. `NavBar` filters the tab, and `App` moves off the Diagnostics view
   when it hides while open.
7. **Two Settings subtexts become (i) tooltips.** A reusable `components/InfoTip.tsx` carries the
   help text for "Record sessions to a file" and for the recordings cap. The cap gets a separate
   label, so its subtext no longer sits in `helperText`.
8. **The accordion is a new theme idiom.** The app had no accordion. A `MuiAccordion`,
   `MuiAccordionSummary`, and `MuiAccordionDetails` override is added to all six themes, so the
   sections read as the app's own surfaces and not as a browser default.

## Non-goals (stop-lines)

- **No composited character doll.** The Equip screen centre is a placeholder. The doll needs the
  `khan*.dat` body, hair, and face archives and a layer compositor Midir does not have. It is a new
  WP. _Trigger:_ a decision to build the doll.
- **No list virtualization in this pass.** The Items index and the inventory list are not windowed
  here. The inventory list is now inside a collapsed accordion, which lowers the pressure.
  _Trigger:_ a slow list on a real long capture.
- **No theme-label change** in `ThemePicker.tsx`, and **no Laborer rename** (that stays with the
  assistants, WP13–WP18).
- **No navigation change**, no new capture behaviour, and **no read-path cap**. Nothing in the
  record, the store, the protocol layer, or the capture path changes. Item 3 reads a gold value that
  already exists.

## Current state when you start

- [components/CaptureIndicator.tsx](../../src/renderer/src/components/CaptureIndicator.tsx) and
  [pages/Live.tsx](../../src/renderer/src/pages/Live.tsx) — the capture-state words (items 1, 2).
- [pages/Items.tsx](../../src/renderer/src/pages/Items.tsx) and
  [shared/character.ts](../../src/shared/character.ts) — the gold total (item 3).
- [components/CharacterSheet.tsx](../../src/renderer/src/components/CharacterSheet.tsx) — the
  redesign (items 4, 5).
- [shared/types.ts](../../src/shared/types.ts),
  [main/handlers/settings.ts](../../src/main/handlers/settings.ts),
  [main/settingsManager.ts](../../src/main/settingsManager.ts),
  [renderer/src/store/settingsStore.ts](../../src/renderer/src/store/settingsStore.ts),
  [components/NavBar.tsx](../../src/renderer/src/components/NavBar.tsx), and
  [App.tsx](../../src/renderer/src/App.tsx) — the `showDiagnostics` setting (item 6).
- [pages/Settings.tsx](../../src/renderer/src/pages/Settings.tsx) — the two tooltips (item 7).
- The six [themes](../../src/renderer/src/themes) — the accordion override (item 8).

## Acceptance criteria

1. The idle pip reads "Idle"; the Live label is the short form.
2. The Items page shows a gold total, and a hover breaks it down by character with the age of each
   reading.
3. The character screen shows the identity card, the Equip screen with the client slot layout, the
   vitals card, and the four collapsible sections.
4. The Diagnostics tab hides and shows from Settings, and the app never points at a tab that is gone.
5. The two Settings subtexts are (i) tooltips; the recordings cap has its own label.
6. The accordions read as the app's own surfaces in all six themes.
7. Nothing in the record, the store, the protocol layer, or the capture path changes.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. **Unit tests:** `summariseGold` (total, order, a total past 2^31); `CaptureIndicator` reads
   "Idle"; `NavBar` hides Diagnostics when the setting is off; `CharacterSheet` renders the identity
   card, the eighteen Equip slots, and the four sections.
3. **GUI (hand to Sabrael):** the "Idle" pip and the new Live label after a late join; the gold total
   and its hover on the Items page; the redesigned character sheet with the Equip layout and the
   collapsing sections across a few themes; the Diagnostics toggle; and the two Settings tooltips.
   `npm run dev` needs a GUI and cannot run headless.
