// The character doll's contract (WP37): what the doll is drawn from, and the
// URL the renderer asks for it by. Pure; no electron or node imports.

import type { CharacterAppearance } from './character'

/** The fields the doll is drawn from, in the order the URL carries them. */
export const DOLL_FIELDS = [
  'bodyShape',
  'skinColor',
  'hairStyle',
  'hairColor',
  'faceShape',
  'armorSprite',
  'armsSprite',
  'overcoatSprite',
  'overcoatColor',
  'pantsDye',
  'bootsSprite',
  'bootsColor',
  'weaponSprite',
  'shieldSprite',
  'accessory1Sprite',
  'accessory1Color',
  'accessory2Sprite',
  'accessory2Color',
  'accessory3Sprite',
  'accessory3Color'
] as const

export type DollField = (typeof DOLL_FIELDS)[number]

/** The doll's inputs: the appearance without the fields the doll does not draw. */
export type DollAppearance = Pick<CharacterAppearance, DollField>

/**
 * The body form the packed body byte's high nibble names, as the client reads
 * it: 1 male, 2 female, 3 male ghost, 4 female ghost, 5 male invisible, 6
 * female invisible, 7 male jester, 8 male head, 9 female head, 10 blank male,
 * 11 blank female. 0 is no body at all (the viewer cannot see the player).
 * Brigid's `DetermineGender` and `GetBodySpriteId` are the reference.
 */
export function genderOfBody(bodyShape: number): 'male' | 'female' | null {
  switch (bodyShape) {
    case 1:
    case 3:
    case 5:
    case 7:
    case 8:
    case 10:
      return 'male'
    case 2:
    case 4:
    case 6:
    case 9:
    case 11:
      return 'female'
    default:
      return null
  }
}

/**
 * The body sprite the form draws with: 1 the ordinary body, 2 a ghost, 4 the
 * jester, 3 the gender-neutral invisible outline (the male one, for both).
 */
export function bodySpriteOf(bodyShape: number): number {
  switch (bodyShape) {
    case 3:
    case 4:
      return 2
    case 5:
    case 6:
      return 3
    case 7:
      return 4
    default:
      return 1
  }
}

/** The URL an `<img>` loads the doll from. The fields ride in the path, in order. */
export function dollUrl(appearance: DollAppearance): string {
  return `midir-icon://doll/${DOLL_FIELDS.map((field) => appearance[field]).join('/')}`
}

/** The appearance a doll path names, or null when it is not one. */
export function parseDollPath(segments: string[]): DollAppearance | null {
  if (segments.length !== DOLL_FIELDS.length) return null
  const out: Partial<Record<DollField, number>> = {}
  for (let i = 0; i < DOLL_FIELDS.length; i++) {
    const value = Number(segments[i])
    if (!Number.isInteger(value) || value < 0) return null
    out[DOLL_FIELDS[i]!] = value
  }
  return out as DollAppearance
}
