# WP30 — the map viewer and route inspector

**Size:** M. **Depends on:** WP15 (the grid and the graph), WP14 (the live position), and WP7 (the
dalib-ts render path). Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a walker stop the log cannot explain, or a want to see and curate the route
graph on the map it belongs to.

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

- [route/mapGrid.ts](../../src/main/route/mapGrid.ts) and
  [route/mapSource.ts](../../src/main/route/mapSource.ts) — the passability grid, ready to render.
- [route/graph.ts](../../src/main/route/graph.ts) — the warps for a map.
- [captureService.ts](../../src/main/captureService.ts) — `positionFor(connectionId)`, the live
  position.
- [walker.ts](../../src/main/walker.ts) — the `walker:state` push already carries the position, the
  next warp, and the steps taken; the stop reason is in the outcome.
- [icons/iconService.ts](../../src/main/icons/iconService.ts) — the dalib-ts render path, for the
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
   a client file.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the `MapView` build from a known grid and graph, and the warp edit through the store.
   The render component gets a component test against a fixed `MapView`.
3. GUI (hand to Sabrael): a real map open, the position tracking a walk, and a walker stop shown on
   the map.
