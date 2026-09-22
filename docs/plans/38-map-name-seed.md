# WP38 — seed the map names the .dat leaves blank

**Size:** S. **Depends on:** WP29 and WP30 (the learned layer and the merge). Read `00-overview.md`
first.
**COMPLETE 2026-09-22.** **Card:** `HTOO-471`.
**Trigger to start:** Sabrael, 2026-09-22, on the map names in an offline list.

## Goal

Give every map in the route graph a name.

226 of the 385 maps `WorldMap.dat` holds carry no name in it. The world XML (WP24) names 67 of
them. The other 159 show in the Walker's destination list and on the Map tab as a bare map id, so
the player cannot type a destination that reaches them, and a route through one reads as a number.

The wire names every map the player arrives on (`SMapSize 0x15`, WP29), but only after the visit.
A map the player has not been to is the map they most want to look up.

## How it works

An offline map-name list gives `<map id> - <name>` for 2387 maps.
`scripts/import-map-names.mjs` reads one and writes `src/main/route/mapnames.json`. The importer
is not run at run time, and the JSON is never written by the app, like `worldmap.json` and
`xmlworld.json`.

`mergeLearned` lays the list over the graph as the weakest name it has (`route/graph.ts`). The
order of the name sources, weakest first:

1. **The seed list.** A name from here reaches a map only when `WorldMap.dat` and the world XML
   both leave it unnamed.
2. **The world XML** (WP24).
3. **The wire** (WP29). `SMapSize 0x15` replaces whatever the merge put on the node, on the first
   visit, and `maps.json` keeps it, so the correction survives a restart and the seed never shows
   for that map again.

The seed name lands on `gameName`, the same field the XML and the wire use, so the destination
index and the Map tab read it with no change of their own. `name` stays the `.dat`'s word.

## Decisions

1. **The list is a seed, not a source of maps.** A seed name reaches an existing node only. The
   list names 1671 map ids the graph has no node for, and a name with no edge behind it is a
   destination the walker cannot plan a route to — worse than no destination at all.
2. **The list never argues.** 260 of the names it shares with `WorldMap.dat` and the XML disagree
   with them: `Mileth Bank` against `Mileth Storage`, `West Woods 8-1` against `West Woodland
   8-1`, `TOC` against `Path Reception`. The list is old and the wire is the authority, so a seed
   name is applied only where there is nothing to argue with.
3. **No new store.** The wire's correction is already persisted by `maps.json` (WP30). The seed is
   an import and needs no write path of its own.
4. **The rows are cleaned on import, not at run time.** The separator is a hyphen or a CP1252 en
   dash, some rows carry a `*` marker, some pad the name with runs of spaces, a name that starts
   with `null` means the scrape found none, and three ids appear twice. The importer takes the
   first row for an id and counts the rest.

## Non-goals (stop-lines)

- **No name from the list for a map the graph does not hold.** See decision 1.
- **No overriding of a name any other source gives.** See decision 2.
- **No attribution or provenance field on the node.** The user asked for the names, not for the
  list's history (Sabrael, 2026-09-22). A name that is wrong is corrected by the first visit.

## What shipped

- `scripts/import-map-names.mjs`, with `parseNameList` exported and tested
  (`scripts/import-map-names.test.mjs`).
- `src/main/route/mapnames.json`: 2387 names.
- `LearnedLayer.names` and the seed pass in `mergeLearned` (`src/main/route/graph.ts`), between
  the hand edits and the wire's word.
- The wiring in `src/main/index.ts`: `rebuildGraph` passes `names` on every rebuild.

**The measured effect:** 159 nodes gain a name, and no node in the 821-node graph is nameless.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint:check`, `npm run build`.
- The merge order is pinned by a test in `src/main/route/__tests__/graph.test.ts`: the `.dat`'s
  name stands, a seed for a map with no node adds nothing, the XML's name beats the seed, and the
  wire's name replaces it.
- Handed to the user: type one of the newly named maps into the Walker's destination box, and
  confirm the Map tab names it.
