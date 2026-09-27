import type { DecodedPacket } from '../protocol/decode'
import { FIRST_TRACK, LAST_TRACK, MUSIC_UNCHANGED } from '../protocol/decode/sound'

/**
 * The music track the wire selected for the map the character stands on (WP40).
 *
 * A pure reducer over the decoded stream, like the doors and the entities. The
 * packet names no map, so the map is the newest `SMapInfo 0x15`, and three
 * rules keep that attribution sound. All three come from the recordings, not
 * from a guess (416 music readings over 53 sessions, 2026-09-26):
 *
 *  1. **Track 100 selects nothing.** It is the client's documented "keep
 *     playing" no-op. 18 of the 416 readings.
 *  2. **A track outside 1 to 64 has no file behind it**, so it names nothing
 *     that another tool could use.
 *  3. **A reading after the world map pane belongs to the pane.** 34 readings
 *     arrived after `SFieldMap 0x2E` on the same map, and every one of the 34 is
 *     track 15, the field theme the pane plays, while the gateway map under it
 *     has a track of its own. Dropping them removes every disagreement: with
 *     the rules, 364 readings name 35 maps and no map contradicts itself;
 *     without them, 6 of 36 maps carried two tracks.
 *
 * Rule 3 drops a reading by what came before it and never by its value, because
 * 15 is also a real map's own track (Piet Village, Mehadi Entrance).
 *
 * The state is live, never saved; `store/mapStore.ts` keeps what it accepts.
 * Two clients keep two states, so the capture service keys this by connection.
 */
export interface MusicState {
  /** The map the readings belong to. Absent until a map is known. */
  mapId?: number
  /** True once a world map pane arrived for this map. Its music is the pane's. */
  paneOpen: boolean
  /** The accepted track for `mapId`, once one has been read. */
  track?: number
  /** Capture time of the packet the state last changed on. */
  asOfMs: number
}

export interface MusicInput {
  packet: DecodedPacket
  timestampMs: number
  /** True when bytes were lost since the previous packet. */
  sawLoss?: boolean | undefined
}

/** True while `track` names a file the client has. */
export function isPlayableTrack(track: number): boolean {
  return track >= FIRST_TRACK && track <= LAST_TRACK
}

export function reduceMusic(state: MusicState | null, input: MusicInput): MusicState | null {
  const { packet, timestampMs } = input

  // Bytes were lost. A missed 0x15 or a missed pane would send the next
  // reading to the wrong map, and nothing in the stream says which happened.
  // So the map is forgotten, and no reading is accepted until the next 0x15
  // names one again. A music reading is rare; a wrong one is worse than none.
  const base = input.sawLoss === true && state !== null ? null : state

  switch (packet.kind) {
    case 'mapInfo': {
      // A fresh load of the same map closes the pane and keeps the track.
      if (base !== null && base.mapId === packet.mapId) {
        if (!base.paneOpen) return base
        return { ...base, paneOpen: false, asOfMs: timestampMs }
      }
      return { mapId: packet.mapId, paneOpen: false, asOfMs: timestampMs }
    }
    case 'fieldMap': {
      if (base === null) return base
      if (base.paneOpen) return base
      return { ...base, paneOpen: true, asOfMs: timestampMs }
    }
    case 'music': {
      if (base === null || base.mapId === undefined) return base
      if (base.paneOpen) return base
      if (packet.track === MUSIC_UNCHANGED || !isPlayableTrack(packet.track)) return base
      if (base.track === packet.track) return base
      return { ...base, track: packet.track, asOfMs: timestampMs }
    }
    default:
      return base
  }
}
