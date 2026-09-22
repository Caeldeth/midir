# WP35 — right-click walking

**Size:** M. **Depends on:** WP15 (the walker), WP13 (the action layer), WP33 (the click gesture).
Read `00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-468`.

**Built 2026-09-21; the live check is what is left.** The walker hands a stretch of up to eight
tiles to the client with one right-click (`clickStretch` in `walker.ts`), confirms each tile off
the wire, and re-plans from wherever the client stops. The action layer's `rightClick` posts one
press and waits out the client's double-click window before a second, so the double is impossible
by construction. What stands on the map comes from three new decodes (`decode/world.ts`) and a
reducer (`model/entities.ts`), so a click never aims at a taken tile. The setting is
`walkerRightClick`, off by default, on the Walker page.

**Trigger:** Sabrael's observation in the WP33 live check of 2026-09-21: the arrow-key walk is
choppy. One held key per tile, with a turn-then-move press before each change of direction and a
settle after each landed step, is a stutter the client's own click-to-move does not have.

## Goal

Let the walker hand a stretch of the walk to the client's own pathfinder: one right-click on a tile
ahead, and the client plans and walks the tiles itself. The walker still confirms every tile off the
wire and re-plans from where the character actually is, so the step-and-confirm rule of WP15
survives; only the step gets bigger. The arrow keys stay as the fallback and for the last tiles
beside an NPC.

## What the client does with a right-click (read from darkages-741-re)

`systems/pathfinding-and-pursuit.md` and `systems/world-interactions.md` describe it from the binary:

- **Empty ground with the right button starts local click-to-move.** The client runs a
  breadth-first search over its own collision view and sends the ordinary `CWalk 0x06` steps. The
  server is not asked for a path. The walker sees each step as it sees a key press now: the client's
  predicted step, then the server's `0x0B`.
- **There is no distance limit in the search.** The limit is the collision view: the client's BFS
  sees only the static walls already materialized for the current viewport, so a long click can plan
  through an off-screen wall and then **strand** silently when the step reaches it (the client
  neither retries nor re-plans a ground route). The doc's own advice is "shorter right-clicks, and
  click again after the camera moves". Sabrael's memory of "about 10 tiles" is this limit seen from
  the outside: the visible diamond is roughly 11 tiles across and 17 down at 56 x 27 pixels per tile.
- **A warp tile is not an obstacle to the client's planner.** A route can cross one by accident.
  The walker's per-map legs already end on the warp tile, so a click never aims past it.
- **A stranded route does nothing until the next input.** A new click, a key, or a map change resets
  it. For the walker that is the normal case: no progress within the confirm window means click
  again from where the character is.
- **A living entity under the pointer takes the click.** A single right press on a creature or a
  player does not walk. A **double right press on a creature or a player is pursue-and-attack**:
  the client walks beside the target and attacks it. This is the one thing the feature must make
  impossible by construction, not by care.

## The tile-to-pixel projection

A right-click needs the screen position of a tile. The client centres the view on the player and
draws an isometric 56 x 27 tile footprint (`rendering/ui-composition.md`), so a tile at `(dx, dy)`
from the player's tile is at about:

```text
screenX = centerX + (dx - dy) * 28
screenY = centerY + (dx + dy) * 13.5
```

These are game coordinates, in the 640 x 480 the client draws at; the action layer scales them to
the real window (WP33 found a 960 x 720 window under Windows display scaling), so the walker never
scales itself. `centerX`, `centerY` is the view centre, which depends on the UI layout: DA Walker clicks "self" at
(311, 145) in the normal layout and 30 pixels lower in its "mini mode", and `render_world_apply_view_layout`
moves the centre when the lower tray changes. The spike verifies the centre per layout, the sign of
each axis, and the half-tile rounding, against a live client: click a tile at a known offset and read
the `0x06` the client sends.

## Decisions

1. **Never two right presses close together.** The action layer's right-click gesture posts one
   press and release, and the walker never posts a second right-click within the system
   double-click time plus a margin (`GetDoubleClickTime()` defaults to 500 ms; use 700). This makes
   pursue-and-attack impossible by construction, whatever is under the pointer. **Taken, with the
   client's own number:** the client synthesises its double itself, from a second right press under
   1000 ms after the last and within 2 px (darkages-741-re `systems/events.md`), not from
   Windows' double-click time. `RIGHT_CLICK_GAP_MS` is 1500, and the gap is enforced inside
   `actionLayer.rightClick`, which waits out the rest of it before posting, so no caller can make a
   double however fast it asks.
2. **Aim only at a tile known to be empty.** A tile with a player or an NPC on it (from
   `SDrawHumanObjects 0x33`, which Midir decodes) is never a target. Creatures arrive as
   `SAddWorldObject 0x07`, which Midir does not decode yet; the spike adds that decode, or the walker
   aims one tile short of any unknown occupant. Aiming at empty ground is what makes the single
   right-click a walk and nothing else. **Taken, with the decode:** `decode/world.ts` reads `0x07`
   (the document repo's binary-verified layout, run over every recording on disk with no failure:
   3760 packets, batches of up to 152 objects), `0x0C` (another creature's step) and `0x0E` (a
   remove); `model/entities.ts` keeps what stands where, cleared on a new map and on a loss, with
   the character's own `0x33` kept apart by name. A player, an NPC, and a type-0 monster are solid;
   a type-1 monster and an item are not. The click's prefix stops before the first solid tile.
3. **Short stretches, inside the view.** A click aims at most `RIGHT_CLICK_RANGE` tiles along the
   A* path (start at 8), and never past a tile A* cannot see as open, so the client's unseen-wall
   problem does not arise: everything the walker asks for is on screen and in the walker's own
   collision view from the map file. **Taken.** The prefix also stops before every warp tile the
   graph knows on the map, so a click never changes the map and the step onto a warp keeps the key
   walk's own handling (the gate refusal, the one-tile-beyond probe, the hop). Fewer than two steps
   is left to the keys.
4. **Confirm as now.** After a click the walker watches the position. Progress along the path is
   the client walking; no progress within a confirm window is a strand, and the walker clicks again
   from the current tile, then falls back to the keys after a few strands at the same tile. The
   existing stall, block, and unexpected-map rules stay as they are. **Taken, with one change:**
   the client's route is its own, so progress is any move on the same map, not a move in a
   direction the walker chose (the client may take another shortest way, and under lag several of
   its steps confirm at once). A stretch that stops short re-plans from where it is. A click that
   moves nothing within 2 s is a strand; after two in a row the keys take the next three landed
   steps, because the client's planner does not see the creature the walker learned to route
   around and its first choice of route can cross that tile from every nearby start. A popup is
   checked before a miss counts as a strand, as for a stall. A map change under the walk to the
   leg's own destination is arrival; to any other map it stops as `lostPosition`.
5. **Keys for the last tiles.** The approach to the tile beside an NPC (`approachTile`) stays on the
   arrow keys, one tile at a time. It is short, and it is where a stray click would matter most.
6. **The projection is data, checked live.** The view centre per layout and the tile size are
   constants in one place, with the spike's measured values and how they were measured.
7. **A setting, off by default,** like every driving feature. The keys remain the shipped default
   until the live check proves the click on more than one map. **Taken:** `walkerRightClick`, a
   switch on the Walker page. The walker reads it at every step.

8. **A stop halts Midir at once; the client finishes the stretch.** A right-click hands the client
   a route, and Midir posts nothing to cancel it: the stop is a promise about Midir, and the
   character walks the rest of the stretch it was given, at most eight tiles, on empty ground short
   of every warp. The setting's own help text says so.

## Non-goals

- **No double-right-click, ever.** Pursuit and attack are not walking.
- **No targeting of anything alive.** The feature walks to ground.
- **No client patch** for the stranding or the unseen-wall problem. The walker works around them by
  clicking short and clicking again; darkages-741-re's runtime patches are not Midir's to apply.
- **No cross-map click.** A leg still ends on the warp tile, and the hop logic of WP33 is unchanged.

## Contracts

```ts
/** Post one right press and release at a game-coordinate position, never within the gap of the last. */
rightClick(target: ActionTarget, x: number, y: number): Promise<ActionRefusal | null>

/** The screen point of a tile's ground, seen from the player's tile (laborer/view.ts). */
function groundPoint(own: Tile, tile: Tile): Point
/** The inverse, for reading a hand right-click. */
function tileAtPoint(own: Tile, point: Point): Tile
```

`WalkerOptions` gains `mode: () => 'keys' | 'rightClick'`, from the setting, and `entitiesFor`.
The projection is WP17's `VIEW_CENTRE` (312, 199), measured from a hand click on Eduardo, and not
a per-layout table: the minimal layout is unmeasured and the walker does not detect it. The pane
watcher logs every hand right-click on the world with the tile the projection names and the tile
the character then stops on, so a drift or the other layout shows up in the log.

## Current state when you start

- `actionLayer.ts` — `click` posts a left move and press; the right-button messages are
  `WM_RBUTTONDOWN 0x0204` and `WM_RBUTTONUP 0x0205`, same lParam packing.
- `walker.ts` — `runLoop` plans one A* path per iteration and presses one key. The right-click mode
  takes the first `RIGHT_CLICK_RANGE` steps of that path and clicks the last of them.
- `route/mapGrid.ts` — the walker's own collision view, from the map file, complete for the map.
- `protocol/decode/character.ts` — `decodeDrawHumanObjects` for the players and NPCs on screen.
- The da-tools decompile — `DAMacCore.ClickDAMouse` with `M_TGTSELF` for DA Walker's view centre.

## Acceptance criteria

1. A right-click at a tile eight steps along an open corridor walks the character there, confirmed
   tile by tile off the wire, with no key pressed. **Unit test passes** (`walker.test.ts`, "walker
   by right-click"): one click at (8,0), one key for the warp step.
2. A route through a door or a creature strands, and the walker recovers by clicking again or by
   falling back to the keys, and arrives. **Unit test passes**: a creature the map does not know
   strands the stretch, two re-clicks strand, the keys learn the tile, and the click resumes.
3. No two right presses are ever posted within the double-click time, in the tests and in the log.
   **Unit tests pass** (`actionLayer.test.ts`: the gap is waited out, and a stop during the wait is
   honoured; `walker.test.ts`: every gap in a strand-heavy walk clears it). The log line for each
   right press states the gap since the last.
4. The walker never aims at a tile with a player or an NPC on it. **Unit test passes.**
5. The mode is off by default and the arrow-key walk is unchanged when it is off. **Unit tests
   pass**, and the whole walker suite runs unchanged with the mode off.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`. **Passes** (1013 tests).
2. The walker tests gain a right-click mode against the fake world: the stretch, the strand and
   re-click, the fallback, the occupied-tile refusal, and the minimum gap between right presses.
   **Done**, plus the popup mid-stretch, the stop mid-stretch, the unexpected map, and the approach
   beside an NPC staying on the keys.
3. **The spike (hand to Sabrael):** with the game running and Midir capturing, right-click a tile
   by hand a few tiles from the character and read the pane watcher's two lines in the log: the
   tile the projection names for the click, and the tile the character stopped on. They agree when
   the projection is right. Then turn the setting on and walk one route across Rucesion, and read
   the walker's lines: each right-click names its aim and its game coordinates, each stretch says
   how many tiles it walked, and each right press states the gap since the last.
