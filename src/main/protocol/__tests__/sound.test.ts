import { describe, expect, it } from 'vitest'
import {
  decodeSoundEffect,
  FIRST_TRACK,
  LAST_TRACK,
  MUSIC_UNCHANGED,
  MUSIC_MARKER
} from '../decode/sound'

const body = (...bytes: number[]): Uint8Array => new Uint8Array([0x19, ...bytes])

describe('SSoundEffect 0x19 (WP40)', () => {
  it('reads a sound effect id from the one-byte form', () => {
    expect(decodeSoundEffect(body(0x2a))).toEqual({ kind: 'soundEffect', id: 0x2a })
  })

  it('reads the track from the music form', () => {
    expect(decodeSoundEffect(body(MUSIC_MARKER, 16))).toEqual({ kind: 'music', track: 16 })
  })

  it('accepts the four-byte form retail sends, and ignores its tail', () => {
    // 410 of 416 readings in the recordings carry [0xFF][track][0][0]. The
    // client reads two bytes and stops, and so does this decoder.
    expect(decodeSoundEffect(body(MUSIC_MARKER, 18, 0, 0))).toEqual({ kind: 'music', track: 18 })
  })

  it('accepts the shorter and the odd tail the same way', () => {
    expect(decodeSoundEffect(body(MUSIC_MARKER, 13, 0))).toEqual({ kind: 'music', track: 13 })
    expect(decodeSoundEffect(body(MUSIC_MARKER, 17, 0, 25))).toEqual({ kind: 'music', track: 17 })
  })

  it('reports the no-op track as it arrived, and leaves the rule to the model', () => {
    expect(decodeSoundEffect(body(MUSIC_MARKER, MUSIC_UNCHANGED))).toEqual({
      kind: 'music',
      track: MUSIC_UNCHANGED
    })
  })

  it('does not mistake a sound effect id of 100 for the music no-op', () => {
    expect(decodeSoundEffect(body(MUSIC_UNCHANGED))).toEqual({ kind: 'soundEffect', id: 100 })
  })

  it('throws on a music form with no track byte, so the session reports it', () => {
    expect(() => decodeSoundEffect(body(MUSIC_MARKER))).toThrow()
  })

  it('names the client asset set', () => {
    expect([FIRST_TRACK, LAST_TRACK]).toEqual([1, 64])
  })
})
