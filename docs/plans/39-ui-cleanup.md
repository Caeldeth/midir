# WP39 — the UI cleanup, and saying when a map has no route

**Size:** S. **Depends on:** WP38 (the graph names every map). Read `00-overview.md` first.
**COMPLETE 2026-09-22.** **Card:** `HTOO-472`.
**Trigger to start:** Sabrael's UI notes, 2026-09-22.

## Goal

Take the explanation out of the way of the work, and tell the player one thing the app knew and
did not say.

Every driving tab opened with a paragraph about itself. The paragraphs were written for a reader
who had never seen the tab, and the player reads them on every visit after that. They are gone.
The rules they stated are in `CLAUDE.md` and in the About dialog, which is where a rule belongs.

## What changed

1. **The intro paragraph goes, on six cards.** Boards (the Read everything paragraph), Speaker,
   Walker, Errands, Capture, and the icon card. Each tab keeps its heading, its controls, and
   every helper that names a state the player can act on ("No game window is open. Log in first").
2. **The caption under the errand picker goes.** The empty case ("No errands are set up yet")
   stays, because it tells the player something they cannot see.
3. **Item icons is "Legacy data files".** The card points Midir at the Dark Ages folder, which is
   more than icons. (The heading is sentence case, as every other card heading is.)
4. **The Live tab's Listening card says "Log in to Dark Ages to begin."** The old line explained
   the login handshake to somebody who wanted to know what to do next.
5. **The bug button moves to the end of the tab row.** In the window chrome it read as a window
   control beside minimize and close. It is the same house module, the same `report-issue` test
   id, and the same dialog; only the place changes. The tab row scrolls now, so the button keeps
   its place at a narrow width.
6. **About Midir.** The house parody-ad dialog (`AboutDialog.tsx`, balor's shape) opens from the
   About card. Midir was the one house app without one. Every line of the copy states a rule
   Midir keeps.
7. **A destination with no route is dimmed, and Go is off.** See below.

## A place the graph cannot reach

WP38 gave a name to every map in the graph, including maps no warp Midir knows leads to. Typing
one into the Walker used to be answered by a failed walk.

`RouteGraph.reachableFrom(mapId)` is one breadth-first sweep over the same edges `planRoute`
walks, so the two agree by construction: a dialog warp is not a walk, and a map the caller shuts
takes everything behind it. `walker.destinations(connectionId)` marks each place with it, from
the live position of the character on that window.

- **No character, no marking.** Reachability is from a map, and with no character there is no map
  to ask from, so `reachable` is absent and nothing is dimmed. It is never guessed.
- **The place is shown, never hidden.** A map with no route is a map whose warp Midir has not
  seen yet. The row is dimmed and reads "No route Midir knows", Go is off, and the tooltip and
  the field's helper say what to do: walk the warp once, or add it on the Map tab (WP30).
- **Only a name the picker lists is judged.** A map id, or a name the graph resolves for itself,
  goes to main as before. This is a warning, not a second resolver.

## Non-goals (stop-lines)

- **No hiding of a destination.** A dimmed row tells the player the map exists and the route is
  missing; a hidden row tells them nothing.
- **No guess at reachability without a position.**
- **No second copy of the rules.** The paragraphs removed here are not moved somewhere else in
  the UI. `CLAUDE.md` holds the charter and the About dialog states it.

## What shipped

- `src/renderer/src/pages/`: `Boards.tsx`, `Speaker.tsx`, `Walker.tsx`, `Laborer.tsx`,
  `Settings.tsx`, `Live.tsx`.
- `components/AboutDialog.tsx`, and the opener on `AboutCard.tsx`.
- `components/NavBar.tsx` takes the bug button; `components/TitleBar.tsx` gives it up.
- `route/graph.ts` and `route/liveGraph.ts`: `reachableFrom`.
- `walker.ts` `destinations(connectionId?)`, `handlers/assist.ts`, the preload, `shared/types.ts`,
  `shared/actionLayer.ts` (`WalkerDestination.reachable`), and `store/walkerStore.ts`, which
  refreshes when the window changes because another character stands somewhere else.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint:check`, `npm run build`.
- `route/__tests__/graph.test.ts` pins `reachableFrom`, including the dialog warp it will not
  cross. `__tests__/walker.test.ts` pins the marking and the "no position, no marking" rule.
  `pages/__tests__/Walker.test.tsx` pins Go going off with the reason, and the refresh naming the
  window. `components/__tests__/ReportIssue.test.tsx` now opens the report from the tab row.
- Handed to the user: the six tabs, the About dialog, and the bug button's new place.
