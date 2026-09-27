# WP43 — the world graph view

**Size:** M. **Depends on:** WP29 (the learned layer and its curations), WP30 (the Map tab and
`map:editWarp`), WP24 (the candidate layer), and WP38 (the map names). Read `00-overview.md` first.
**PLANNED.** **Card:** `HTOO-483`.
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

Those are measurements, and they are already stark. Over the warps the graph routes on today —
`WorldMap.dat` plus the 98 edges the wire has proved — the world is **326 separate pieces**: one of
413 maps, and **325 maps with no confirmed warp in or out at all**. Add WP24's candidate layer and it
becomes **8 pieces**: 718 maps, then 13, then 2, and 5 singletons. **13 maps have no way in on any
layer.** **246 confirmed edges have no edge back**, and **9 maps have a confirmed way in and no
confirmed way out** — which is exactly the shape of an explorer run that reports `stuck`.

Nothing in Midir shows any of that. The explorer's log says a run was stranded; this view says why,
and lets the user fix it in the same place.

## Decisions

1. **The graph is the picture, and the map is not.** Nodes are placed by a force layout, not by map
   geography: a warp graph has no coordinates, and the Map tab already owns the geographic view. The
   two views link to each other — a node opens that map on the Map tab, and a warp on the Map tab
   opens its node here.
2. **Provenance is the colour, and it is the point.** Every edge already carries `source` (the
   imported `.dat`, the wire, a curation, or an XML candidate). A candidate is drawn as an outline,
   exactly as the Map tab draws it, so "the only way in is a warp nobody has crossed" is visible
   without reading a number.
3. **The whole world is too much for one screen, so the view is scoped.** The default scope is the
   picked character's own component, with a depth from where it stands. The other scopes are one map
   and its neighbours to depth N, a named component, and everything. 738 nodes and 4000 edges will
   not read as a hairball anybody can use.
4. **The edit is WP30's edit, not a second one.** Accept, Reject, Restore, Edit, and Add warp all go
   through `map:editWarp`, which validates, writes the `curation`, rebuilds the live graph, and
   answers with the map. This view adds no write path of its own. A curation is the only thing it
   writes, and it never writes the imported files (WP29's rule).
5. **The report is part of the view.** The counts above are computed, not drawn: a panel lists the
   components with their size, the maps with no way in, the maps with no way out, and the one-way
   edges, each row selecting its node. That panel is the thing that answers "why did the run strand",
   and it is useful before a single node is drawn.
6. **It reads the live graph and nothing else.** `route/liveGraph.ts` already holds the one merged
   graph and rebuilds it on every write, so the view is a read of that, over one new handler. No new
   store, no new file.
7. **The layout is a library, and it is one of the two we already load from a CDN allowlist — or it
   is hand-rolled.** Decide by measuring: a force layout over 738 nodes must settle in under a second
   on the packaged build, or the view is scoped tighter (decision 3) rather than made slower.

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
5. Accept, Reject, Restore, Edit, and Add warp work from this view, through `map:editWarp`, and the
   walker plans on the change at once.
6. The imported files are unchanged after every edit.
7. Scoping to a component, to a depth, and to everything all work on the real graph of 738 maps.

## Verification

1. The counts the report shows match a script over the same files: 326 components over confirmed
   edges, 8 with candidates, 13 maps with no way in, 246 one-way edges, 9 with no confirmed way out.
2. A curation made from this view appears in `transitions.json` and in the Map tab, and a walk plans
   over it.
3. A rejected warp leaves the graph, and the explorer stops offering the map it was the only way to.
