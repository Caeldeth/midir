# WP33 — world-map coverage for errand destinations

**Size:** S. **Depends on:** WP15 (the route graph), WP17 (the errands that need it). Read
`00-overview.md` first. **PLANNED.**

**Trigger:** surfaced by WP17. The Laborer errands name building interiors as destinations, and the
imported `WorldMap.dat` graph does not have all of them. This WP starts when a shipped errand needs a
node the graph lacks.

## Goal

Make every Laborer errand destination reachable, so the walk arrives at the NPC's building rather
than stopping with `noRoute`. This is two problems, not one: a missing node next to a town, and a
whole cross-town route over the world map.

## The world map is its own layer, and DA Walker navigates it

Leaving a town does not step onto another town. It steps onto the **overworld / field maps** — for
example `field001.epf` on exit from Rucesion — and a town is reached by crossing that layer. A
cross-town errand is a chain, not one warp. To reach Abel Bank from Mileth Inn the route is:

```text
Mileth Inn -> Mileth Village -> Mileth Village Way -> World Map -> Abel Village Way -> Abel Village -> Abel Bank
```

**DA Walker already handles this**, so its handling is the reference before anything is written. Read
how `WorldMap.dat`, `InitDistRouteTables`, `BPath`, and `doorWalk` treat the field maps and the
world-map warp coordinates — the world map has warp tiles and arrival coordinates the plain map graph
does not, and the import (`scripts/import-worldmap.mjs`) already keeps a caravan exit's three ints.
The question this WP answers is whether the imported graph already carries the world-map layer and
the "Village" / "Village Way" hops, or whether the importer drops them.

## The two shapes of the gap

1. **An unmapped node next to a town.** Mileth Tavern (Aingeal) is a node off Mileth Village that the
   graph does not name. This is a small fix: add the node and its warp.
2. **A whole cross-town chain over the world map.** Abel Bank, Undine Bank, and Piet Bank sit in
   other towns, reached only across the field/world-map layer through the "Village" and "Village Way"
   hops above. This needs the graph to carry that layer and every hop, not just the endpoints.

The graph today has town endpoints (Abel, Undine, Piet, Rucesion) and some hops (`Rucesion Village
Way`, `Mileth Gateway`, `MilethEnt`, `Abel Outskirts`), but the names are inconsistent and the chain
is not proven end to end. The errand entries in `src/main/laborer/errands.ts` name the intended
destination, so each errand works the moment its route resolves.

## Options, cheapest first

1. **Fix the importer to keep the world-map layer**, if `WorldMap.dat` already holds it and the
   import drops it. This is the smallest fix and keeps one source.
2. **Add the missing nodes and hops** to the source and re-import, for a node like Mileth Tavern that
   the source lacks.
3. **Learn the transitions from the wire** (WP29). A player who walks each route teaches the graph
   the warps, including the world-map layer. This removes the hand-made debt, but is larger.
4. **Build the graph from ceridwen** (WP24), once ceridwen is complete. It carries the warps and NPC
   positions as authored data, which also feeds the errand `npcTile` values.

## Non-goals

- **No hand-editing `worldmap.json`.** It is generated; fix the importer or the source and re-import
  (WP15 decision 1).
- **No routing into a building the world does not connect.** If a building has no warp, that is a
  world fact, not a bug to route around.

## Acceptance criteria

1. Every built-in errand's `destination` resolves to a route.
2. A same-town errand (Mileth Tavern) and a cross-town errand (Abel Bank) each arrive at the building
   in a replay or a live check, the cross-town one crossing the world-map layer.
3. The importer still reports its coverage, and no existing node is lost.
