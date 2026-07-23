# WP15 — Walker

**Size:** L. **Depends on:** WP13 (the action layer) and WP14 (where the character is). Read
`00-overview.md` first. **PLANNED.**

## Goal

Replace DA Walker: name a place, and the character walks there, across maps, by the route the world
allows. It is the largest assistant and the one WP17 is built on.

## What the legacy tool is, and what we keep

`DAWalker.exe` is two things worth taking and one worth dropping:

- **Keep the route graph.** `WorldMap.dat` is a text file of nodes: a map id, a name, and for each
  neighbour the destination map and the tile that warps to it. It is a hand-built map of how the
  world connects, and it is the expensive part — years of somebody walking the world. Import it for
  now; do not rebuild it by hand. **It may be reconstructable later — see the note below** — but
  that is a future improvement, not a reason to delay this WP.
- **Keep the shape of the search.** `InitDistRouteTables`, `BPath`, `FindAndMoveToClosest`,
  `doorWalk` — an all-pairs table over the map graph, then a walk within each map.
- **Drop the memory reads.** `MapNum`, `Coords` and the rest of the pointer table are WP14 now.

## The route graph may be reconstructable from ceridwen (future)

`WorldMap.dat` is hand-made, which makes it both valuable and stale-prone: it is only as current as
whoever last walked the world. **Ceridwen already holds the same graph as authored data.** Each map
XML carries its warps as source:

```xml
<Warp X="11" Y="5"><MapTarget X="2" Y="7">Path Temple 6</MapTarget></Warp>
```

That is a node (the map), an edge (the warp tile), and its destination — the exact structure the
`.dat` encodes — and the map XML also carries NPC positions (`<Npc Name="Donnan" X="2" Y="5"/>`),
which is what WP17's "walk to Antonio" needs and `WorldMap.dat` does not have at all. 231 maps, 80
with warps, in `Repos/ceridwen/xml/maps/`.

**The catch, and why this is a note and not the plan:** ceridwen is **Hybrasyl** world data, and
Midir is retail-only (settled decision 5). The two worlds are close but not proven identical — map
ids and warp layouts can differ — so a ceridwen-built graph is a reconstruction to **verify against
retail**, not a drop-in. It would need either a retail↔ceridwen map-id correspondence, or checking
against the positions WP14 reads off the wire on a real retail session.

So: ship WP15 on the imported `WorldMap.dat`. Treat a ceridwen-derived graph as a later WP that
earns its place when the hand-made graph goes stale or when WP17 wants NPC coordinates the `.dat`
cannot give. Recorded in `00a-backlog.md`.

## The one way to get this wrong

**Open-loop walking.** The legacy tool presses a direction and assumes the step happened. Every
failure mode of a walker is the same failure: the step did not happen, and the walker keeps
counting. A wall, a door that needs opening, a freeze, a monster in the way, a lag spike — all of
them look identical to a walker that does not read.

Midir does read. **Every step is a step-and-confirm**: post the key, wait for WP14 to move the
position, and re-plan when it does not. Steps that do not land are the normal case, not the error
case, and a walker that treats them as errors will stop constantly.

Corollary: **never chain more keys than the confirmations you have.** The temptation to buffer six
steps for smoothness is what turns a missed step into a walker embedded in a wall.

## Decisions

1. **The route graph is data, imported once, and versioned in the repo** — converted from
   `WorldMap.dat` to JSON at import time, not parsed at runtime. Keep a note of where it came from.
2. **Two levels of planning, as the legacy tool has.** Between maps: a search over the graph, giving
   a list of warps to take. Within a map: walk to the next warp's tile. They fail differently and
   are debugged differently, so they stay separate.
3. **Step, confirm, re-plan.** One key, one confirmation from WP14, then decide again. A step that
   does not confirm within a timeout is a re-plan, not a retry, and three re-plans in the same place
   is a stop with a reason.
4. **`confidence` gates everything.** The walker does not move while the position is `unknown`; it
   waits for a confirmation or gives up. WP14 exists to make this decidable.
5. **It stops for the world, not just for the user.** Losing the character, a map change it did not
   ask for, or a position that jumps further than one step, all stop it. Something else is moving
   the character, and a walker that argues with it is a walker that walks into the sea.
6. **Doors are a known special case** (`doorWalk` in the legacy tool). Model them explicitly; do not
   let them look like a failed step.
7. **The destination is a place, not a coordinate.** "Antonio", "the Mileth bank" — a named node in
   the graph. Tiles are how it gets there, not how it is asked.

## Non-goals (stop-lines)

- **No combat, no looting, no targeting.** Movement only. This is the line that keeps a walker a
  walker.
- **No packet-sent movement.** Walking is the case where posted keys are perfectly adequate, and a
  forged walk packet is both harder and the most visible thing on the wire. WP18 is not for this.
- **No map exploration or graph learning.** The graph is data the user imports and can edit; the
  walker does not go looking.
- **No unattended running.** It walks when asked; it does not wait for a schedule. That is a
  different feature with a different risk, and it needs its own decision.
- **No following another player, no "go where my group went".**

## Current state when you start

- `E:\Games\Dark Ages\Walker\WorldMap.dat` — the graph, as CRLF text: `mapId -1 -1 Name`, then per
  neighbour a destination map id and an `x y` warp tile. Roughly 23 KB and hand-made.
- `E:\Games\Dark Ages\Walker\DAData.xml` — the pointer table. Read it once to understand what the
  legacy tool needed, then leave it: WP14 replaces all of it.
- WP13's `ActionLayer` for the keys; WP14's `Position` for the confirmations.
- [main/log.ts](../../src/main/log.ts) — a walker that stops must say why, in the log the user can
  actually send.

## Contracts

```ts
export interface RouteNode {
  mapId: number
  name: string
  /** Where this map warps to, and the tile that does it. */
  exits: { toMapId: number; x: number; y: number }[]
}

export interface WalkRequest {
  connectionId: string
  /** A node name or map id from the graph. */
  destination: string | number
}

export type WalkOutcome =
  | { kind: 'arrived' }
  | { kind: 'stopped'; reason: 'user' | 'lostCharacter' | 'lostPosition' | 'blocked' | 'noRoute' }
```

| Channel        | Shape                                                     |
| -------------- | --------------------------------------------------------- |
| `walker:go`    | `(request: WalkRequest) => Promise<WalkOutcome>`          |
| `walker:stop`  | `(connectionId: string) => Promise<void>`                 |
| `walker:state` | event: `{ connectionId, position, nextWarp, stepsTaken }` |

## Acceptance criteria

1. Asked for a destination on the current map, the character arrives.
2. Asked for a destination two maps away, it takes the warps in order and arrives.
3. A step that does not confirm causes a re-plan, not a stuck walker, and the log says so.
4. Walking into a wall for three attempts stops with `blocked`, in the same place, without thrashing.
5. Being moved by something else (a `0x67` it did not ask for) stops it.
6. The global stop halts it within one step.
7. An unreachable destination fails with `noRoute` before it moves at all.
8. Nothing reads memory, and nothing sends a packet.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. **The planner is pure and gets the heaviest tests**: the graph search over the imported data,
   including no-route, same-map, and multi-warp cases. No game and no action layer needed.
3. The driver against WP13's fake action layer and a scripted WP14 position feed: the confirmed
   step, the missed step, the re-plan, the blocked stop, the external move.
4. GUI (hand to Sabrael, and the only check that proves it): a real client, a destination two maps
   away, and a wall to walk into on purpose.
