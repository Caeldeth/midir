import { describe, it, expect } from 'vitest'
import type { Theme } from '@mui/material/styles'
import { themesByName } from '../index'
import { blend, contrast } from '@renderer/lib/contrast'
import { PICKED_WARP_BORDER, warpColor } from '@renderer/lib/warpColor'
import type { EdgeSource, MapHopKind } from '@shared/map'
import type { ThemeName } from '@shared/types'

const THEME_NAMES = Object.keys(themesByName) as ThemeName[]

/** A palette path (`text.primary`) in a theme. */
function colourOf(theme: Theme, path: string): string {
  const [group, key] = path.split('.')
  const palette = theme.palette as unknown as Record<string, Record<string, string>>
  const value = palette[group]?.[key]
  if (value === undefined) throw new Error(`no palette colour at ${path}`)
  return value
}

const WARPS: { source: EdgeSource; via?: MapHopKind }[] = [
  { source: 'authored' },
  { source: 'learned' },
  { source: 'curated' },
  { source: 'xml' },
  { source: 'authored', via: 'dialog' }
]

/**
 * The marks that Midir draws over its own surfaces, in each theme (HTOO-572).
 * The template's palette test holds the tokens on the page and on paper. These
 * are the marks Midir adds: the Map tab draws its warps and the walker's path
 * over open tiles, which are `background.paper` over the page. A mark is held
 * to 3:1 (WCAG 1.4.11).
 */
describe("the Map tab's marks", () => {
  it.each(THEME_NAMES)('%s: each warp colour is 3:1 on an open tile', (name) => {
    const theme = themesByName[name]
    const tile = blend(theme.palette.background.paper, theme.palette.background.default)
    for (const warp of WARPS) {
      const path = warpColor(warp)
      expect(contrast(colourOf(theme, path), tile), `${warp.source} ${path}`).toBeGreaterThan(3)
    }
  })

  it.each(THEME_NAMES)('%s: the picked warp and the path are 3:1 on an open tile', (name) => {
    const theme = themesByName[name]
    const tile = blend(theme.palette.background.paper, theme.palette.background.default)
    expect(contrast(colourOf(theme, PICKED_WARP_BORDER), tile)).toBeGreaterThan(3)
    expect(contrast(theme.palette.primary.main, tile)).toBeGreaterThan(3)
  })

  it('draws no warp in the title bar colour, which is a fill for the bar only', () => {
    for (const warp of WARPS) expect(warpColor(warp)).not.toMatch(/^secondary\./)
    expect(PICKED_WARP_BORDER).not.toMatch(/^secondary\./)
  })
})
