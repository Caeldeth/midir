# WP24 — the walker route graph from ceridwen

**Size:** M. **Depends on:** WP15, and ceridwen built out. Read `00-overview.md` first. **PART
SHIPPED 2026-09-22, provisionally, from the world XML; the ceridwen switch-over waits for
ceridwen.** **Card:** `HTOO-73`.
**Trigger to start:** ceridwen built out, or the hand-made `WorldMap.dat` going stale, or WP17
wanting NPC coordinates the `.dat` cannot give.

**A source is already in hand (2026-09-21).** The production world repo's `xml/maps/.ignore/Old*.xml`
set is Hybrasyl's authoring of the retail maps — Sabrael's word is that it is spot-on for retail —
with `<Warp>` edges, `<MapTarget>` arrival tiles, and `<Npc>` tiles, in the same schema this WP
describes. WP33 took Piet Village and the Piet, Abel, and Undine storages from it, and it agreed
with the `.dat` on every warp both describe. The importer this WP plans can read that set today;
the blocker is only the choice to switch the whole graph over, not the data.

**What shipped (2026-09-22): the provisional layer.** `scripts/import-world-xml.mjs` reads the
`.ignore/Old*.xml` set and thirteen production areas whose maps are retail's, unchanged (Sabrael:
Mehadi, Pravat, New Crypt, East and West Woods, Dubhaim Castle, CR, Astrid, Oren Ruins and Sewer,
Shinewood Forest, Suomi, Undine); a map in both sets is read from `.ignore` and the production copy
compared against it, differences printed and never merged. Targets resolve by name — the referring
map's area first, then `.ignore`, then any unique match. The result, `route/xmlworld.json`, is 542
maps and 4074 warps: 436 maps the `.dat` does not know, and of 434 warps on pairs it does, 319
tile for tile, 66 within two tiles, 49 elsewhere. **Why provisional, in one example:** the XML
puts the Rucesion Town Hall door at (4,5) and (5,5); the wire, 57 crossings, at (4,6) and (5,6).
So every XML edge enters the graph as a **candidate** (`RouteNode.candidates`, `source: 'xml'`,
outlined on the Map tab) and becomes an exit only when the wire crosses it once
(`XML_PROMOTION_OBSERVATIONS`, against two for a bare learned edge: the XML and the wire agreeing
is confirmation) or the user accepts it (WP30's edit); a reject removes it like any other. A map
the `.dat` lacks is a node named by the XML until the wire names it, and sized by the XML, so the
Map tab can draw it. The walker gains nothing from the file on its own, which is the stop-line
this WP set. `mergeLearned` takes one `LearnedLayer` now: the transition file, the wire's names,
and the XML. NPC positions (decision 2) and the ceridwen switch-over are still to come.

## Goal

Build the walker's route graph from ceridwen instead of the hand-made `WorldMap.dat` that WP15 ships
on. Ceridwen holds the same graph as authored XML — `<Warp>` edges with `<MapTarget>` destinations —
plus NPC positions (`<Npc Name="Donnan" X="2" Y="5"/>`) that the `.dat` lacks and the Laborer's
"walk to this NPC" needs.

## Why ceridwen, and why not now

- **Ceridwen is the aligned source.** Its intent is a 1:1 capture of the retail world, so a
  ceridwen-derived graph is aligned with retail by design — which a retail-only tool needs (settled
  decision 5). `Repos/world` is the divergent Hybrasyl production data and must not be used for this.
- **`WorldMap.dat` is hand-made, so it is stale-prone.** It is only as current as whoever last walked
  the world.
- **The blocker is that ceridwen is not built yet.** Today's `Repos/ceridwen/xml/maps/` is partial:
  231 maps, 80 with warps, in progress. It cannot be the source until it is complete.

## The one way to get this wrong

**Trusting a derived graph before the wire confirms it.** A 1:1 capture is a goal until a live
session proves it. Verify a ceridwen-derived graph against the positions WP14 reads on a live retail
session before the walker steers by it.

## Decisions

1. **Convert at import time, not at runtime.** Read the ceridwen map XML once, emit the same JSON
   route-graph shape WP15 already uses (`RouteNode` with `exits`), and version it in the repo.
2. **Add the NPC positions the `.dat` lacks.** The map XML carries `<Npc>` entries; carry them into
   the graph so WP17 can name a destination NPC.
3. **Keep the WP15 graph shape.** The walker planner does not change; only the source of the data
   does. A ceridwen graph and a `WorldMap.dat` graph are interchangeable inputs.
4. **Verify against the wire before trusting.** WP14's live positions are the check.

## Non-goals (stop-lines)

- **No use of `Repos/world`.** It is the divergent Hybrasyl world, not the retail one.
- **No runtime XML parsing.** The graph is built once, at import.
- **No change to the walker planner** (WP15). This WP swaps the data source, not the search.

## Current state when you start

- WP15's imported `WorldMap.dat` graph and its `RouteNode` JSON shape — the target format.
- `Repos/ceridwen/xml/maps/` — the source, partial today.
- WP14's `Position` — the live check a derived graph is verified against.

## Acceptance criteria

1. A ceridwen-derived graph loads into the WP15 planner unchanged.
2. The graph carries NPC positions the `.dat` did not have.
3. The derived graph is verified against WP14 positions on a live session before it is trusted.
4. `Repos/world` is not read. **Revised 2026-09-22:** the world repo's `.ignore/Old*.xml` set and
   the retail-unchanged production areas are read, as a provisional layer the wire confirms
   (Sabrael, 2026-09-22); the divergent production town maps are not.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. The importer converts a complete ceridwen map set to the route-graph JSON; unit-test the
   conversion against a known map's warps and NPCs.
3. GUI (hand to Sabrael): a walk that uses the derived graph, checked against the live positions.
