import { describe, expect, it } from 'vitest'
import { reducePosition, type Position, type PositionInput } from '../position'
import type { DecodedPacket } from '../../protocol/decode'

/**
 * The reducer is fed decoded-packet literals, the same way the character
 * reducer is. Each test is one transition: a client step, a server word, a map
 * change, or a gap. The packet stream mirrors a real walk: SMapSize, then
 * SUserPosition, then CWalk and SMove in turn.
 */

const mapInfo = (mapId: number, name: string): DecodedPacket => ({
  kind: 'mapInfo',
  mapId,
  width: 15,
  height: 15,
  flags: 0,
  name
})
const userPosition = (x: number, y: number): DecodedPacket => ({ kind: 'userPosition', x, y })
const userMove = (direction: number, fromX: number, fromY: number): DecodedPacket => ({
  kind: 'userMove',
  direction,
  fromX,
  fromY
})
const walk = (direction: number): DecodedPacket => ({ kind: 'walk', direction, step: 1 })
/** A packet the position reducer does not model, such as an SStatus. */
const other: DecodedPacket = { kind: 'removeInventory', slot: 3 }

const feed = (state: Position | null, packet: DecodedPacket, extra: Partial<PositionInput> = {}) =>
  reducePosition(state, { packet, timestampMs: extra.timestampMs ?? 1000, sawLoss: extra.sawLoss })

/** Walk a fresh character to a confirmed tile: map, then the server's word. */
function atConfirmedTile(mapId = 100, x = 5, y = 8): Position {
  const onMap = feed(null, mapInfo(mapId, 'Mileth'))
  const confirmed = feed(onMap, userPosition(x, y))
  if (confirmed === null) throw new Error('expected a position')
  return confirmed
}

describe('reducePosition', () => {
  it('produces nothing before the first map', () => {
    // SUserPosition and SMove have no map to place a tile on yet.
    expect(feed(null, userPosition(5, 8))).toBeNull()
    expect(feed(null, userMove(1, 5, 8))).toBeNull()
    expect(feed(null, walk(1))).toBeNull()
  })

  it('sets the map unknown, then the first server word confirms the tile', () => {
    // Acceptance criterion 1 and the confidence ladder.
    const onMap = feed(null, mapInfo(100, 'Mileth'))
    expect(onMap).toMatchObject({ mapId: 100, mapName: 'Mileth', confidence: 'unknown' })

    // The map size travels with the map, so the walker can index the cache.
    expect(onMap).toMatchObject({ mapWidth: 15, mapHeight: 15 })

    const confirmed = feed(onMap, userPosition(5, 8))
    expect(confirmed).toMatchObject({ mapId: 100, x: 5, y: 8, confidence: 'confirmed' })
  })

  it('predicts a client step, then the server word confirms it', () => {
    // Acceptance criterion 2. The client walks East from (5,8); the reducer
    // draws (6,8) predicted, then SMove from (5,8) confirms the same tile.
    const start = atConfirmedTile(100, 5, 8)

    const predicted = feed(start, walk(1), { timestampMs: 1100 })
    expect(predicted).toMatchObject({
      x: 6,
      y: 8,
      facing: 1,
      confidence: 'predicted',
      asOfMs: 1100
    })

    const confirmed = feed(predicted, userMove(1, 5, 8), { timestampMs: 1200 })
    expect(confirmed).toMatchObject({
      x: 6,
      y: 8,
      facing: 1,
      confidence: 'confirmed',
      asOfMs: 1200
    })
  })

  it('steps each direction the way the client draws it', () => {
    const start = atConfirmedTile(100, 10, 10)
    expect(feed(start, walk(0))).toMatchObject({ x: 10, y: 9 }) // North
    expect(feed(start, walk(1))).toMatchObject({ x: 11, y: 10 }) // East
    expect(feed(start, walk(2))).toMatchObject({ x: 10, y: 11 }) // South
    expect(feed(start, walk(3))).toMatchObject({ x: 9, y: 10 }) // West
  })

  it('lets a server correction win over a prediction, without a wild jump', () => {
    // Acceptance criterion 3. The client predicted (6,8); the server says the
    // step landed at (5,9) instead. The confirmed tile replaces the guess.
    const start = atConfirmedTile(100, 5, 8)
    const predicted = feed(start, walk(1))
    expect(predicted).toMatchObject({ x: 6, y: 8, confidence: 'predicted' })

    const corrected = feed(predicted, userMove(2, 5, 8))
    expect(corrected).toMatchObject({ x: 5, y: 9, confidence: 'confirmed' })
  })

  it('treats a direction above 3 as a no-step correction', () => {
    // SMove direction 4 asserts the source tile itself, with no delta.
    const start = atConfirmedTile(100, 5, 8)
    const corrected = feed(start, userMove(4, 12, 20))
    expect(corrected).toMatchObject({ x: 12, y: 20, confidence: 'confirmed' })
  })

  it('changes the map name when the character changes map', () => {
    // Acceptance criterion 1. A new SMapSize clears the tile until the next word.
    const onFirst = atConfirmedTile(100, 5, 8)
    const onSecond = feed(onFirst, mapInfo(200, 'Rucesion'))
    expect(onSecond).toMatchObject({ mapId: 200, mapName: 'Rucesion', confidence: 'unknown' })

    const confirmed = feed(onSecond, userPosition(4, 7))
    expect(confirmed).toMatchObject({ mapId: 200, x: 4, y: 7, confidence: 'confirmed' })
  })

  it('keeps the tile when the same map is announced again', () => {
    const onMap = atConfirmedTile(100, 5, 8)
    const again = feed(onMap, mapInfo(100, 'Mileth'))
    expect(again).toMatchObject({ mapId: 100, x: 5, y: 8, confidence: 'confirmed' })
  })

  it('goes unknown on a gap, and reports nothing until the next confirmation', () => {
    // Acceptance criterion 4. A lost range makes the tile doubtful, and a client
    // step does not move it while it is unknown. A server word restores it.
    const start = atConfirmedTile(100, 5, 8)

    const lost = feed(start, other, { sawLoss: true })
    expect(lost).toMatchObject({ x: 5, y: 8, confidence: 'unknown' })

    const stillUnknown = feed(lost, walk(1))
    expect(stillUnknown).toMatchObject({ x: 5, y: 8, confidence: 'unknown' })

    const restored = feed(stillUnknown, userPosition(9, 3))
    expect(restored).toMatchObject({ x: 9, y: 3, confidence: 'confirmed' })
  })

  it('trusts a server word that arrives with the gap flag', () => {
    // A loss riding on an SUserPosition is safe: the packet carries an absolute
    // tile, so the position is confirmed despite the gap.
    const start = atConfirmedTile(100, 5, 8)
    const confirmed = feed(start, userPosition(20, 30), { sawLoss: true })
    expect(confirmed).toMatchObject({ x: 20, y: 30, confidence: 'confirmed' })
  })

  it('does not move on a client step while the tile is unknown', () => {
    // Straight after a map change the tile is unknown. A client walk must not
    // guess a tile on the new map.
    const onMap = feed(null, mapInfo(100, 'Mileth'))
    const afterWalk = feed(onMap, walk(1))
    expect(afterWalk).toMatchObject({ confidence: 'unknown', x: 0, y: 0 })
  })

  it('never changes the state it is given', () => {
    const start = atConfirmedTile(100, 5, 8)
    const snapshot = { ...start }
    feed(start, walk(1))
    feed(start, userMove(1, 5, 8))
    feed(start, mapInfo(200, 'Rucesion'))
    expect(start).toEqual(snapshot)
  })
})
