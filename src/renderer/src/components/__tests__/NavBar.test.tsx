import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import NavBar, { type ViewName } from '../NavBar'
import { themesByName } from '@renderer/themes'
import { blend, contrast, parseColor } from '@renderer/lib/contrast'
import { useSettingsStore } from '@renderer/store/settingsStore'
import type { ThemeName } from '@shared/types'

// From the registry, so a new theme is covered unasked.
const THEME_NAMES = Object.keys(themesByName) as ThemeName[]

function renderNav(
  options: { value?: ViewName; showDiagnostics?: boolean; theme?: ThemeName } = {}
): ReturnType<typeof vi.fn> {
  const { value = 'items', showDiagnostics = true, theme = 'hybrasyl' } = options
  const onChange = vi.fn()
  useSettingsStore.setState({ theme })
  render(
    <ThemeProvider theme={themesByName[theme]}>
      <NavBar value={value} onChange={onChange} showDiagnostics={showDiagnostics} />
    </ThemeProvider>
  )
  return onChange
}

/** A view's button on the bar. */
function view(label: string): HTMLElement {
  return screen.getByRole('button', { name: label })
}

afterEach(() => {
  cleanup()
  useSettingsStore.setState({ theme: 'hybrasyl' })
})

describe('NavBar', () => {
  it('is a bar, not a tab strip — the house nav bar', () => {
    renderNav()
    expect(screen.getByTestId('nav-bar')).toHaveClass('MuiToolbar-root')
    expect(screen.getByRole('navigation', { name: 'Views' })).toBeInTheDocument()
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
  })

  it('shows the Diagnostics button when it is on', () => {
    renderNav({ showDiagnostics: true })
    expect(view('Diagnostics')).toBeInTheDocument()
  })

  it('hides the Diagnostics button when it is off', () => {
    renderNav({ showDiagnostics: false })
    expect(screen.queryByRole('button', { name: 'Diagnostics' })).not.toBeInTheDocument()
    // The other views stay.
    expect(view('Live')).toBeInTheDocument()
    expect(view('Settings')).toBeInTheDocument()
  })

  it('marks the current view for assistive tech, not just by colour', () => {
    renderNav({ value: 'walker' })
    expect(view('Walker')).toHaveAttribute('aria-current', 'page')
    expect(view('Items')).not.toHaveAttribute('aria-current')
  })

  it('marks no view while the theme gallery shows', () => {
    renderNav({ value: 'gallery' })
    const bar = screen.getByTestId('nav-bar')
    expect(bar.querySelector('[aria-current]')).toBeNull()
  })

  it('switches the view on click', async () => {
    const onChange = renderNav()
    await userEvent.click(view('Errands'))
    expect(onChange).toHaveBeenCalledWith('laborer')
  })

  it('never marks Report an issue as the current view', () => {
    renderNav()
    expect(view('Report an issue')).not.toHaveAttribute('aria-current')
  })
})

/**
 * The bar paints `tertiary.main` (HTOO-629), so each thing on it is measured
 * against that colour, as each theme draws it. A word on a button is text, so
 * 4.5:1 (WCAG 1.4.3); an icon is 3:1 (1.4.11). An `opacity` is not in an
 * element's computed colour, so a faded part passes a colour check and still
 * fails on screen: nothing on the bar may be faded.
 */
describe('NavBar contrast', () => {
  it.each(THEME_NAMES)('%s: the bar paints tertiary.main, and nothing on it is faded', (name) => {
    renderNav({ theme: name })
    const bar = screen.getByTestId('nav-bar')
    expect(parseColor(getComputedStyle(bar).backgroundColor)).toEqual(
      parseColor(themesByName[name].palette.tertiary.main)
    )
    const faded = [bar, ...bar.querySelectorAll('*')]
      .filter((el) => Number(getComputedStyle(el).opacity || '1') < 1)
      .map((el) => el.getAttribute('aria-label') ?? el.textContent ?? el.tagName)
    expect(faded).toEqual([])
  })

  it.each(THEME_NAMES)('%s: a view and the current view are 4.5:1 on the bar', (name) => {
    renderNav({ theme: name, value: 'items' })
    const bar = themesByName[name].palette.tertiary.main
    const measure = (label: string): { ratio: number; style: CSSStyleDeclaration } => {
      const style = getComputedStyle(view(label))
      // A text button at rest has no fill: MUI v9 gives it a CSS variable that
      // jsdom does not resolve. The current view's wash is a literal colour.
      const fill = style.backgroundColor.startsWith('var(')
        ? 'rgba(0, 0, 0, 0)'
        : style.backgroundColor
      return { ratio: contrast(style.color, blend(fill, bar)), style }
    }
    const rest = measure('Live')
    const current = measure('Items')
    expect(rest.ratio, 'a view').toBeGreaterThanOrEqual(4.5)
    expect(current.ratio, 'the current view').toBeGreaterThanOrEqual(4.5)
    // The ring and the wash, not a colour, mark the current view.
    expect(current.style.boxShadow).toMatch(/inset/)
    expect(current.style.backgroundColor).not.toBe(rest.style.backgroundColor)
  })

  it.each(THEME_NAMES)('%s: the Report an issue icon is 3:1 on the bar', (name) => {
    renderNav({ theme: name })
    const bar = themesByName[name].palette.tertiary.main
    const icon = getComputedStyle(view('Report an issue').querySelector('svg')!).color
    expect(contrast(icon, bar)).toBeGreaterThanOrEqual(3)
  })
})
