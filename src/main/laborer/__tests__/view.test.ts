import { describe, expect, it } from 'vitest'
import {
  centreFromClick,
  creaturePoint,
  groundPoint,
  tileAtPoint,
  tileOffset,
  VIEW_CENTRE
} from '../view'

describe('the view: tile to screen', () => {
  it('is the measured centre: the hand click on Eduardo of 2026-09-21', () => {
    expect(VIEW_CENTRE).toEqual({ x: 312, y: 199 })
    expect(centreFromClick({ x: 256, y: 187 }, { x: 2, y: 11 }, { x: 1, y: 12 })).toEqual(
      VIEW_CENTRE
    )
  })

  it('draws one step east half a tile right and down, one step south half a tile left and down', () => {
    const own = { x: 10, y: 10 }
    expect(tileOffset(own, { x: 11, y: 10 })).toEqual({ x: 28, y: 13.5 })
    expect(tileOffset(own, { x: 10, y: 11 })).toEqual({ x: -28, y: 13.5 })
    expect(tileOffset(own, { x: 10, y: 9 })).toEqual({ x: 28, y: -13.5 })
  })

  it('puts Eduardo one tile straight left of the stand tile, lifted to the body', () => {
    // Stand on (2,11); Eduardo on (1,12): one west and one south.
    expect(creaturePoint({ x: 2, y: 11 }, { x: 1, y: 12 })).toEqual({ x: 312 - 56, y: 199 - 12 })
  })

  it('puts Antonio up and to the right of the storage stand tile', () => {
    // Stand on (5,8); Antonio on (3,4): two west and four north.
    expect(creaturePoint({ x: 5, y: 8 }, { x: 3, y: 4 })).toEqual({ x: 312 + 56, y: 199 - 81 - 12 })
  })

  it('recovers the centre from a hand click on a known NPC', () => {
    const click = creaturePoint({ x: 2, y: 11 }, { x: 1, y: 12 })
    expect(centreFromClick(click, { x: 2, y: 11 }, { x: 1, y: 12 })).toEqual(VIEW_CENTRE)
  })

  it('puts the ground of a tile at its centre, with no body lift (WP35)', () => {
    expect(groundPoint({ x: 10, y: 10 }, { x: 10, y: 10 })).toEqual(VIEW_CENTRE)
    // Eight tiles east: the far end of a right-click stretch, still on screen.
    expect(groundPoint({ x: 10, y: 10 }, { x: 18, y: 10 })).toEqual({ x: 312 + 224, y: 199 + 108 })
    // Four east and four south: straight down the screen.
    expect(groundPoint({ x: 10, y: 10 }, { x: 14, y: 14 })).toEqual({ x: 312, y: 199 + 108 })
  })

  it('reads a screen point back to the tile it is on', () => {
    const own = { x: 10, y: 10 }
    for (const tile of [
      { x: 10, y: 10 },
      { x: 18, y: 10 },
      { x: 14, y: 14 },
      { x: 7, y: 12 },
      { x: 10, y: 2 }
    ]) {
      expect(tileAtPoint(own, groundPoint(own, tile))).toEqual(tile)
    }
    // A point a little off the centre is still inside the diamond.
    const point = groundPoint(own, { x: 13, y: 11 })
    expect(tileAtPoint(own, { x: point.x + 10, y: point.y - 4 })).toEqual({ x: 13, y: 11 })
  })
})
