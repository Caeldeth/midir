import type { DecodedPacket } from '../protocol/decode'
import { DIRECTION_DELTA, NONSOLID_MONSTER } from '../protocol/decode'

/**
 * What stands on the map around the character, as the wire draws it.
 *
 * A third reducer beside the position and the dialog, and as pure. The walker
 * reads it for one rule (WP35): a right-click walks only when the tile under
 * the pointer is empty ground. A single right press on a creature or a player
 * does nothing, and a second one close behind it is pursue-and-attack, so the
 * walker never aims at a tile something living stands on. This keeps those
 * tiles.
 *
 * The wire is the client's own view, and this follows it the same way: a
 * thing is on the map from the packet that draws it (SDrawObjects 0x07 for
 * creatures, NPCs, and items; SDrawHumanObjects 0x33 for players and NPCs in
 * human form) to the one that removes it (SRemoveObject 0x0E), and it moves
 * by SMoveObject 0x0C. A new map clears everything: the client's objects are
 * replaced with the map. The character's own 0x33 is kept apart by name, so
 * the tile it was last drawn on never counts as taken once it walks away.
 *
 * Only living things that block a step are `solid`: a player, an NPC, a
 * monster of type 0. A monster of type 1 is drawn and walked through, and an
 * item on the ground blocks nothing; both are kept for the log and not for
 * the walker.
 */

/** One thing on the map. */
export interface Entity {
  id: number
  x: number
  y: number
  kind: 'player' | 'npc' | 'creature' | 'item'
  /** True when a step onto the tile is refused by the thing standing on it. */
  solid: boolean
  name?: string
}

/** Everything on the map, by id, and the map it is on. */
export interface EntityState {
  /** The map the entities were drawn on. Absent until a map is known. */
  mapId?: number
  byId: Map<number, Entity>
  /** The character's own object id, once its 0x33 has been seen. */
  ownId?: number
  /** Capture time of the packet that last changed the state. */
  asOfMs: number
}

/** One packet, with what the capture layer knows about it. */
export interface EntityInput {
  packet: DecodedPacket
  timestampMs: number
  /** True when bytes were lost since the previous packet. The view is then stale, and cleared. */
  sawLoss?: boolean | undefined
  /** The character's name, to keep its own 0x33 apart. */
  ownName?: string | undefined
}

/**
 * Apply one packet. Returns a new state and never changes the old one.
 * Returns null while nothing is on the map.
 */
export function reduceEntities(state: EntityState | null, input: EntityInput): EntityState | null {
  const { packet, timestampMs } = input
  // A loss may have dropped a draw or a remove, and a stale entity is worse
  // than none: the walker then avoids a tile that is empty, or aims at one
  // that is not. Start again from the next draw.
  const base = input.sawLoss === true && state !== null ? cleared(state, timestampMs) : state

  switch (packet.kind) {
    case 'mapInfo': {
      if (base !== null && base.mapId === packet.mapId) return base
      return { mapId: packet.mapId, byId: new Map(), asOfMs: timestampMs }
    }
    case 'drawHumanObjects': {
      const next = copy(base, timestampMs)
      const isOwn = input.ownName !== undefined && packet.name === input.ownName
      if (isOwn) {
        next.ownId = packet.entityId
        next.byId.delete(packet.entityId)
        return next
      }
      next.byId.set(packet.entityId, {
        id: packet.entityId,
        x: packet.x,
        y: packet.y,
        kind: 'player',
        solid: true,
        ...(packet.name !== '' ? { name: packet.name } : {})
      })
      return next
    }
    case 'addWorldObjects': {
      const next = copy(base, timestampMs)
      for (const object of packet.objects) {
        if (object.kind === 'ignored') continue
        if (object.kind === 'item') {
          next.byId.set(object.id, {
            id: object.id,
            x: object.x,
            y: object.y,
            kind: 'item',
            solid: false
          })
          continue
        }
        const npc = object.name !== undefined
        next.byId.set(object.id, {
          id: object.id,
          x: object.x,
          y: object.y,
          kind: npc ? 'npc' : 'creature',
          solid: npc || object.type !== NONSOLID_MONSTER,
          ...(npc ? { name: object.name } : {})
        })
      }
      return next
    }
    case 'creatureMove': {
      if (base === null) return base
      const entity = base.byId.get(packet.id)
      const delta = DIRECTION_DELTA[packet.direction]
      if (entity === undefined || delta === undefined) return base
      const next = copy(base, timestampMs)
      // The step starts from the tile the server names, not the one this
      // remembers: the server's word wins when they differ.
      next.byId.set(packet.id, {
        ...entity,
        x: packet.fromX + delta[0],
        y: packet.fromY + delta[1]
      })
      return next
    }
    case 'removeWorldObject': {
      if (base === null || !base.byId.has(packet.id)) return base
      const next = copy(base, timestampMs)
      next.byId.delete(packet.id)
      return next
    }
    default:
      return base
  }
}

/** The tiles a step cannot enter because something solid stands there, keyed `x,y`. */
export function solidTiles(state: EntityState | null): Set<string> {
  const tiles = new Set<string>()
  if (state === null) return tiles
  for (const entity of state.byId.values()) {
    if (entity.solid) tiles.add(`${entity.x},${entity.y}`)
  }
  return tiles
}

/** The solid thing on a tile, or null. */
export function occupantAt(state: EntityState | null, x: number, y: number): Entity | null {
  if (state === null) return null
  for (const entity of state.byId.values()) {
    if (entity.solid && entity.x === x && entity.y === y) return entity
  }
  return null
}

function copy(state: EntityState | null, timestampMs: number): EntityState {
  return {
    ...(state?.mapId !== undefined ? { mapId: state.mapId } : {}),
    ...(state?.ownId !== undefined ? { ownId: state.ownId } : {}),
    byId: new Map(state?.byId ?? []),
    asOfMs: timestampMs
  }
}

function cleared(state: EntityState, timestampMs: number): EntityState {
  return {
    ...(state.mapId !== undefined ? { mapId: state.mapId } : {}),
    ...(state.ownId !== undefined ? { ownId: state.ownId } : {}),
    byId: new Map(),
    asOfMs: timestampMs
  }
}
