import { describe, expect, it } from 'vitest'
import { doorKey, reduceDoors, type DoorState } from '../doors'
import type { DecodedPacket } from '../../protocol/decode'

const mapInfo = (mapId: number): DecodedPacket => ({
  kind: 'mapInfo',
  mapId,
  width: 50,
  height: 50,
  flags: 0,
  name: 'Rucesion'
})

const door = (records: [number, number, number, number][]): DecodedPacket => ({
  kind: 'staticObjectState',
  records: records.map(([x, y, state, side]) => ({ x, y, state, side }))
})

function feed(state: DoorState | null, ...packets: DecodedPacket[]): DoorState | null {
  let next = state
  let t = 1000
  for (const packet of packets) next = reduceDoors(next, { packet, timestampMs: (t += 100) })
  return next
}

describe('the door overlay (WP31)', () => {
  it('holds the last state the wire sent for each panel, on the current map', () => {
    const state = feed(null, mapInfo(505), door([[42, 11, 0, 1]]), door([[41, 11, 0, 1]]))
    expect(state?.mapId).toBe(505)
    expect(state?.states.get(doorKey(42, 11, 1))).toBe(0)
    expect(state?.states.get(doorKey(41, 11, 1))).toBe(0)
    expect(state?.asOfMs).toBe(1300)
  })

  it('a later state replaces the earlier one for the same panel', () => {
    const state = feed(null, mapInfo(505), door([[42, 11, 0, 1]]), door([[42, 11, 1, 1]]))
    expect(state?.states.get(doorKey(42, 11, 1))).toBe(1)
    expect(state?.states.size).toBe(1)
  })

  it('keeps the two slots of one cell apart', () => {
    const state = feed(null, mapInfo(505), door([[5, 5, 0, 1]]), door([[5, 5, 1, 0]]))
    expect(state?.states.get(doorKey(5, 5, 1))).toBe(0)
    expect(state?.states.get(doorKey(5, 5, 0))).toBe(1)
  })

  it('a side byte is 0 or not 0: any other value names the first slot', () => {
    expect(doorKey(1, 2, 7)).toBe(doorKey(1, 2, 1))
  })

  it('a walk acknowledgement (no records) changes nothing', () => {
    const before = feed(null, mapInfo(505), door([[42, 11, 0, 1]]))
    expect(feed(before, door([]))).toBe(before)
  })

  it('a door before any map is known has no map to belong to', () => {
    expect(feed(null, door([[42, 11, 0, 1]]))).toBeNull()
  })

  it('clears on a map change and stays on the same map', () => {
    const on505 = feed(null, mapInfo(505), door([[42, 11, 0, 1]]))
    expect(feed(on505, mapInfo(505))).toBe(on505)
    const on3048 = feed(on505, mapInfo(3048))
    expect(on3048?.mapId).toBe(3048)
    expect(on3048?.states.size).toBe(0)
  })

  it('clears on a loss, and keeps the map', () => {
    const before = feed(null, mapInfo(505), door([[42, 11, 0, 1]]))
    const after = reduceDoors(before, {
      packet: door([[1, 1, 0, 0]]),
      timestampMs: 5000,
      sawLoss: true
    })
    expect(after?.mapId).toBe(505)
    expect(after?.states.size).toBe(1)
    expect(after?.states.has(doorKey(42, 11, 1))).toBe(false)
  })

  it('never writes into the state it was given', () => {
    const before = feed(null, mapInfo(505), door([[42, 11, 0, 1]]))
    feed(before, door([[1, 1, 1, 0]]))
    expect(before?.states.size).toBe(1)
  })
})
