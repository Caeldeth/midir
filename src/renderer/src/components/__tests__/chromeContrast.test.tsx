import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material'
import { getLuminance } from '@mui/material/styles'
import { themesByName } from '@renderer/themes'
import { contrast } from '@renderer/themes/__tests__/contrast'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { ENGRAVED_CHROME_THEMES, PLAIN_CHROME_THEMES, type ThemeName } from '@shared/types'
import TitleBar from '../TitleBar'

const THEME_NAMES = Object.keys(themesByName) as ThemeName[]

function renderBar(name: ThemeName): void {
  useSettingsStore.setState({ theme: name })
  render(
    <ThemeProvider theme={themesByName[name]}>
      <TitleBar />
    </ThemeProvider>
  )
}

/**
 * The title bar reads against itself (WCAG 1.4.11 for icons, 1.4.3 for text),
 * HTOO-572. It paints `secondary.main`, and its window icons and wordmark take
 * `secondary.contrastText`. A theme's overrides can still change what draws,
 * and the palette alone does not show that, so this renders the real bar and
 * reads the colour each theme draws. The template's test, for Midir's bar.
 */
describe('the title bar', () => {
  afterEach(cleanup)

  it.each(THEME_NAMES)('%s: icons are 3:1 and the wordmark 4.5:1 on the bar', (name) => {
    renderBar(name)
    const bar = themesByName[name].palette.secondary.main
    const drawn = (el: Element): string => getComputedStyle(el).color
    const icon = drawn(screen.getByRole('button', { name: 'Minimize' }))
    const wordmark = drawn(screen.getByText('Midir'))
    expect(contrast(icon, bar), `icon ${icon}`).toBeGreaterThanOrEqual(3)
    expect(contrast(wordmark, bar), `wordmark ${wordmark}`).toBeGreaterThanOrEqual(4.5)
  })

  // Dark bar text (danaan, grinneal) is engraved, not keylined: the black
  // keyline merges with a dark glyph and doubles its edges.
  it.each(THEME_NAMES)('%s: engraves dark text, keylines light, flattens plain', (name) => {
    renderBar(name)
    const shadow = getComputedStyle(screen.getByText('Midir')).textShadow
    const ENGRAVE = /rgba\(255, ?248, ?232/
    if (PLAIN_CHROME_THEMES.includes(name)) {
      // Flat: no keyline and no engrave. (jsdom reports `none` as a transparent
      // colour, so assert what is absent rather than the keyword.)
      expect(shadow).not.toMatch(ENGRAVE)
      expect(shadow).not.toMatch(/#000|rgb\(0, 0, 0\)/)
    } else if (ENGRAVED_CHROME_THEMES.includes(name)) expect(shadow).toMatch(ENGRAVE)
    else {
      expect(shadow).not.toMatch(ENGRAVE)
      expect(shadow).toMatch(/#000/)
    }
  })

  it('engraves exactly the decorated themes whose bar text is dark', () => {
    // The flag is explicit, so a palette tweak near the line cannot flip a
    // theme's chrome by accident. This keeps it honest: the list must match the
    // bar text, and a change to either fails here until both agree.
    const darkText = THEME_NAMES.filter(
      (n) =>
        !PLAIN_CHROME_THEMES.includes(n) &&
        getLuminance(themesByName[n].palette.secondary.contrastText) < 0.18
    )
    expect([...ENGRAVED_CHROME_THEMES].sort()).toEqual(darkText.sort())
    expect([...ENGRAVED_CHROME_THEMES].sort()).toEqual(['danaan', 'grinneal'])
  })
})
