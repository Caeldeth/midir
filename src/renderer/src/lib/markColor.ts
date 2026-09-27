/**
 * The colour a legend mark is written in (WP42).
 *
 * A mark's `color` byte indexes the client's own text palette, and the game
 * paints the row in that colour. Midir paints it too — but the game draws on one
 * dark parchment and Midir has six themes, two of them light. The palette holds
 * near-white entries (index 32 is 255, 231, 235) and near-black ones, so taken
 * literally a mark can be written in the background colour and disappear.
 *
 * So the hue is kept and the lightness is moved only as far as it must be. A
 * mark stays recognisably its own colour, and it stays readable.
 */

/** The lightness a colour may not exceed on a light theme, 0 to 1. */
const LIGHT_CEILING = 0.62

/** The lightness a colour must reach on a dark theme, 0 to 1. */
const DARK_FLOOR = 0.34

interface Rgb {
  r: number
  g: number
  b: number
}

/** Read `#rrggbb`, or null when it is not one. */
export function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim())
  if (match === null) return null
  const value = Number.parseInt(match[1]!, 16)
  return { r: (value >> 16) & 0xff, g: (value >> 8) & 0xff, b: value & 0xff }
}

function toHex({ r, g, b }: Rgb): string {
  const part = (value: number): string =>
    Math.max(0, Math.min(255, Math.round(value)))
      .toString(16)
      .padStart(2, '0')
  return `#${part(r)}${part(g)}${part(b)}`
}

/** Relative lightness, 0 (black) to 1 (white), weighted as the eye sees it. */
export function lightnessOf(colour: Rgb): number {
  return (0.2126 * colour.r + 0.7152 * colour.g + 0.0722 * colour.b) / 255
}

/**
 * The mark's colour, moved into the band this theme can show.
 *
 * Returns undefined for a colour it cannot read, so the caller leaves the text
 * as the theme wrote it rather than guessing.
 */
export function readableMarkColor(hex: string, mode: 'light' | 'dark'): string | undefined {
  const colour = parseHex(hex)
  if (colour === null) return undefined
  const lightness = lightnessOf(colour)

  if (mode === 'light') {
    if (lightness <= LIGHT_CEILING) return toHex(colour)
    // Scale every channel by the same factor: the hue holds, the colour darkens.
    const factor = lightness === 0 ? 0 : LIGHT_CEILING / lightness
    return toHex({ r: colour.r * factor, g: colour.g * factor, b: colour.b * factor })
  }

  if (lightness >= DARK_FLOOR) return toHex(colour)
  // Mix toward white by the fraction that lifts it to the floor. Mixing rather
  // than scaling, because scaling cannot lift a channel that is already zero.
  const mix = (DARK_FLOOR - lightness) / (1 - lightness)
  return toHex({
    r: colour.r + (255 - colour.r) * mix,
    g: colour.g + (255 - colour.g) * mix,
    b: colour.b + (255 - colour.b) * mix
  })
}
