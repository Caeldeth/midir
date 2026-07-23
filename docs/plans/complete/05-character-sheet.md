# WP5 — the character sheet and the live view

**Size:** M. **Depends on:** WP4. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `56dd262`.

> Retrospective. Written after the fact from the commit; it records what shipped and why.

## What shipped

The app stops being a decoder and becomes something to look at.

- **`CharacterSheet.tsx`** — statistics, health and mana bars, equipment, inventory, appearance,
  legend marks, gold, title and guild, laid out in cards.
- **`pages/Characters.tsx`** — every character ever recorded, with when each was last seen.
- **`pages/Live.tsx`** — what capture is doing now, and the character being read.
- **`components/CaptureIndicator.tsx`** — stopped, listening, or reading a named character, in the
  title bar.
- **`pages/Settings.tsx`** — adapter, start-on-open, theme.
- **`lib/format.ts`** — the number, duration and "how long ago" helpers everything else reuses.
- **`store/captureStore.ts`** — the renderer's view of capture, fed by IPC events.

## Decisions that are load-bearing

1. **A field with nothing behind it says so in words.** "Nothing equipped yet", "No items seen yet".
   Blank space reads as a bug; a sentence reads as a state.
2. **Everything opportunistic is shown with its own time.** The record is as fresh as its last
   packet, and the UI never implies otherwise.
3. **Three capture states, not two.** "Listening" is a real state — Midir running with nobody logged
   in — and it is the state that tells a user the tool is working before it has anything to show.
4. **Style with `sx`, never styled-components**, and MUI v9 prop shapes are checked against a
   sibling app rather than guessed (`slotProps` over `primaryTypographyProps`, `alignItems` in `sx`,
   the `Outlined` icon names).

## What it deliberately did not do

- No editing. Nothing in the UI writes to the record; the packets are the only writer.
- No charts, no history graph. There is no history to graph.
- No per-slot inventory grid drawn to scale — a list, because the data is names and counts, and
  WP7's icons are what would make a grid worth having.

## Where it lives

`src/renderer/src/components/CharacterSheet.tsx`, `CaptureIndicator.tsx`, `NavBar.tsx`;
`src/renderer/src/pages/Characters.tsx`, `Live.tsx`, `Settings.tsx`; `lib/format.ts`;
`store/captureStore.ts`.

## How it is verified

The jsdom vitest project renders each component against record literals — including the cases that
must **not** appear, such as an unread bank never being called empty. GUI click-throughs are handed
to Sabrael; `npm run dev` cannot run headless.
