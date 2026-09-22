# WP30 — the map viewer and route inspector

**Size:** M. **Depends on:** WP15 (the grid and the graph), WP14 (the live position), and WP7 (the
dalib-ts render path). Read `00-overview.md` first. **COMPLETE 2026-09-22: the viewer and the
walker debugger (criteria 1 to 4, PR #34), then the edit (criterion 5) once WP29 had built the
layer.** **Card:** `HTOO-79`.
**Trigger to start:** a walker stop the log cannot explain, or a want to see and curate the route
graph on the map it belongs to. Sabrael, 2026-09-22: the low items, all of them.

**What shipped.** A Map tab: pick a map, or let it follow the character. The tiles come off the
walker's own grid (`MapGrid.collision`, the SOTP nibbles, drawn top-down on a canvas: a full wall
filled, a part wall as lines on its blocked sides), the warps from the graph's exits with their
destination on hover, one dot per live character with its confidence (polled at 500 ms, the
walker's own pace), and while a walker runs its planned path as a line (`WalkerState.path`, new)
and its stop as a chip with the reason. **The size problem the plan did not see:** the map cache
has no header and the imported graph knows the size of 47 maps in 385, so a map the character is
not standing on could not be read. Every cache file is a map the player visited, and every visit
sends `SMapSize 0x15`, so `store/mapStore.ts` keeps `maps.json` (id, name, width, height, newest
reading wins) from the capture service, and the viewer takes the size from the wire first, the
graph second, a live position third. `scripts/import-worldmap.mjs` now keeps the header's size
where it has one. **The door overlay of WP31 is in:** the view takes the live connection's overlay for
its map, one argument to `gridFor`, so an opened door is open in the picture too. **Waited for
WP29:** decision 4, the edit, needs the editable graph layer with provenance; WP29 shipped it on
2026-09-22 (`transitions.json`, `mergeLearned`, `source` on every warp), and the view now draws a
learned warp in its own colour with its count.

**The edit (criterion 5), shipped the same day.** Click a warp and a bar names it and offers what
can be done: **Accept** turns a candidate on (a learned edge the wire has not seen twice, drawn as
an outline), **Reject** turns a warp off (drawn faint, whoever put it there), **Restore** withdraws
either, **Edit** opens a form for the warp's tile and destination, and **Add warp** opens the same
form for a new one; a click on the map fills the tile while the form is open (Sabrael, 2026-09-22:
a warp is a tile and a destination, so the edit is that, not a nudge). Every edit is a `curation`
record in `transitions.json`, keyed like an edge: accepted enters the graph whatever its count,
rejected leaves it, and a placed warp is an acceptance plus, when it replaces one, that one's
rejection, which keeps a hop's gesture. `mergeLearned` reads the curations last, so a hand edit wins over the wire and the
imported file alike, and an accepted edge no other source holds is `source: 'curated'`. Main
applies the edit (`map:editWarp`, validated), rebuilds the live graph, and answers with the map as
it now stands, so the walker plans on the edit at once. The imported `WorldMap.dat` and the
client's files are never written. The art layer (decision 1's second half) is still optional and
not started.

## Goal

Show one map — its passability, its warps, and the live position — and let the user curate the route
graph on it. Midir already reads everything this needs: the passability grid (WP15), the warps for a
map (the graph), and where the character stands (WP14). A view over them is the natural walker
debugger — "why did it stop here" is a question the log answers in words and a map answers at a
glance — and it is the UI that curates the edges WP29 learns. It is the analog of DA Walker's world
map editor, with Taliesin's visual tab as the closer model.

## Decisions

1. **Passability first, art later.** The first layer is the `canMove` grid from WP15: open tiles,
   blocked tiles, and the map edge. It needs no new decode. The real ground and static art is a
   second, optional layer through the dalib-ts render path WP7 already uses for icons, and it is not
   required for the view to be useful.
2. **Overlay the graph and the position.** Draw the warp tiles the graph holds for this map, and the
   live position as a dot with its confidence (WP14). Two clients means two dots, keyed by
   connection, like everything else.
3. **It doubles as a walker debugger.** When a walker runs, draw its planned path and the tile it
   stopped on, with the stop reason. A `blocked` or `lostPosition` stop then has a picture, not only
   a log line.
4. **Editing is light and explicit.** The view is read-only by default. An explicit edit lets the
   user accept, reject, or nudge a warp; the edit writes to the editable graph layer with its
   provenance (WP29), never to the imported `WorldMap.dat` and never to a client file. This is a
   curation tool, not a 231-map authoring tool.
5. **The map comes off disk, like the walker's.** The grid is read from the client's own map cache
   and SOTP (WP15), the same game data files, read the same way, never memory and never a write.

## Non-goals (stop-lines)

- **No client map or tile-art editor.** Authoring the game's maps is Taliesin's and Creidhne's job.
  This views Midir's route graph and the client's passability; it does not edit the client's world.
- **No writing the client's files.** The view reads the map cache; it never writes it.
- **No hand-authoring 231 maps.** The graph is imported and learned; this curates, it does not
  replace the import.
- **No mobs, players, or items on the map.** Where the player stands, not where anything else is.
  Other entities are a different, much larger feature (WP14 non-goal).
- **No minimap or in-game overlay.** This is a companion view in Midir's own window.

## Current state when you start

- [route/mapGrid.ts](../../../src/main/route/mapGrid.ts) and
  [route/mapSource.ts](../../../src/main/route/mapSource.ts) — the passability grid, ready to render.
- [route/graph.ts](../../../src/main/route/graph.ts) — the warps for a map.
- [captureService.ts](../../../src/main/captureService.ts) — `positionFor(connectionId)`, the live
  position.
- [walker.ts](../../../src/main/walker.ts) — the `walker:state` push already carries the position, the
  next warp, and the steps taken; the stop reason is in the outcome.
- [icons/iconService.ts](../../../src/main/icons/iconService.ts) — the dalib-ts render path, for the
  optional tile-art layer.
- The renderer pages and the store pattern, for where the view and its state live.

## Contracts

```ts
/** A map's passability and warps, sent to the renderer to draw. */
export interface MapView {
  mapId: number
  mapName?: string
  width: number
  height: number
  /** One blocked-direction nibble per tile, row-major. The renderer draws walls. */
  collision: Uint8Array
  /** The warp tiles the graph holds for this map, with their destination. */
  warps: { x: number; y: number; toMapId: number; source: EdgeSource }[]
}
```

| Channel        | Shape                                         |
| -------------- | --------------------------------------------- |
| `map:view`     | `(mapId: number) => Promise<MapView \| null>` |
| `map:editWarp` | `(edit: WarpEdit) => Promise<void>`           |

## Acceptance criteria

1. Pick a map, and the view draws its passable and blocked tiles and its map edge.
2. The warp tiles the graph holds show on the map, with their destination.
3. The live position shows as a dot with its confidence, and follows the character.
4. While a walker runs, its planned path and its stop tile show, with the stop reason.
5. An accepted or nudged warp persists to the editable graph layer, and never to the imported file or
   a client file. **Done:** `withCuration` in `store/transitionStore.ts`; the handler test proves the
   imported nodes unchanged after a reject and a nudge.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the `MapView` build from a known grid and graph, and the warp edit through the store.
   The render component gets a component test against a fixed `MapView`.
3. GUI (hand to Sabrael): a real map open, the position tracking a walk, and a walker stop shown on
   the map.
