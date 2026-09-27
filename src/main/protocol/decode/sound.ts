import { PacketReader } from '../reader'

/**
 * SSoundEffect 0x19. One sound effect, or the background music track.
 *
 * Body: `[u8 opcode][u8 sound]`, and when `sound` is `0xFF` one more byte is
 * the music track. Both protocol sources describe this read, and each verified
 * it against the client: it takes one byte, and only a `0xFF` takes a second.
 *
 * **The server sends no audio.** The client plays its own local file,
 * `.\music\<track>.mus`, which is MP3 data under a naming convention. The
 * client ships 64 tracks, numbered 1 through 64
 * (`darkages-741-re/docs/audio/music.md`), so a value outside that range names
 * no file. Track 100 is the documented "keep playing" no-op, and it sits
 * outside the range as well. Both are dropped by `model/music.ts`, not here: a
 * decoder reports what arrived.
 *
 * Trailing bytes are not fields. Retail writes slack the client never reads: of
 * 416 music readings in the recordings, 410 carry `[0xFF][track][0][0]`, five
 * carry `[0xFF][track][0]`, and one carries `[0xFF][track][0][25]`. The frame
 * header states where the body ends, so the tail changes nothing. That is a
 * fact about retail's own serializer, and not a verdict on another server — see
 * `CLAUDE.md`.
 */

/** The `sound` value that makes the packet a music selection. */
export const MUSIC_MARKER = 0xff

/** The first track the client has a file for. */
export const FIRST_TRACK = 1

/** The last track the client has a file for. */
export const LAST_TRACK = 64

/** The track that means "keep playing". It selects nothing. */
export const MUSIC_UNCHANGED = 100

/** The `0xFF` form: the background music track. */
export interface Music {
  kind: 'music'
  /** The value the server sent. It is range-checked by the model, not here. */
  track: number
}

/** Every other value: one sound effect, played once. */
export interface SoundEffect {
  kind: 'soundEffect'
  id: number
}

/**
 * Decode SSoundEffect 0x19.
 *
 * A music form with no track byte is a body that does not match the wire
 * format, so the reader throws and the session reports a decode failure.
 */
export function decodeSoundEffect(body: Uint8Array): Music | SoundEffect {
  const reader = new PacketReader(body, 1)
  const sound = reader.u8()
  if (sound !== MUSIC_MARKER) return { kind: 'soundEffect', id: sound }
  return { kind: 'music', track: reader.u8() }
}
