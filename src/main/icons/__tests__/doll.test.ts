import { describe, expect, it } from 'vitest'
import {
  composeDoll,
  DOLL_HEIGHT,
  DOLL_WIDTH,
  dollLayers,
  FRONT_IDLE_FRAME,
  FRONT_ORDER,
  layerOffsetX,
  WALK_ANIM,
  type DollFrameSource,
  type DollLayer
} from '../doll'
import { khanArchiveFor, paletteTableFor, sheetName } from '../dollService'
import type { DollAppearance } from '../../../shared/doll'
import type { RenderedFrame } from '../iconService'

/** The doll's layers and composition, with no game files (WP37). */

const bare = (over: Partial<DollAppearance> = {}): DollAppearance => ({
  bodyShape: 1,
  skinColor: 0,
  hairStyle: 0,
  hairColor: 0,
  faceShape: 0,
  armorSprite: 0,
  armsSprite: 0,
  overcoatSprite: 0,
  overcoatColor: 0,
  pantsDye: 0,
  bootsSprite: 0,
  bootsColor: 0,
  weaponSprite: 0,
  shieldSprite: 255,
  accessory1Sprite: 0,
  accessory1Color: 0,
  accessory2Sprite: 0,
  accessory2Color: 0,
  accessory3Sprite: 0,
  accessory3Color: 0,
  ...over
})

const sheet = (layer: DollLayer): string => sheetName(layer, WALK_ANIM)

describe('dollLayers', () => {
  it('a bare male body is the outline and the skin, nothing else', () => {
    const layers = dollLayers(bare())!
    expect(Object.keys(layers).sort()).toEqual(['body', 'bodyB'])
    expect(sheet(layers.bodyB!)).toBe('mb00101.epf')
    expect(layers.body).toMatchObject({ letter: 'm', sprite: 1, bodyPalette: true, isMale: true })
  })

  it('a female form reads the w sheets, and the skin colour reaches the body and the face', () => {
    const layers = dollLayers(bare({ bodyShape: 2, skinColor: 3, faceShape: 2 }))!
    expect(sheet(layers.bodyB!)).toBe('wb00101.epf')
    expect(layers.body?.color).toBe(3)
    expect(layers.face).toMatchObject({
      letter: 'o',
      sprite: 2,
      color: 3,
      bodyPalette: true,
      isMale: false
    })
  })

  it('the hair is three passes, dyed alike; the boots and pants carry their own dye', () => {
    const layers = dollLayers(
      bare({ hairStyle: 55, hairColor: 15, bootsSprite: 229, bootsColor: 58, pantsDye: 4 })
    )!
    expect(
      [layers.headH, layers.headE, layers.headF].map((l) => `${l!.letter}${l!.sprite}:${l!.color}`)
    ).toEqual(['h55:15', 'e55:15', 'f55:15'])
    expect(layers.boots).toMatchObject({ letter: 'l', sprite: 229, color: 58 })
    expect(layers.pants).toMatchObject({ letter: 'n', sprite: 1, color: 4 })
  })

  it('the armour is two sprites, torso and arms, on their own sheets', () => {
    const layers = dollLayers(bare({ armorSprite: 138, armsSprite: 140 }))!
    expect(layers.armor).toMatchObject({ letter: 'u', sprite: 138 })
    expect(layers.arms).toMatchObject({ letter: 'a', sprite: 140 })
  })

  it('an overcoat feeds both passes, and one at 1000 or above is on the i and j sheets', () => {
    const low = dollLayers(
      bare({ armorSprite: 138, armsSprite: 138, overcoatSprite: 950, overcoatColor: 2 })
    )!
    expect(low.armor).toMatchObject({ letter: 'u', sprite: 950, color: 2 })
    expect(low.arms).toMatchObject({ letter: 'a', sprite: 950, color: 2 })
    const high = dollLayers(bare({ overcoatSprite: 1258 }))!
    expect(high.armor).toMatchObject({ letter: 'i', sprite: 258 })
    expect(high.arms).toMatchObject({ letter: 'j', sprite: 258 })
  })

  it('the weapon is two halves, the shield always male, and 255 is no shield', () => {
    const layers = dollLayers(bare({ bodyShape: 2, weaponSprite: 162, shieldSprite: 23 }))!
    expect(sheet(layers.weaponW!)).toBe('ww16201.epf')
    expect(sheet(layers.weaponP!)).toBe('wp16201.epf')
    expect(sheet(layers.shield!)).toBe('ms02301.epf')
    expect(dollLayers(bare({ shieldSprite: 255 }))!.shield).toBeUndefined()
  })

  it('an accessory is two halves with its colour', () => {
    const layers = dollLayers(bare({ accessory2Sprite: 39, accessory2Color: 6 }))!
    expect(layers.acc2C).toMatchObject({ letter: 'c', sprite: 39, color: 6 })
    expect(layers.acc2G).toMatchObject({ letter: 'g', sprite: 39, color: 6 })
    expect(layers.acc1C).toBeUndefined()
  })

  it('the invisible form is the male outline for both genders, and no skin', () => {
    const layers = dollLayers(bare({ bodyShape: 6 }))!
    expect(sheet(layers.bodyB!)).toBe('mb00301.epf')
    expect(layers.body).toBeUndefined()
    expect(layers.bodyB?.isMale).toBe(true)
  })

  it('a ghost is body 2, a jester body 4, and no body at all is no doll', () => {
    expect(dollLayers(bare({ bodyShape: 4 }))!.bodyB?.sprite).toBe(2)
    expect(dollLayers(bare({ bodyShape: 7 }))!.bodyB?.sprite).toBe(4)
    expect(dollLayers(bare({ bodyShape: 0 }))).toBeNull()
  })
})

describe('the sheet and palette naming', () => {
  it('names the archive by letter range and gender', () => {
    expect(khanArchiveFor('b', true)).toBe('khanmad.dat')
    expect(khanArchiveFor('h', false)).toBe('khanweh.dat')
    expect(khanArchiveFor('m', true)).toBe('khanmim.dat')
    expect(khanArchiveFor('s', false)).toBe('khanwns.dat')
    expect(khanArchiveFor('w', true)).toBe('khanmtz.dat')
  })

  it('names the palette table the client reads for each letter', () => {
    expect(['a', 'b', 'n'].map(paletteTableFor)).toEqual(['palb', 'palb', 'palb'])
    expect(['c', 'g', 'j'].map(paletteTableFor)).toEqual(['palc', 'palc', 'palc'])
    expect(['p', 's'].map(paletteTableFor)).toEqual(['palp', 'palp'])
    expect(['e', 'f', 'h', 'i', 'l', 'u', 'w'].map(paletteTableFor)).toEqual([
      'pale',
      'palf',
      'palh',
      'pali',
      'pall',
      'palu',
      'palw'
    ])
  })

  it('the wide sheets draw 27 px further left', () => {
    expect(['w', 'p', 'c', 'g'].map(layerOffsetX)).toEqual([-27, -27, -27, -27])
    expect(['b', 'm', 'h', 'u'].map(layerOffsetX)).toEqual([0, 0, 0, 0])
  })
})

describe('composeDoll', () => {
  /** A solid frame of one colour. */
  const solid = (width: number, height: number, rgb: [number, number, number]): RenderedFrame => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < width * height; i++) data.set([...rgb, 255], i * 4)
    return { data, width, height }
  }

  const pixel = (doll: RenderedFrame, x: number, y: number): number[] =>
    Array.from(doll.data.subarray((y * DOLL_WIDTH + x) * 4, (y * DOLL_WIDTH + x) * 4 + 4))

  it('draws the layers in the front order at the body offset, and mirrors to face down', () => {
    const frames: Record<string, RenderedFrame> = {
      'mb00101.epf': solid(4, 4, [255, 0, 0]),
      'mo00201.epf': solid(2, 2, [0, 0, 255])
    }
    const asked: string[] = []
    const source: DollFrameSource = {
      frame: (layer, anim, index) => {
        asked.push(`${sheetName(layer, anim)}#${index}`)
        return frames[sheetName(layer, anim)] ?? null
      }
    }
    const doll = composeDoll(bare({ faceShape: 2 }), source, { facing: 'right' })!
    expect(doll.width).toBe(DOLL_WIDTH)
    expect(doll.height).toBe(DOLL_HEIGHT)
    // The idle front frame of the walk sheet, the body outline first, then the face over it.
    expect(asked).toEqual(['mb00101.epf#5', 'mm00101.epf#5', 'mo00201.epf#5'])
    expect(FRONT_IDLE_FRAME).toBe(5)
    // The body sits 27 px in; the face covers its top-left corner.
    expect(pixel(doll, 27, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(doll, 29, 0)).toEqual([255, 0, 0, 255])
    expect(pixel(doll, 26, 0)).toEqual([0, 0, 0, 0])

    const down = composeDoll(bare({ faceShape: 2 }), source)!
    expect(pixel(down, DOLL_WIDTH - 1 - 27, 0)).toEqual([0, 0, 255, 255])
    expect(pixel(down, DOLL_WIDTH - 1 - 29, 0)).toEqual([255, 0, 0, 255])
  })

  it('draws a wide sheet 27 px further left, so it can reach beside the body', () => {
    const source: DollFrameSource = {
      frame: (layer) =>
        layer.letter === 'b'
          ? solid(2, 2, [255, 0, 0])
          : layer.letter === 'w'
            ? solid(3, 3, [0, 255, 0])
            : null
    }
    const doll = composeDoll(bare({ weaponSprite: 7 }), source, { facing: 'right' })!
    expect(pixel(doll, 0, 0)).toEqual([0, 255, 0, 255])
    expect(pixel(doll, 27, 0)).toEqual([255, 0, 0, 255])
  })

  it('a missing equipment frame is skipped; a missing body is no doll', () => {
    const bodyOnly: DollFrameSource = {
      frame: (layer) => (layer.letter === 'b' ? solid(1, 1, [1, 2, 3]) : null)
    }
    expect(composeDoll(bare({ hairStyle: 9, weaponSprite: 3 }), bodyOnly)).not.toBeNull()
    const nothing: DollFrameSource = { frame: () => null }
    expect(composeDoll(bare(), nothing)).toBeNull()
    expect(composeDoll(bare({ bodyShape: 0 }), bodyOnly)).toBeNull()
  })

  it('the front order is the client’s: fringe behind the body, the hair over it, the weapon last but the shield', () => {
    expect(FRONT_ORDER.indexOf('headF')).toBeLessThan(FRONT_ORDER.indexOf('body'))
    expect(FRONT_ORDER.indexOf('body')).toBeLessThan(FRONT_ORDER.indexOf('face'))
    expect(FRONT_ORDER.indexOf('armor')).toBeLessThan(FRONT_ORDER.indexOf('headE'))
    expect(FRONT_ORDER.indexOf('weaponP')).toBeLessThan(FRONT_ORDER.indexOf('shield'))
    expect(FRONT_ORDER.at(-1)).toBe('acc3C')
  })
})
