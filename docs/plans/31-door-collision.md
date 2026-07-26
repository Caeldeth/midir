# WP31 — dynamic door collision

**Size:** S. **Depends on:** WP15 (the grid and the walker). Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a route the walker needs runs only through a door, or WP17 (Laborer) wants it.

## Goal

Let the walker path through a door it can open. WP15's A* reads the base map cache, where a closed
door is a wall, so the walker routes around a closed door and cannot cross one that is the only way.
The client learns a door opened from `SStaticObjectState 0x32`, which swaps the cell's static tile id
and, with it, its SOTP collision. A live overlay on the base grid lets the walker treat an open door
as open.

## How a door works, off the wire

A door is a static object with two paired tile ids: closed and open. `map_can_move_direction` reads
the object's **current** tile id, not the id stored in the map cache, and applies that id's SOTP
collision. So opening a door is `0x32` swapping the current tile id, which selects both the new art
and the new collision — there is no separate door-collision flag to track. See the document repo and
`darkages-741-re`'s `server/050-0x32-static-object-state.md` and `file-formats/sotp.md`. In retail a
door opens when the player walks up to it, so the walker does not open a door with a special action;
it walks toward the door, the client opens it, `0x32` arrives, and the overlay lets A* re-plan
through.

## Decisions

1. **Decode `SStaticObjectState 0x32`.** It carries the object's tile position and its new tile id.
   Read both protocol sources for the exact wire format, and cite the one that verifies it, as every
   protocol claim does.
2. **Keep a live overlay per connection.** A map of `(mapId, x, y)` to the current static tile id,
   applied over the disk map cache. The base grid is the cache; the overlay is what `0x32` changed
   this session. Two clients keep two overlays, like the position (WP12, WP14).
3. **The pathfinder reads the overlay.** `mapGrid.canMove` takes the current static tile id from the
   overlay when one is present, and from the cache when it is not, then applies the same SOTP rule. A
   door that is open is passable; a door that is closed is a wall, exactly as the client sees it.
4. **The overlay is live, not saved.** It clears on a map change and on a gap, the same rule the
   position runs on. A door state from another map or before a gap is not trusted.

## Non-goals (stop-lines)

- **No opening a door with a forged packet or a special key.** The walker walks toward the door and
  the client opens it. Driving stays keys-only (settled decision 2), and a packet is still gated on
  WP18.
- **No full static-object modelling.** Only the collision the door state changes. The art, the
  animation, and every other static-object use are out of scope.
- **No persistence.** The overlay is a live fact for one session, like the position.

## Current state when you start

- [route/mapGrid.ts](../../src/main/route/mapGrid.ts) — the base collision, which gains an override
  source for the overlay.
- [route/mapSource.ts](../../src/main/route/mapSource.ts) — where the SOTP table already turns a
  static tile id into a collision nibble, ready for the swapped id.
- [protocol/decode/movement.ts](../../src/main/protocol/decode/movement.ts) — the decode module the
  `0x32` decoder sits beside.
- [captureService.ts](../../src/main/captureService.ts) — the per-connection state, where the overlay
  lives beside the position, and the map-change and gap signals that clear it.
- [walker.ts](../../src/main/walker.ts) — the re-plan loop, which already re-runs A* every step and so
  picks up the overlay with no change to its own logic.

## Contracts

```ts
/** SStaticObjectState 0x32 — a static object changed to a new tile id. */
export interface StaticObjectState {
  kind: 'staticObjectState'
  x: number
  y: number
  /** The object's current static tile id, which selects its SOTP collision. */
  tileId: number
}

/** A live overlay of the static tile ids that changed this session, per map. */
export type DoorOverlay = Map<string /* `${mapId}:${x}:${y}` */, number /* tileId */>
```

## Acceptance criteria

1. A closed door blocks A*, so the walker routes around it or stops `blocked` when it is the only way.
2. After a `0x32` opens the door, A* paths through it on the next re-plan.
3. The overlay clears on a map change and on a gap, so a stale door state never misleads the walker.
4. Two clients keep two overlays, and one client's door state never reaches the other.
5. Nothing reads memory, and nothing sends a packet.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the `0x32` decode against wire bytes, and `canMove` over a grid with an overlay that
   opens and closes a door.
3. A replay if a recording with a door open is available; otherwise the unit tests carry it, and the
   live path is handed to Sabrael.
