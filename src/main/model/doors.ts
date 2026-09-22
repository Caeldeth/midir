import type { DecodedPacket } from '../protocol/decode'

/**
 * The doors the server changed this session, per connection (WP31).
 *
 * A pure reducer over the decoded stream, like the position and the entities.
 * The state is the wire's word only: for each cell and static slot the last
 * `0x32` state byte. Which tile id that selects, and whether the tile is a
 * door at all, is the map cache's business and is resolved when the grid is
 * built (`mapGrid.ts` with `doorTable.ts`), so this model needs no file.
 *
 * The overlay is live, never saved. It starts again on a new map, because a
 * door state belongs to the map it was sent for, and on a loss, because a
 * dropped `0x32` would leave the walker planning through a door that closed.
 * Two clients keep two overlays; the capture service keys this by connection.
 */
export interface DoorState {
  /** The map the states were sent for. Absent until a map is known. */
  mapId?: number
  /** `doorKey(x, y, side)` to the last state byte the wire sent for it. */
  states: Map<string, number>
  /** Capture time of the packet that last changed the state. */
  asOfMs: number
}

export interface DoorInput {
  packet: DecodedPacket
  timestampMs: number
  /** True when bytes were lost since the previous packet. The overlay is then stale, and cleared. */
  sawLoss?: boolean | undefined
}

/** The key one door panel's state is held under. */
export function doorKey(x: number, y: number, side: number): string {
  return `${x}:${y}:${side === 0 ? 0 : 1}`
}

function cleared(state: DoorState, timestampMs: number): DoorState {
  return {
    ...(state.mapId !== undefined ? { mapId: state.mapId } : {}),
    states: new Map(),
    asOfMs: timestampMs
  }
}

export function reduceDoors(state: DoorState | null, input: DoorInput): DoorState | null {
  const { packet, timestampMs } = input
  const base = input.sawLoss === true && state !== null ? cleared(state, timestampMs) : state

  switch (packet.kind) {
    case 'mapInfo': {
      if (base !== null && base.mapId === packet.mapId) return base
      return { mapId: packet.mapId, states: new Map(), asOfMs: timestampMs }
    }
    case 'staticObjectState': {
      // A walk acknowledgement carries no records and changes nothing. A door
      // state before any map is known has no map to belong to, and is dropped.
      if (packet.records.length === 0 || base === null || base.mapId === undefined) return base
      const states = new Map(base.states)
      for (const record of packet.records) {
        states.set(doorKey(record.x, record.y, record.side), record.state)
      }
      return { mapId: base.mapId, states, asOfMs: timestampMs }
    }
    default:
      return base
  }
}
