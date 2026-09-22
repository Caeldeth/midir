# WP29 — learn map transitions from the wire

**Size:** M. **Depends on:** WP14 (position and map, off the wire). Read `00-overview.md` first.
**COMPLETE 2026-09-22.** **Card:** `HTOO-78`.
**Trigger to start:** the imported `WorldMap.dat` graph proves stale in play, or a want to let the
wire verify and extend the graph without a hand edit. Fired 2026-09-21: the live check found three
tiles the `.dat` had wrong in one evening (HTOO-82).

**What shipped.** `model/transitions.ts`, a third reducer beside the character and the position,
watches each connection's walks and answers at every map change whether a step caused it. The
rule is what 339 walk-warps in the recordings look like: the step's `CWalk 0x06`, the empty
`0x32` that acknowledges it, then `0x15` and `0x04` — and **no `SMove 0x0B` for the step that
warps**, because the map change is that step's reply. So the origin is the last confirmed tile plus
the oldest unanswered step (two are often in flight; the server answers in order), and a teleport,
a death, or a dialog warp has every step answered and nothing to learn from. Belt and braces: the
step must be acknowledged, a spell, item, skill, or dialog answer (`0x0F`, `0x1C`, `0x3E`, now
decoded to their slot; `0x39`, `0x3A`) inside 2 s drops the candidate, and a loss forgets the
step. A world-map hop is learned too, with the pane's point for the map the client clicked, so the
walker can use it. `store/transitionStore.ts` keeps `transitions.json`: one record per edge with
its count, arrival, and times; an edge enters the graph at two crossings, and **one plain tile
promotes one destination, the one seen most** — the Rucesion Village Way tile (23,11) went to the
Commons 45 times and, twice, after a notice, to map 3079: a gate's bounce, not a door.
`route/graph.ts` `mergeLearned` lays the learned edges (`source: 'learned'`), the wire's map
names (`gameName`) and sizes over the imported nodes, and `route/liveGraph.ts` rebuilds the graph
the walker, the Laborer, and the Map tab hold whenever either store is written, so a warp learned
this session is on the next plan. Both names resolve on the Walker tab and the game's shows first.
The Map tab draws a learned warp in its own colour and says how often the wire saw it.

**Verified over every recording** (44 files, 2026-07-23 to 2026-09-22, the opt-in
`transitions.recordings.test.ts` under `MIDIR_RECORDINGS`): 110 edges learned, 77 tile for tile
what the graph holds, 4 beside an authored strip, 16 pairs the `.dat` lacks, 13 maps it does not
know, none more than two tiles from an authored tile of the same pair. One finding went back into
the imported layer: the Rucesion Town Hall door is two tiles, (4,6) and (5,6), and the override of
2026-09-21 had kept only the first.

**Also to learn, noted by WP33 (2026-09-21):** the game's map names. The graph's names come from
DA Walker's `.dat` ("Abel Outskirts", "Mileth Altar", "MilethEnt"); the game's are on every
`SMapInfo 0x15` ("Abel Port Way", "Mileth Village"). A name table learned from play, with both
names resolving on the Walker tab and the game's shown first, is the same shape as a learned edge:
provenance on the record, the `.dat` name kept because the errands and the pins use it.

## Goal

Learn warp edges from real play, off the wire, and use them to correct and extend the walker's route
graph. `WorldMap.dat` is hand-made and only as current as whoever last walked the world (WP15). Midir
already decodes the position and every map change, so it can watch a real session and infer the
edge — a tile on one map that warps to another — that a walk just used. This is the wire proving the
graph, made generative, and it is the first of the three sources that feed one graph (the imported
`.dat`, this, and the ceridwen import of WP24).

## The one way to get this wrong

**Learning a teleport as a walk.** A spell (dachaidh, teleport), an item (a song, an ant tunnel
scroll), a ranger or GM effect (send home, teleport), a death, or a trap all change the map without a
walk, and an edge learned from one is a lie the walker would later step into.

The fix is a **positive rule, not a list of exclusions to keep current.** Learn an edge only when the
map change was immediately preceded by the player's own confirmed walk onto the origin tile, with no
gap. A teleport moves the character from wherever they stood, with no walk step onto an edge tile
first, so every case above fails the rule by construction. The list of teleport sources never has to
be complete.

## Decisions

1. **Learn only walk-caused transitions.** The last position event before the new `SMapSize 0x15`
   must be the player's own step (`CWalk 0x06` / `SMove 0x0B`). The origin tile is the last confirmed
   tile plus the last walk delta — the tile the player stepped onto. This is the walker's own warp
   logic in reverse (WP15).
2. **The arrival tile is the first `SUserPosition 0x04` on the new map.** That is the coordinate the
   `WorldMap.dat` header stores, so a learned edge carries an arrival tile the walker can steer to
   later (and WP17 can use).
3. **Exclude by construction, then belt-and-suspenders.** The positive rule already drops teleports.
   Also drop a candidate when a spell, item, or skill-use client opcode was seen in the window before
   the change, or when a TCP gap makes the position doubtful. Midir does not need to decode those
   packets: the opcode is in the clear, the same key-free spotting `capture/scrub.ts` already does.
4. **Promote on repetition.** A learned edge is a candidate until it is observed K times; one flukey
   observation does not enter the graph. Store the observation count and the last-seen capture time,
   the same "as of / seen N times" honesty the bank uses (WP9).
5. **Provenance is a field.** Every edge in the merged graph is `authored` (from `WorldMap.dat`),
   `learned` (from the wire), or later `ceridwen`. Learned edges are stored on their own and merged
   into the graph; the wire can confirm an authored edge or add one the `.dat` lacks. It never
   silently overwrites the imported file.
6. **Passive only, and pure where it can be.** This reads the wire and drives nothing, so it is
   inside the read charter. The learner is an observer over the same decoded-packet and position
   stream WP14 already produces; it adds no capture path. The decision logic is pure and testable
   from a recorded session.

## Non-goals (stop-lines)

- **No editing the imported `WorldMap.dat`.** Learned edges live in their own store with provenance;
  the hand-made file stays the hand-made file.
- **No within-map learning.** A door or a step inside one map is not a map change and is not an edge.
- **No dialog or scripted warps.** A warp driven by an NPC menu (`0x39`) or a script is not a
  walk-caused transition and is not learned here.
- **No guessing the destination beyond the first `0x04`.** The arrival tile is what the wire says, or
  it is absent.
- **No driving.** This feature only reads.

## Current state when you start

- [protocol/decode/movement.ts](../../../src/main/protocol/decode/movement.ts) — `0x06`, `0x0B`,
  `0x15`, and `0x04` are decoded, with the direction deltas.
- [model/position.ts](../../../src/main/model/position.ts) — the position reducer, which already tracks
  the confirmed tile, the map, and the `unknown` state after a gap or a map change.
- [captureService.ts](../../../src/main/captureService.ts) — the per-connection position and the packet
  stream to observe.
- [route/graph.ts](../../../src/main/route/graph.ts) — the graph the learned edges merge into.
- [protocol/opcodes.ts](../../../src/main/protocol/opcodes.ts) — where the spell, item, and skill-use
  client opcodes are named, or added, for the exclusion check. Read both protocol sources for them.

## Contracts

```ts
export interface LearnedEdge {
  fromMapId: number
  /** The tile on fromMap the player stepped onto to warp. */
  x: number
  y: number
  toMapId: number
  /** The first confirmed tile on the destination map, when the wire gave one. */
  arrivalX?: number
  arrivalY?: number
  /** How many times this edge was observed as a clean walk-warp. */
  observations: number
  /** Capture time of the first and the last observation. */
  firstSeenMs: number
  lastSeenMs: number
}

/** Provenance rides on the graph edge once learned and authored edges merge. */
export type EdgeSource = 'authored' | 'learned' | 'ceridwen'
```

The learner is an observer over the position and packet stream; its store is a crash-safe JSON file
beside the settings, and the graph gains a merge that carries `EdgeSource`.

## Acceptance criteria

1. A recorded walk-warp produces a candidate edge with the right origin tile and the right
   destination map.
2. A map change caused by a spell or an item in the same recording produces no edge.
3. A candidate is promoted into the graph only after K observations.
4. A TCP gap before a map change suppresses the candidate.
5. A learned edge carries the arrival tile when the wire gave a first `0x04` on the new map.
6. The merged graph reports each edge's source, and a learned edge never overwrites the imported
   file.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. **The learner is pure and gets the heaviest tests:** decoded-packet sequences for the clean
   walk-warp, the spell-then-warp, the item-then-warp, the gap-then-warp, and the promotion count.
3. **A replay of a real recording that contains a walk-warp**, asserting the learned edge matches the
   `WorldMap.dat` edge for that map. The 2026-07-23 recordings contain map changes and movement, so
   this needs no new capture.
