import React from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { hybrasylTheme } from '@renderer/themes'
import TitleBar from '../TitleBar'

function renderTitleBar(): void {
  render(
    <ThemeProvider theme={hybrasylTheme}>
      <TitleBar />
    </ThemeProvider>
  )
}

describe('TitleBar', () => {
  it('renders the app title', () => {
    renderTitleBar()
    expect(screen.getByTestId('title-bar')).toHaveTextContent('Midir')
  })

  it('wires the window-control buttons to the preload bridge', async () => {
    const user = userEvent.setup()
    renderTitleBar()

    await user.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(window.api.minimizeWindow).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Maximize' }))
    expect(window.api.maximizeWindow).toHaveBeenCalledOnce()

    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(window.api.closeWindow).toHaveBeenCalledOnce()
  })
})
