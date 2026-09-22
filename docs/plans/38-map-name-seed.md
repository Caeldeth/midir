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

`mergeLearned` lays the list over the graph (`route/graph.ts`). The order of the name sources,
weakest first, is Sabrael's (2026-09-22):

1. **The world XML** (WP24). Its name for a retail map is Hybrasyl's own authoring of it, so "Old
   Mileth Alchemist" gives way to the list's "Mileth Magic Shop".
2. **The seed list.**
3. **The wire** (WP29). `SMapSize 0x15` replaces whatever the merge put on the node, on the first
   visit, and `maps.json` keeps it, so the correction survives a restart and the list never shows
   for that map again.

`WorldMap.dat` is outside that order, because it and the list are equally likely to be right: they
disagree on 260 names and neither is the authority. So a map the `.dat` names **shows** the
`.dat`'s name and **answers to both** — the list's name goes on `seedName`, which
`resolveDestination` reads beside `name` and `gameName`.

The seed name lands on `gameName`, the same field the XML and the wire use, so the destination
index and the Map tab read it with no change of their own. `name` stays the `.dat`'s word.

## Decisions

1. **The list is a seed, not a source of maps.** A seed name reaches an existing node only. The
   list names 1671 map ids the graph has no node for, and a name with no edge behind it is a
   destination the walker cannot plan a route to — worse than no destination at all.
2. **The list ties with `WorldMap.dat` and never breaks the tie.** They disagree on 260 names:
   `Mileth Bank` against `Mileth Storage`, `West Woods 8-1` against `West Woodland 8-1`, `TOC`
   against `Path Reception`. Either can be right, so the `.dat`'s name is shown and the list's is
   answered to, and the wire settles it on the first visit.
3. **No new store.** The wire's correction is already persisted by `maps.json` (WP30). The seed is
   an import and needs no write path of its own.
4. **The rows are cleaned on import, not at run time.** The separator is a hyphen or a CP1252 en
   dash, some rows carry a `*` marker, some pad the name with runs of spaces, a name that starts
   with `null` means the scrape found none, and three ids appear twice. The importer takes the
   first row for an id and counts the rest.

## Non-goals (stop-lines)

- **No name from the list for a map the graph does not hold.** See decision 1.
- **No overriding of the `.dat`'s name or the wire's.** The list outranks the XML only. See
  decision 2.
- **No attribution or provenance field on the node.** The user asked for the names, not for the
  list's history (Sabrael, 2026-09-22). A name that is wrong is corrected by the first visit.

## What shipped

- `scripts/import-map-names.mjs`, with `parseNameList` exported and tested
  (`scripts/import-map-names.test.mjs`).
- `src/main/route/mapnames.json`: 2387 names.
- `LearnedLayer.names`, `RouteNode.seedName`, and the seed pass in `mergeLearned`
  (`src/main/route/graph.ts`), between the hand edits and the wire's word.
- The import filter (WP24's importer): `hybrasylOnly` leaves out a map id of 30000 or more, and an
  `Old` or `Undercroft` map the list does not name. `route/xmlworld.json` drops from 542 nodes to
  437.
- The wiring in `src/main/index.ts`: `rebuildGraph` passes `names` on every rebuild.

**The measured effect:** of the 716 nodes, 557 show a name from the list (125 of them in place of
a Hybrasyl name from the XML) and 140 keep the `.dat`'s name with the list's beside it as an
alias. No node is nameless.

## Verification

- `npm test`, `npm run typecheck`, `npm run lint:check`, `npm run build`.
- The merge order is pinned by a test in `src/main/route/__tests__/graph.test.ts`: the `.dat`'s
  name is shown and the list's is answered to, a seed for a map with no node adds nothing, the
  seed replaces the XML's name, the XML still names a map the list does not, and the wire replaces
  the seed.
- Handed to the user: type one of the newly named maps into the Walker's destination box, and
  confirm the Map tab names it.
