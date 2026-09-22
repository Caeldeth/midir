import { bodySpriteOf, genderOfBody, type DollAppearance } from '../../shared/doll'
import type { RenderedFrame } from './iconService'

/**
 * The character doll: the body, the face, the hair, and every worn sprite,
 * composited the way the client's `HumanImage` does it (WP37).
 *
 * This is Brigid's `AislingRenderer` with the rendering taken out. Each layer
 * is one EPF frame from the khan archives, named
 * `{m|w}{letter}{sprite:D3}{anim}.epf`, drawn through the palette the
 * letter's `khanpal` table gives that sprite, dyed where the item is dyed.
 * The letters are the client's own: `b` the body outline, `m` the body's
 * skin, `o` the face, `n` the pants, `l` the boots, `h`/`e`/`f` the hair
 * (three passes: behind, over, and the fringe), `u`/`a` the armour's torso
 * and arms (`i`/`j` for an overcoat, whose sprite is 1000 higher), `w`/`p`
 * the weapon's two halves, `s` the shield, `c`/`g` an accessory's two halves.
 * The order the layers are drawn in is Brigid's `FRONT_ORDER`, and the doll
 * is the front view: walk animation `01`, frame 5 (the right-facing idle),
 * mirrored to face down, as the client's paperdoll does. Every layer sits at
 * y 0 on a 111 by 85 canvas, the body 27 px in from the left, and the `w`,
 * `p`, `c`, and `g` sheets are drawn 27 px further left because they are cut
 * wider than the body.
 *
 * The source of frames is injected, so this file is provable with no game
 * files: a test hands it small frames and reads the pixels back.
 */

export const BODY_WIDTH = 57
export const BODY_HEIGHT = 85
export const LAYER_OFFSET_PADDING = 27
export const DOLL_WIDTH = BODY_WIDTH + LAYER_OFFSET_PADDING * 2
export const DOLL_HEIGHT = BODY_HEIGHT

/** The walk animation, whose frame 5 is the right-facing idle. */
export const WALK_ANIM = '01'
export const FRONT_IDLE_FRAME = 5

/** The body sprite that is the ordinary body, whose skin is a separate palette layer. */
const ORDINARY_BODY = 1
/** The pants sprite. There is one. */
const PANTS_SPRITE = 1
/** An armour sprite at or above this is an overcoat, in the `i`/`j` sheets. */
const OVERCOAT_BASE = 1000
/** The shield byte retail sends for no shield. */
const NO_SHIELD = 255

/** One layer to draw: which sheet, which sprite, how coloured. */
export interface DollLayer {
  /** The sheet letter, `a` to `z`. */
  letter: string
  sprite: number
  /** The dye colour, 0 for none; or the skin colour for a body palette layer. */
  color: number
  /** True for the `m` and `o` layers, whose palette is the skin colour's, not the sprite's. */
  bodyPalette: boolean
  isMale: boolean
}

/** Where a layer's frames come from. The real one reads the khan archives. */
export interface DollFrameSource {
  frame(layer: DollLayer, anim: string, frameIndex: number): RenderedFrame | null
}

/** The order the layers are drawn in for the front view, first drawn at the back. */
export const FRONT_ORDER = [
  'bodyB',
  'headF',
  'acc1G',
  'acc2G',
  'acc3G',
  'body',
  'pants',
  'face',
  'boots',
  'headH',
  'armor',
  'arms',
  'headE',
  'weaponW',
  'weaponP',
  'shield',
  'acc1C',
  'acc2C',
  'acc3C'
] as const

export type DollSlot = (typeof FRONT_ORDER)[number]

/**
 * The layers an appearance needs, by slot. A slot with nothing to draw is
 * absent. The shield always loads from the male archive, and so does the
 * invisible outline (body 3), as the client does.
 */
export function dollLayers(
  appearance: DollAppearance
): Partial<Record<DollSlot, DollLayer>> | null {
  const gender = genderOfBody(appearance.bodyShape)
  if (gender === null) return null
  const isMale = gender === 'male'
  const layers: Partial<Record<DollSlot, DollLayer>> = {}
  const equip = (letter: string, sprite: number, color: number, male = isMale): DollLayer => ({
    letter,
    sprite,
    color,
    bodyPalette: false,
    isMale: male
  })

  const body = bodySpriteOf(appearance.bodyShape)
  layers.bodyB = equip('b', body, 0, body === 3 ? true : isMale)
  if (body === ORDINARY_BODY) {
    layers.body = {
      letter: 'm',
      sprite: ORDINARY_BODY,
      color: appearance.skinColor,
      bodyPalette: true,
      isMale
    }
  }
  if (appearance.pantsDye > 0) layers.pants = equip('n', PANTS_SPRITE, appearance.pantsDye)
  if (appearance.faceShape > 0) {
    layers.face = {
      letter: 'o',
      sprite: appearance.faceShape,
      color: appearance.skinColor,
      bodyPalette: true,
      isMale
    }
  }
  if (appearance.bootsSprite > 0)
    layers.boots = equip('l', appearance.bootsSprite, appearance.bootsColor)
  if (appearance.hairStyle > 0) {
    layers.headH = equip('h', appearance.hairStyle, appearance.hairColor)
    layers.headE = equip('e', appearance.hairStyle, appearance.hairColor)
    layers.headF = equip('f', appearance.hairStyle, appearance.hairColor)
  }

  // The overcoat covers the body with one sprite, fed to both armour passes.
  // Otherwise the torso is the armour sprite and the arms their own.
  const torso = appearance.overcoatSprite > 0 ? appearance.overcoatSprite : appearance.armorSprite
  const arms = appearance.overcoatSprite > 0 ? appearance.overcoatSprite : appearance.armsSprite
  const armorColor = appearance.overcoatSprite > 0 ? appearance.overcoatColor : 0
  if (torso > 0) {
    const over = torso >= OVERCOAT_BASE
    layers.armor = equip(over ? 'i' : 'u', over ? torso - OVERCOAT_BASE : torso, armorColor)
  }
  if (arms > 0) {
    const over = arms >= OVERCOAT_BASE
    layers.arms = equip(over ? 'j' : 'a', over ? arms - OVERCOAT_BASE : arms, armorColor)
  }
  if (appearance.weaponSprite > 0) {
    layers.weaponW = equip('w', appearance.weaponSprite, 0)
    layers.weaponP = equip('p', appearance.weaponSprite, 0)
  }
  // Retail writes 255 for no shield, where Hybrasyl writes 0 (every record
  // Midir holds carries 255); no sheet has that number either way.
  if (appearance.shieldSprite > 0 && appearance.shieldSprite !== NO_SHIELD) {
    layers.shield = equip('s', appearance.shieldSprite, 0, true)
  }
  const accessories: [number, number, DollSlot, DollSlot][] = [
    [appearance.accessory1Sprite, appearance.accessory1Color, 'acc1C', 'acc1G'],
    [appearance.accessory2Sprite, appearance.accessory2Color, 'acc2C', 'acc2G'],
    [appearance.accessory3Sprite, appearance.accessory3Color, 'acc3C', 'acc3G']
  ]
  for (const [sprite, color, c, g] of accessories) {
    if (sprite <= 0) continue
    layers[c] = equip('c', sprite, color)
    layers[g] = equip('g', sprite, color)
  }
  return layers
}

/** The x a sheet's frames are drawn at: the wide sheets sit 27 px further left. */
export function layerOffsetX(letter: string): number {
  return letter === 'w' || letter === 'p' || letter === 'c' || letter === 'g'
    ? -LAYER_OFFSET_PADDING
    : 0
}

/** Draw `frame` onto `canvas` at (x, 0), source over, clipped to the canvas. */
function blit(canvas: Uint8ClampedArray, frame: RenderedFrame, x0: number): void {
  for (let y = 0; y < frame.height && y < DOLL_HEIGHT; y++) {
    for (let x = 0; x < frame.width; x++) {
      const dx = x0 + x
      if (dx < 0 || dx >= DOLL_WIDTH) continue
      const s = (y * frame.width + x) * 4
      const a = frame.data[s + 3]! / 255
      if (a === 0) continue
      const d = (y * DOLL_WIDTH + dx) * 4
      const da = canvas[d + 3]! / 255
      const outA = a + da * (1 - a)
      for (let c = 0; c < 3; c++) {
        canvas[d + c] =
          outA === 0 ? 0 : (frame.data[s + c]! * a + canvas[d + c]! * da * (1 - a)) / outA
      }
      canvas[d + 3] = outA * 255
    }
  }
}

/** Mirror the canvas around the body's centre, so the right-facing frames face down. */
function mirror(canvas: Uint8ClampedArray): Uint8ClampedArray {
  const out = new Uint8ClampedArray(canvas.length)
  for (let y = 0; y < DOLL_HEIGHT; y++) {
    for (let x = 0; x < DOLL_WIDTH; x++) {
      const s = (y * DOLL_WIDTH + x) * 4
      const d = (y * DOLL_WIDTH + (DOLL_WIDTH - 1 - x)) * 4
      out[d] = canvas[s]!
      out[d + 1] = canvas[s + 1]!
      out[d + 2] = canvas[s + 2]!
      out[d + 3] = canvas[s + 3]!
    }
  }
  return out
}

/**
 * Compose the doll, or null when there is no body to draw or the body's
 * frame is missing. A missing equipment frame is skipped: the item has no
 * art at this pose, or the archive lacks it, and the doll is still the doll.
 */
export function composeDoll(
  appearance: DollAppearance,
  source: DollFrameSource,
  options: { facing?: 'down' | 'right' } = {}
): RenderedFrame | null {
  const layers = dollLayers(appearance)
  if (layers === null) return null
  const canvas = new Uint8ClampedArray(DOLL_WIDTH * DOLL_HEIGHT * 4)
  let drewBody = false
  for (const slot of FRONT_ORDER) {
    const layer = layers[slot]
    if (layer === undefined) continue
    const frame = source.frame(layer, WALK_ANIM, FRONT_IDLE_FRAME)
    if (frame === null || frame.width === 0 || frame.height === 0) continue
    if (slot === 'bodyB') drewBody = true
    blit(canvas, frame, layerOffsetX(layer.letter) + LAYER_OFFSET_PADDING)
  }
  if (!drewBody) return null
  const facing = options.facing ?? 'down'
  return {
    data: facing === 'down' ? mirror(canvas) : canvas,
    width: DOLL_WIDTH,
    height: DOLL_HEIGHT
  }
}
