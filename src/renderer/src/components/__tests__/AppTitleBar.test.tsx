import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { hybrasylTheme, themesByName } from '@renderer/themes'
import { contrast } from '@renderer/lib/contrast'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { appIdentity } from '@shared/appIdentity'
import type { ThemeName } from '@shared/types'
import AppTitleBar from '../AppTitleBar'

function renderAppTitleBar(theme = hybrasylTheme): void {
  render(
    <ThemeProvider theme={theme}>
      <AppTitleBar />
    </ThemeProvider>
  )
}

/** Midir's wiring of the house TitleBar: its name, its indicator, and the preload bridge. */
describe('AppTitleBar', () => {
  it("shows the app's product name", () => {
    renderAppTitleBar()
    expect(screen.getByTestId('title-bar')).toHaveTextContent(appIdentity.productName)
  })

  it('puts the capture indicator in the bar controls, before the window buttons', () => {
    renderAppTitleBar()
    const controls = screen.getByTestId('title-bar-controls')
    expect(within(controls).getByTestId('capture-indicator')).toBeInTheDocument()
    const order = [...screen.getByTestId('title-bar').querySelectorAll('[data-testid], button')]
      .map((el) => el.getAttribute('data-testid') ?? el.getAttribute('aria-label'))
      .filter((key) => key !== 'title-bar-controls')
    expect(order).toEqual(['capture-indicator', 'Minimize', 'Maximize', 'Close'])
  })

  it('wires the window buttons to the preload bridge', async () => {
    const user = userEvent.setup()
    renderAppTitleBar()

    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(window.api.minimizeWindow).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(window.api.maximizeWindow).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.api.closeWindow).toHaveBeenCalledOnce()
  })

  // The indicator is a status display, not an icon control, so it is not a
  // ChromeButton. Its label takes secondary.contrastText, the bar's own text.
  // danaan and grinneal have dark bars now, so this reads it in each theme.
  it.each(Object.keys(themesByName) as ThemeName[])(
    '%s: the capture label is 4.5:1 on the bar',
    (name) => {
      useSettingsStore.setState({ theme: name })
      renderAppTitleBar(themesByName[name])
      const label = within(screen.getByTestId('capture-indicator')).getByText('Not capturing')
      const bar = themesByName[name].palette.secondary.main
      expect(contrast(getComputedStyle(label).color, bar)).toBeGreaterThanOrEqual(4.5)
    }
  )
})
