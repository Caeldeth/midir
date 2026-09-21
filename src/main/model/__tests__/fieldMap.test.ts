import { describe, expect, it } from 'vitest'
import { reduceFieldMap } from '../fieldMap'
import type { DecodedPacket } from '../../protocol/decode'
import type { FieldMap } from '../../protocol/decode/fieldMap'

const pane: FieldMap = {
  kind: 'fieldMap',
  fieldName: 'field001',
  currentIndex: 0,
  points: [{ screenX: 344, screenY: 250, name: 'Loures', checksum: 0, mapId: 3012, x: 14, y: 10 }]
}

const mapInfo: DecodedPacket = {
  kind: 'mapInfo',
  mapId: 3012,
  width: 16,
  height: 24,
  flags: 0,
  name: 'Loures'
}
const heartbeat: DecodedPacket = { kind: 'removeInventory', slot: 1 }

describe('reduceFieldMap', () => {
  it('opens on SFieldMap, stamped with the capture time', () => {
    const state = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    expect(state).toEqual({ packet: pane, asOfMs: 500 })
  })

  it('stays open through an unrelated packet', () => {
    const opened = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    expect(reduceFieldMap(opened, { packet: heartbeat, timestampMs: 600 })).toBe(opened)
  })

  it('closes when the server changes the map', () => {
    const opened = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    expect(reduceFieldMap(opened, { packet: mapInfo, timestampMs: 700 })).toBeNull()
  })

  it('forgets the pane after a lost packet', () => {
    const opened = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    expect(
      reduceFieldMap(opened, { packet: heartbeat, timestampMs: 600, sawLoss: true })
    ).toBeNull()
  })

  it('attaches the client click to the open pane', () => {
    const opened = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    const click: DecodedPacket = { kind: 'fieldMapClick', checksum: 0, mapId: 3012, x: 14, y: 10 }
    const clicked = reduceFieldMap(opened, { packet: click, timestampMs: 800 })
    expect(clicked?.click).toEqual({ packet: click, asOfMs: 800 })
    expect(clicked?.asOfMs).toBe(500)
    // A click with no pane open is not attached to anything.
    expect(reduceFieldMap(null, { packet: click, timestampMs: 800 })).toBeNull()
  })

  it('replaces an older pane with a newer one', () => {
    const first = reduceFieldMap(null, { packet: pane, timestampMs: 500 })
    const second = reduceFieldMap(first, { packet: pane, timestampMs: 900 })
    expect(second?.asOfMs).toBe(900)
  })
})
