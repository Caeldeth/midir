# WP33 — world-map coverage for errand destinations

**Size:** S. **Depends on:** WP15 (the route graph), WP17 (the errands that need it). Read
`00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-82`.

**Trigger:** surfaced by WP17. The Laborer errands name building interiors as destinations, and the
imported `WorldMap.dat` graph does not have all of them. This WP starts when a shipped errand needs a
node the graph lacks.

**The cross-town hop is built and proven live (PR1). PR2 adds every Mileth and Rucesion building
Sabrael captured, Rucesion's and Mileth's warps as full strips, an arrival tile the user can enter,
and the `nodes` section of the overrides file; the three other-town banks come from the Hybrasyl
world xml. Every built-in errand's destination resolves and routes, and a test says so.** What is
left: a wire sighting of the three other-town banks, and the game's map names beside the `.dat`'s.

## Goal

Make every Laborer errand destination reachable, so the walk arrives at the NPC's building rather
than stopping with `noRoute`. This is two problems, not one: a whole cross-town route over the
world map, and a missing node next to a town.

## How the world map works, read from the wire and from DA Walker

Leaving a town does not step onto the next town. It steps onto a **gateway map** (`3006 MilethEnt`,
`3014 Abel Outskirts`, `3081 Rucesion Gateway`), and a strip of that map's edge tiles opens the
**world map**: `SFieldMap 0x2E`, a full-screen 640 x 480 pane over the `field001` image, with one
clickable point per destination. The player clicks a point, the client echoes the point's four
words back as `CFieldMapClick 0x3F`, and the server teleports the character: `0x67`, then
`SMapInfo 0x15`, then the normal map load. So the route from Mileth Inn to Abel Bank is:

```text
Mileth Inn (136) -> Mileth (500) -> MilethEnt (3006) -> [world map: click Abel] -> Abel Outskirts (3014) -> Abel (502) -> Abel Bank
```

**The world map is not a node. It is an edge that needs a click.** That is how DA Walker models it
(`E:\Dark Ages Dev\Repos\da-tools\DAWalker`, an `ilspycmd` decompile): in `WorldMap.dat` an exit
line is `<destMap> [<screenX> <screenY>]`, the ints after the destination are the pixel DA Walker
double-clicks on the pane, and the following line holds the warp tiles. `Mover.startMovement` walks
to the tile, posts `WM_MOUSEMOVE` and two `WM_LBUTTONDOWN`/`UP` pairs, and polls until the map id is
the destination. The header's two ints are the map's width and height, not an arrival tile. The
first import read both wrong: it called the ints "caravan arrival coords" and dropped them.

**The click target is on the wire.** Each `0x2E` point carries `screen_x`, `screen_y`, a name, and
the four echoed words, which retail fills as checksum 0, the destination map id, and the arrival
tile. darkages-741-re's capture puts Loures at (344, 250) with map `0x0BC4`; DA Walker's hand-typed
line for the same hop is `3012 344 250`. So Midir picks the point by **map id** and clicks the
position **the wire gives**, and keeps DA Walker's pixel only as the fallback and the cross-check.
One caveat from the client binary: a point whose name is in the client's image table is drawn from
`field001.txt` in the client's assets, and the wire position is ignored for it. The live check
proves whether retail's positions agree for every point the errands use; a mismatch over 8 px is
logged.

Both protocol sources describe the packets: the document repo `server/0x2E-field-map.md` and
`client/0x3F-map-point-click.md` (binary-verified), and darkages-741-re
`server/046-0x2e-field-map.md` and `client/063-0x3f-field-map.md` (the capture).

**gluttony is not a reference for this.** It has a `0x3F` sender with no caller, no `0x2E` decode,
and a within-map pathfinder. It is a packet-sending bot, which Midir is not (WP18).

## As built (PR1)

- **The importer keeps the hop.** `scripts/import-worldmap.mjs` reads the exit-line ints the way
  DA Walker's loader does, and writes `via` on the exit: `{ kind: 'fieldMap', screenX, screenY }`
  for a world-map click (395 exits), `{ kind: 'prompt' }` for a bare Space (2, Veltain Mines),
  `{ kind: 'dialog' }` for a longer sequence (5: the Asilon, Noam, and Hwarone ships). The edge set
  is unchanged: 378 nodes, 2068 exits, the same as before. The parse is exported and tested.
- **`decode/fieldMap.ts`** decodes `SFieldMap 0x2E` and `CFieldMapClick 0x3F`. The test's `0x3F`
  body is the retail capture's bytes, matched against the decoded point.
- **`model/fieldMap.ts`** keeps the pane on screen now, per connection, the way `model/dialog.ts`
  keeps the dialog: set on `0x2E`, cleared on `0x15` and on a lost packet. The capture service
  exposes it as `fieldMapFor`.
- **The route graph carries the hop.** `RouteExit.via` and `RouteWarp.via` (`route/graph.ts`). The
  planner never routes through a `dialog` hop: that is an errand, not a walk.
- **The action layer gains `click(target, x, y)`**: a `WM_MOUSEMOVE` then two held
  `WM_LBUTTONDOWN`/`UP` pairs, DA Walker's gesture, through the same `PostMessageW` the keys use.
- **The walker performs the hop.** Standing on a hop tile, it waits for the pane off the wire (3 s),
  picks the point whose map id is the next leg, clicks it, waits for the client's `0x3F` (10 s,
  three tries), and then for the map change (15 s; a map may need a download). A pane that does
  not open, or a click the client never answers, is a stall, as a warp that does not fire is. A
  `prompt` hop presses Space. Every step keeps the step-and-confirm rule.
- **A latent walker loop is fixed on the way.** A warp tile learned as blocked after `MAX_STALLS`
  was still chosen as the goal when the character stood on it, because a path of no steps is the
  shortest path. The goal search now skips a learned-blocked tile, so a warp that never fires ends
  as `blocked` rather than never.

Proven with no game: the graph routes 136 -> 500 -> 3006 -> 3014 -> 502 with the hop on the 3006
leg, and the walker crosses a fake pane by the wire's point, by the fallback pixel, and stops when
the pane never opens or the global stop is set.

## The live check of 2026-09-21, read from the session log and the recording

Three walks: Rucesion Inn to Abel Outskirts, Inn to Rucesion Town Hall, and Town Hall to Inn.

- **The gesture works, and the wire proves it.** From Loures the walker clicked Piet (299, 189)
  and from Piet it clicked Pravat Cave (279, 138); the recording shows the client's `0x3F` for
  each and the `0x15` after it. The `0x3F` came about **7 s** after the click, not the 0.5 to 4 s
  the client docs derive, so the wait after a click is 10 s.
- **The Abel click from Rucesion missed, twice.** The pane listed `Abel (307, 77) -> 502`, the
  walker clicked exactly there, and the client sent no `0x3F` at all. Sabrael's own click on the
  same label at the same wire position, later in the session, worked. The `field001.txt` in this
  client is empty, so every point is a text point drawn at the wire position: the position was
  right. The one difference from DA Walker's gesture was a 60 to 90 ms hold between button-down and
  button-up, copied from the key hold. The pane selects on the release over the point, and a real
  `WM_MOUSEMOVE` from the physical mouse inside that hold moves the pointer off the label before
  the release. The click is now posted down-and-up with no hold, as DA Walker posts it. **This is
  the fix under test in the next live check.**
- **The walker now verifies a click from the wire.** `model/fieldMap.ts` keeps the client's `0x3F`
  on the pane state; after a click the walker waits for it, and a click with no answer is retried
  (three tries) before the tile counts as a stall. It also writes the pane's full point list to the
  log once per open, so a failed hop can be read without the recording.
- **The second live check found the real cause: Windows display scaling.** With the atomic click
  the walker clicked Abel at the wire's (307, 77) and the client sent nothing; Sabrael's own release
  on the same label was seen by the pane watcher at **(459, 115)** — 1.5 x the wire on both axes.
  The desktop is at 150 %, the game window is 960 x 720, and the client stretches its 640 x 480 to
  fill it, so a posted (307, 77) lands on nothing. The fix: `da-pcap clientSize(handle)` reads the
  client area and whether the window is DPI-aware (`GetWindowDpiAwarenessContext`), and
  `actionLayer.click` takes game coordinates and scales them to that size. The third run proved
  the awareness does not change the rule: the window is DPI-unaware (Windows does the stretching),
  the unscaled (307, 77) missed again, and Sabrael's release at physical (456, 108) = game
  (304, 72) hit. So Windows translates the coordinates of a message posted from a DPI-aware
  process (Midir) into the unaware window's space, and the physical size is the right space for
  both kinds of window. The awareness is read and logged, not acted on. The earlier session's
  Piet and Pravat clicks worked because the window was 640 x 480 then. The button hold was a red
  herring; the atomic click stays because it is DA Walker's gesture and costs nothing.
- **A hand click is now written down.** The wire says which point a click selected but not where
  on the screen it was, so `main/paneWatcher.ts` reads the real pointer and button through the
  operating system (`da-pcap pointerIn`: `GetCursorPos`, `ScreenToClient`, `GetAsyncKeyState`;
  never the client's memory) while a pane is open, logs each release with the point nearest it,
  and pairs it with the `0x3F` the client sends after. A posted click moves nothing there, so only
  Sabrael's own clicks appear. When the walker's click misses and Sabrael takes over, the log then
  says exactly where the point was.
- **The `.dat` is a tile off in Rucesion Commons.** Standing on its `(1, 9)` for the way to
  Rucesion Village Way did nothing; the warp fired one tile further west, at `(0, 9)`, after
  Sabrael stepped there by hand. The way to the Town Hall fired one tile short of its `(5, 6)`, on
  the step onto `(4, 6)`. And the Village Way's warp to Rucesion fired at `(16, 15)`, two tiles
  from its `(14, 15)`. Two answers: `scripts/worldmap-overrides.json` now carries these three
  corrections with the observation behind each, and the importer applies them (the `.dat` is not
  edited); and the walker, on a warp tile that does not fire within 2.5 s, **steps one tile further
  the way it came** before counting a stall, and logs the real tile when that fires. A warp that
  fires short of the graph's tile is logged the same way. Both are the seed of WP29.

## What is left

1. **A walk to a tile, watched (hand to Sabrael).** `Rucesion Bank @ 5,8` from the Inn: the walk
   should end on the counter tile with no hand.
2. **A wire sighting of the three other-town banks.** Piet, Abel, and Undine banks and Piet
   Village came from the Hybrasyl world xml (`world/xml/maps/.ignore/Old*.xml`). Sabrael's word is
   that the `Old*` set is spot-on for retail, and it agrees with the `.dat` on every warp both
   describe. One walk into each with Midir recording confirms the door and the arrival on the wire;
   it is a confirmation, not a doubt. The same set carries warps and NPC tiles for the whole retail
   world, which makes it the better source for the graph than the `.dat` — that is WP24's job, and
   its doc now names the set.
3. **The game's names beside the `.dat`'s.** The graph calls 3014 "Abel Outskirts" and the game
   calls it Abel Port Way; 500 is "Mileth Altar" and Mileth Village; 3006 is "MilethEnt". Midir
   decodes every map name off the wire (`0x15`), so a name table learned from play, with both names
   resolving on the Walker tab, is the fix. The `.dat` names stay, because the errands and the
   pins name them.

Done in PR2, from Sabrael's captures of 2026-09-21: **the Mileth and Rucesion interiors.** An
interior is an ordinary map, so each is a node with its exits, under `nodes` in
`scripts/worldmap-overrides.json` with its arrival tile and the observation. Mileth Town Hall
(3026), Mileth Tavern (134), and Mileth Commons (3025, on the way to the Town Hall) were not in the
`.dat` at all; the town-side doors (Tavern 69,53–54; Commons from Village Way 12–15,0; Town Hall
from Commons 4,6) and the warp strips of Rucesion and Mileth came from the same lists. The stand
tile in front of each NPC went on the errands as `standTile`. Piet Village (501) and the Piet, Abel,
and Undine storages (148, 167, 432) came from the Hybrasyl world xml, with the same 12 x 12 room and
the NPC on the same tile as Rucesion's, so Rucesion's stand tile carries over. Cassidy turned out to
be in Mileth Bank, not Rucesion's; her errand now says so. Every built-in errand's destination
resolves and routes.

Also done in PR2: **an arrival tile the user can enter.** `Place @ x,y` on the Walker tab walks to the
place and then onto the tile; `parseDestination` in `shared/` splits it, so a pinned destination
carries its tile as text. `WalkRequest.arrive` is `'on'` for a spot to stand on and `'beside'` for
an NPC's own tile (the Laborer's `npcTile`); an errand's `standTile` uses `'on'`. A click on the
map to pick a tile is WP30's, when the map viewer exists.

## Non-goals

- **No hand-editing `worldmap.json`.** It is generated; fix the importer or the source and re-import
  (WP15 decision 1).
- **No routing into a building the world does not connect.** If a building has no warp, that is a
  world fact, not a bug to route around.
- **No ship or caravan.** A `dialog` hop is an NPC conversation, which is the Laborer's shape, not
  the walker's.
- **No forged `0x3F`.** The click is posted to the window; the client builds the packet.

## Acceptance criteria

1. Every built-in errand's `destination` resolves to a route. **(Met in PR2, by a test.)**
2. A same-town errand (Mileth Tavern) and a cross-town errand (Abel Bank) each arrive at the building
   in a replay or a live check, the cross-town one crossing the world map.
3. The importer still reports its coverage, and no existing node is lost. **(Met in PR1.)**
4. The world-map hop clicks the point the wire names for the next map, falls back to the imported
   pixel only when the pane has no such point, and stops when the pane does not open. **(Met in PR1
   with no game; the live click is the GUI check.)**
