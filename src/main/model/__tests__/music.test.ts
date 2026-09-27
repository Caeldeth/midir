import { describe, expect, it } from 'vitest'
import { reduceMusic, type MusicState } from '../music'
import type { DecodedPacket } from '../../protocol/decode'
import { MUSIC_UNCHANGED } from '../../protocol/decode/sound'

const mapInfo = (mapId: number): DecodedPacket => ({
  kind: 'mapInfo',
  mapId,
  width: 50,
  height: 50,
  flags: 0,
  name: 'Rucesion Village'
})

const music = (track: number): DecodedPacket => ({ kind: 'music', track })

const pane = (): DecodedPacket => ({
  kind: 'fieldMap',
  fieldName: 'field001',
  currentIndex: 0,
  points: []
})

const effect = (id: number): DecodedPacket => ({ kind: 'soundEffect', id })

function feed(state: MusicState | null, ...packets: DecodedPacket[]): MusicState | null {
  let next = state
  let t = 1000
  for (const packet of packets) next = reduceMusic(next, { packet, timestampMs: (t += 100) })
  return next
}

describe('the map music reading (WP40)', () => {
  it('attributes a track to the map the newest 0x15 named', () => {
    const state = feed(null, mapInfo(505), music(16))
    expect(state?.mapId).toBe(505)
    expect(state?.track).toBe(16)
    expect(state?.asOfMs).toBe(1200)
  })

  it('takes no track before a map is known', () => {
    expect(feed(null, music(16))).toBeNull()
  })

  it('drops the whole track when the map changes, so it is never carried over', () => {
    const state = feed(null, mapInfo(505), music(16), mapInfo(3048))
    expect(state?.mapId).toBe(3048)
    expect(state?.track).toBeUndefined()
  })

  it('drops track 100, which means the music did not change', () => {
    const state = feed(null, mapInfo(505), music(MUSIC_UNCHANGED))
    expect(state?.track).toBeUndefined()
  })

  it('keeps an already-read track when a 100 arrives after it', () => {
    const state = feed(null, mapInfo(505), music(16), music(MUSIC_UNCHANGED))
    expect(state?.track).toBe(16)
  })

  it('drops a track with no file behind it', () => {
    expect(feed(null, mapInfo(505), music(0))?.track).toBeUndefined()
    expect(feed(null, mapInfo(505), music(65))?.track).toBeUndefined()
    expect(feed(null, mapInfo(505), music(255))?.track).toBeUndefined()
    expect(feed(null, mapInfo(505), music(64))?.track).toBe(64)
    expect(feed(null, mapInfo(505), music(1))?.track).toBe(1)
  })

  it('drops a reading that follows the world map pane, which owns its own theme', () => {
    // Measured: 34 such readings, every one track 15, on a gateway map whose own
    // track is something else. Abel Port read 17 and 15 before this rule.
    const state = feed(null, mapInfo(502), music(17), pane(), music(15))
    expect(state?.track).toBe(17)
  })

  it('drops a pane reading even when the map has no track yet', () => {
    const state = feed(null, mapInfo(502), pane(), music(15))
    expect(state?.track).toBeUndefined()
    expect(state?.paneOpen).toBe(true)
  })

  it('takes the track the next map sends after the pane closed the hop', () => {
    // Stepping on a gateway edge opens the pane; the click lands on a new map,
    // whose own 0x15 arrives first and clears the pane.
    const state = feed(null, mapInfo(502), pane(), music(15), mapInfo(505), music(16))
    expect(state?.mapId).toBe(505)
    expect(state?.track).toBe(16)
  })

  it('drops the pane rule by what came before, never by the value 15', () => {
    // 15 is also a real map's own track: Piet Village, Mehadi Entrance.
    expect(feed(null, mapInfo(501), music(15))?.track).toBe(15)
  })

  it('reloading the same map closes the pane and keeps the track', () => {
    const state = feed(null, mapInfo(505), music(16), pane(), mapInfo(505))
    expect(state?.paneOpen).toBe(false)
    expect(state?.track).toBe(16)
  })

  it('a newer track on the same map replaces the older one', () => {
    const state = feed(null, mapInfo(505), music(16), music(18))
    expect(state?.track).toBe(18)
    expect(state?.asOfMs).toBe(1300)
  })

  it('an unchanged track changes no state, so nothing is written again', () => {
    const before = feed(null, mapInfo(505), music(16))
    const after = reduceMusic(before, { packet: music(16), timestampMs: 9999 })
    expect(after).toBe(before)
  })

  it('ignores a sound effect entirely', () => {
    const before = feed(null, mapInfo(505), music(16))
    const after = reduceMusic(before, { packet: effect(42), timestampMs: 9999 })
    expect(after).toBe(before)
  })

  it('forgets the map on a loss, and takes no reading until the next 0x15', () => {
    const before = feed(null, mapInfo(505), music(16))
    const lost = reduceMusic(before, { packet: music(18), timestampMs: 2000, sawLoss: true })
    expect(lost).toBeNull()
    const after = feed(lost, music(18))
    expect(after).toBeNull()
    expect(feed(lost, mapInfo(3048), music(18))?.track).toBe(18)
  })
})
