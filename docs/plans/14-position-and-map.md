# WP14 — position and map, off the wire

**Size:** M. **Depends on:** WP2. Read `00-overview.md` first. **PLANNED.**

## Goal

Know where the character is standing, and on which map, from the packets alone. This is the WP that
lets Midir replace DA Walker's `ReadProcessMemory` with a decoder, and it is worth building on its
own even if the walker never ships: "which map, which tile, since when" is the first thing every
later assistant asks.

## Why this is not a memory read

DA Walker resolves the map number and the coordinates through a pointer chain in `DAData.xml`
(`<MapNum o1="26C">00882E68</MapNum>`, `<Coords o1="238" size="4">00882E68</Coords>`). That works
until the client is rebuilt, and it needs `OpenProcess` on a running game. **The same facts are on
the wire**, and the document repo already describes them:

| Opcode | Page                                  | What it gives               |
| ------ | ------------------------------------- | --------------------------- |
| `0x04` | `server/0x04-location.md`             | the player's own position   |
| `0x0B` | `server/0x0B-user-move.md`            | a move the server confirms  |
| `0x15` | `server/0x15-map-info.md`             | the map's identity and size |
| `0x67` | `server/0x67-map-change-pending.md`   | a map change starting       |
| `0x1F` | `server/0x1F-map-change-completed.md` | a map change finished       |
| `0x3C` | `server/0x3C-map-data.md`             | the map's tile data         |
| `0x58` | `server/0x58-map-load-complete.md`    | the client is done loading  |

`ServerOpcode.UserPosition` is already named in `opcodes.ts` with **no decoder behind it**, which is
where this starts.

## The one way to get this wrong

**The client moves before the server confirms it.** The player walks, the client draws the step
immediately and sends `CWalk 0x06`, and the server answers — sometimes with a correction. A position
that only updates on the server's word lags every step; a position that only follows the client's
own packets drifts through every refusal (a wall, a door, a freeze). Midir sees **both directions**,
so it can do what the client does: step on the client's own walk, and snap to the server whenever
the server speaks. Anything else will send the walker into a wall and blame the pathfinder.

## Decisions

1. **The position is a reducer, beside the character reducer, and just as pure.** `(state, packet)`
   in, `{ mapId, x, y, facing, asOfMs, confidence }` out.
2. **`confidence` is a field, not a comment.** `confirmed` when the server just spoke, `predicted`
   when only the client's own walk has moved it, `unknown` after a gap or before the first `0x15`.
   The walker refuses to step on `unknown` and re-syncs instead.
3. **A map change clears the position rather than guessing it.** `0x67` sets `unknown`; the `0x15`
   that follows sets the new map; the first `0x04` confirms the tile.
4. **Position belongs to a connection, like everything else** (WP10's rule). Two clients means two
   positions.
5. **It is not persisted.** Where a character stood is a live fact, not a record. `CharacterRecord`
   does not grow a position field — that would be a stale answer with a confident face on it.
6. **Map tile data (`0x3C`) is decoded only if the walker needs it.** Walking a route between warps
   may not need to know which tiles are passable; the world map graph might be enough. Decide with
   WP15 in hand, and do not decode a large structure speculatively.

## Non-goals (stop-lines)

- **No memory reads.** The whole point.
- **No other entity's position.** Where the player is standing, not where anyone else is. The mob
  and player positions on screen are a different feature and a much larger surface.
- **No map rendering, no minimap, no tile art.** That is a client, not a companion app.
- **No persistence.**

## Current state when you start

- [opcodes.ts:74](../../src/main/protocol/opcodes.ts#L74) — `UserPosition: 0x04`, named and
  undecoded.
- [decode/index.ts](../../src/main/protocol/decode/index.ts) — the `DECODERS` map to register into,
  and the `DecodedPacket` union to extend.
- [model/character.ts](../../src/main/model/character.ts) — the reducer to copy the shape of, not to
  extend. This is a second reducer over the same packet stream.
- [captureService.ts](../../src/main/captureService.ts) — where a per-connection position state
  would live, next to `sessions`.
- Both protocol sources describe these opcodes; read both, as always.

## Contracts

```ts
export interface Position {
  mapId: number
  mapName?: string
  x: number
  y: number
  facing: number
  /** Capture time of the packet that last moved it. */
  asOfMs: number
  confidence: 'confirmed' | 'predicted' | 'unknown'
}

export function reducePosition(state: Position | null, input: ReducerInput): Position | null
```

`CaptureStatus` gains nothing. The position reaches the renderer only when an assistant needs to
show it.

## Acceptance criteria

1. A recorded session yields a position that tracks the character across a walk, and the map name
   changes when the character changes map.
2. A client-side step moves the position to `predicted`; the next server word makes it `confirmed`.
3. A server correction that disagrees with the prediction wins, without a jump the walker cannot
   handle.
4. A TCP gap sets `unknown`, and nothing reports a position until the next confirmation.
5. Two connections keep two positions.
6. Nothing is written to `CharacterRecord`.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests over decoded-packet literals for each transition, including the correction and the
   gap.
3. **A replay of a real recording that contains a walk**, asserting the position track. The
   recordings from 2026-07-23 contain map changes and movement, so this needs no new capture.
