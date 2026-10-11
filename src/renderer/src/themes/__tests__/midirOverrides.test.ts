import { describe, it, expect } from 'vitest'
import { themesByName } from '../index'
import { midirOverrides } from '../midirOverrides'
import type { ThemeName } from '@shared/types'

const THEME_NAMES = Object.keys(themesByName) as ThemeName[]

/**
 * Each theme file is the house template's file, plus one spread of
 * `midirOverrides`. The next port of the template's palettes copies the six
 * files again. This test fails when that copy loses the spread, because the
 * character sheet's accordions and every tooltip then fall back to MUI's
 * defaults, and no other test sees it.
 */
describe("Midir's component overrides", () => {
  const keys = Object.keys(midirOverrides) as (keyof typeof midirOverrides)[]

  it('holds the four overrides that the template does not have', () => {
    expect([...keys].sort()).toEqual([
      'MuiAccordion',
      'MuiAccordionDetails',
      'MuiAccordionSummary',
      'MuiTooltip'
    ])
  })

  it.each(THEME_NAMES)('%s carries every one of them', (name) => {
    const components = themesByName[name].components ?? {}
    for (const key of keys) expect(components[key], key).toEqual(midirOverrides[key])
  })
})
