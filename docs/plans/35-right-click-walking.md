# WP35 — right-click walking

**Size:** M. **Depends on:** WP15 (the walker), WP13 (the action layer), WP33 (the click gesture).
Read `00-overview.md` first. **PLANNED.** **Card:** `HTOO-468`.

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
   pursue-and-attack impossible by construction, whatever is under the pointer.
2. **Aim only at a tile known to be empty.** A tile with a player or an NPC on it (from
   `SDrawHumanObjects 0x33`, which Midir decodes) is never a target. Creatures arrive as
   `SAddWorldObject 0x07`, which Midir does not decode yet; the spike adds that decode, or the walker
   aims one tile short of any unknown occupant. Aiming at empty ground is what makes the single
   right-click a walk and nothing else.
3. **Short stretches, inside the view.** A click aims at most `RIGHT_CLICK_RANGE` tiles along the
   A* path (start at 8), and never past a tile A* cannot see as open, so the client's unseen-wall
   problem does not arise: everything the walker asks for is on screen and in the walker's own
   collision view from the map file.
4. **Confirm as now.** After a click the walker watches the position. Progress along the path is
   the client walking; no progress within a confirm window is a strand, and the walker clicks again
   from the current tile, then falls back to the keys after a few strands at the same tile. The
   existing stall, block, and unexpected-map rules stay as they are.
5. **Keys for the last tiles.** The approach to the tile beside an NPC (`approachTile`) stays on the
   arrow keys, one tile at a time. It is short, and it is where a stray click would matter most.
6. **The projection is data, checked live.** The view centre per layout and the tile size are
   constants in one place, with the spike's measured values and how they were measured.
7. **A setting, off by default,** like every driving feature. The keys remain the shipped default
   until the live check proves the click on more than one map.

## Non-goals

- **No double-right-click, ever.** Pursuit and attack are not walking.
- **No targeting of anything alive.** The feature walks to ground.
- **No client patch** for the stranding or the unseen-wall problem. The walker works around them by
  clicking short and clicking again; darkages-741-re's runtime patches are not Midir's to apply.
- **No cross-map click.** A leg still ends on the warp tile, and the hop logic of WP33 is unchanged.

## Contracts

```ts
/** Post one right press and release at a client-area position. */
rightClick(target: ActionTarget, x: number, y: number): Promise<ActionRefusal | null>

/** The screen position of a tile, given the player's tile and the UI layout. */
function tileToScreen(
  player: { x: number; y: number },
  tile: { x: number; y: number },
  layout: 'normal' | 'minimal'
): { x: number; y: number }
```

`WalkerOptions` gains `mode: 'keys' | 'rightClick'`, from a setting.

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
   tile by tile off the wire, with no key pressed.
2. A route through a door or a creature strands, and the walker recovers by clicking again or by
   falling back to the keys, and arrives.
3. No two right presses are ever posted within the double-click time, in the tests and in the log.
4. The walker never aims at a tile with a player or an NPC on it.
5. The mode is off by default and the arrow-key walk is unchanged when it is off.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. The walker tests gain a right-click mode against the fake world: the stretch, the strand and
   re-click, the fallback, the occupied-tile refusal, and the minimum gap between right presses.
3. **The spike (hand to Sabrael):** with the setting on and one character standing still, click a
   tile at a known offset and read the `0x06` steps in the log to fix the view centre and the axes.
   Then one walk across Rucesion.
