# WP43 — the world graph view

**Size:** M. **Depends on:** WP29 (the learned layer and its curations), WP30 (the Map tab and
`map:editWarp`), WP24 (the candidate layer), and WP38 (the map names). Read `00-overview.md` first.
**BUILT 2026-09-27.** **Card:** `HTOO-483`.
**Trigger to start:** Sabrael, 2026-09-27, after the explorer stranded itself twice in one run: the
Map tab shows one map at a time, and the faults the explorer meets are facts about the **shape of
the whole graph**.

## Goal

Draw the route graph as a graph: one node for each map, one edge for each warp, and the provenance
of every edge in its colour. Then curate it from that view, with the same `map:editWarp` the Map tab
already uses.

The Map tab (WP30) answers "what is on this map, and where does this warp go". It cannot answer the
questions a walk actually fails on, because each one is about more than one map at a time:

- **Is this map connected to the rest of the world at all?**
- **Can a character get back out of it?**
- **Which maps hang off a warp no walk has ever crossed?**

Those are measurements, and they are already stark. **Over the imported files alone** — `WorldMap.dat`
with the world XML as the candidate layer, and no learned edge, which is what a fresh install holds:

| Fact                                            | Count                                         |
| ----------------------------------------------- | --------------------------------------------- |
| Maps                                            | 718                                           |
| Pieces over the warps the graph routes on       | **334** — one of 385 maps, and **333 of one** |
| Pieces once the candidates count                | **9** — the largest of 690                    |
| Maps with no way in on any layer                | 13                                            |
| Maps with a routed way in and no routed way out | 6                                             |
| Routed warps with no warp back                  | 228                                           |
| Maps whose only way in is a candidate           | 320 (the other 13 of the 333 have none)       |

These are the numbers `graphReport.test.ts` pins, because they come from files in the repository and
nothing else. **A session's own learned edges change them**, and that is the point of the view rather
than a caveat: on the machine this was built on, 98 learned edges take the graph to 738 maps and 326
pieces (largest 413), 8 pieces with candidates, 246 one-way warps, and 9 maps with no way out.

Nothing in Midir showed any of that. The explorer's log says a run was stranded; this view says why,
and lets the user fix it in the same place.

## Decisions

1. **The graph is the picture, and the map is not.** Nodes are placed by the graph's own shape, not by
   map geography: a warp graph has no coordinates, and the Map tab already owns the geographic view.
   A node opens that map on the Map tab, which is where the tiles are.
2. **Provenance is the colour, and it is the point.** Every edge already carries `source` (the
   imported `.dat`, the wire, a curation, or an XML candidate). A candidate is drawn as an outline,
   exactly as the Map tab draws it, so "the only way in is a warp nobody has crossed" is visible
   without reading a number.
3. **The whole world is too much for one screen, so the view is scoped.** The default scope is the
   picked character's own component, with a depth from where it stands. The other scopes are one map
   and its neighbours to depth N, a named component, and everything. 738 nodes and 4000 edges will
   not read as a hairball anybody can use.
4. **The edit is WP30's edit, not a second one.** Every change goes through `map:editWarp`, which
   validates, writes the `curation`, rebuilds the live graph, and answers with the map. This view adds
   no write path of its own, and it never writes the imported files (WP29's rule).
   **Refined while building:** a curation is keyed by a **tile**, and this view has no tiles — it draws
   one row for each map-to-map pair, however many doors that pair has. So **Accept and Reject** are
   here, applied to every tile of the pair through the Map tab's own view of the from-map, because a
   pair is as accepted as its tiles; and **Restore, Edit and Add warp** stay on the Map tab, one click
   away, where the tile is visible. Inventing a tile picker with no map under it would be worse than
   the link.
5. **The report is part of the view.** The counts above are computed, not drawn: a panel lists the
   components with their size, the maps with no way in, the maps with no way out, and the one-way
   edges, each row selecting its node. That panel is the thing that answers "why did the run strand",
   and it is useful before a single node is drawn.
6. **It reads the live graph and nothing else.** `route/liveGraph.ts` already holds the one merged
   graph and rebuilds it on every write, so the view is a read of that, over one new handler. No new
   store, no new file.
7. **The layout is hand-rolled, and it is rings of hops.** Settled while building, and it replaces the
   force layout the plan reached for. A force simulation needs hundreds of ticks over 718 nodes, and it
   settles somewhere different every time. Rings of warps from the middle are one pass over the edges
   for each of three relaxation rounds — instant at every scope, and the same graph always draws the
   same way. It also **says something a force layout does not**: distance from the middle is how far
   there is to walk, which is the question the view is for. No library, and no CDN entry (`graphLayout.ts`,
   12 tests, 718 nodes laid out well inside a second).

## Non-goals (stop-lines)

- **No new write path.** Every change is a WP29 curation through `map:editWarp`.
- **No geographic layout.** That is the Map tab.
- **No automatic repair.** The view names a hole; the user decides what goes in it. Midir must not
  invent a warp because the shape of the graph suggests one.
- **No edit of the imported files.** `WorldMap.dat`, the world XML, and the client's files stay
  read-only, as everywhere else.

## Current state when you start

- `src/main/route/liveGraph.ts` — the one merged graph, rebuilt on every write. The read this needs.
- `src/main/route/graph.ts` — `RouteGraph.pathsFrom`, `reachableFrom`, and the exits with `source`.
- `src/main/handlers/map.ts` — `map:list`, `map:view`, `map:editWarp`. The edit is here already.
- `src/renderer/src/pages/MapPage.tsx` — the per-map viewer and the curation bar to reuse.
- `src/main/explorer.ts` — `unconfirmedMaps(graph)` computes the candidate-only maps this view draws.

## Acceptance criteria

1. The view draws the picked character's component, with every edge's provenance in its colour, and
   settles in under a second.
2. A node names its map, its id, and its warps in and out; clicking one opens that map on the Map tab.
3. The report panel lists the components by size, the maps with no way in, the maps with no way out,
   and the one-way edges, and a row selects its node.
4. A candidate edge is visibly a candidate, and the maps reachable only over candidates are listed.
5. Accept and Reject work from this view, through `map:editWarp`, and the walker plans on the change at
   once. Restore, Edit and Add warp are one click away on the Map tab (decision 4).
6. The imported files are unchanged after every edit.
7. Scoping to a component, to a depth, and to everything all work on the real graph of 738 maps.

## Verification

1. **Done, and it is a test rather than a script.** `graphReport.test.ts` computes the report from
   `worldmap.json` with `xmlworld.json` over it and pins every count in the table above: 718 maps, 334
   pieces (385 largest, 333 of one), 9 pieces with candidates (690 largest), 13 with no way in, 6 with
   no way out, 228 one-way warps, 320 reachable only over a candidate. A figure that moves now fails
   the build.
2. **Handed to Sabrael:** a curation made from this view appears in `transitions.json` and on the Map
   tab, and a walk plans over it.
3. **Handed to Sabrael:** a rejected warp leaves the graph, and the explorer stops offering the map it
   was the only way to.

## What shipped

**Main.** `route/graphReport.ts` is pure over the nodes: the pieces, the maps with no way in, the maps
with no way out, the one-way warps, and the maps only a candidate reaches. `handlers/graph.ts` answers
`graph:view` with the whole graph — one row for each map (its name, whether the stores hold a reading,
whether it is on the hostile list) and one for each map-to-map pair (its provenance, whether anything
has crossed it, how many tiles it has, how often the wire saw it) — with the report over it and where
each live character stands. It holds no state and writes nothing.

**The renderer.** A **World** tab. `lib/graphLayout.ts` places the nodes; `store/graphStore.ts` holds
the scope and computes it, so the picker costs no round trip; `pages/GraphPage.tsx` draws the picture
on a canvas (a dashed line for a warp nobody has crossed, an arrowhead where a warp has no warp back,
a filled node for a map that has been read, a warning ring for a map that holds monsters, the live
character's map ringed) and puts the panels beside it as ordinary elements, so a test and a screen
reader read the same thing the picture says.

**45 tests:** 14 for the report, 8 for the handler, 12 for the layout, 12 for the store, 11 for the
page.
