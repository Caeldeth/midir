import { cleanup, render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { themesByName } from '@renderer/themes'
import type { ThemeName } from '@shared/types'
import { STOPPED_STATUS, type CaptureStatus } from '@shared/types'
import React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import CaptureIndicator from '../CaptureIndicator'
import { useCaptureStore } from '../../store/captureStore'

function setStatus(status: Partial<CaptureStatus>): void {
  useCaptureStore.setState({ status: { ...STOPPED_STATUS, ...status } })
}

describe('CaptureIndicator', () => {
  beforeEach(() => {
    setStatus({})
  })

  it('says capture is off when it is stopped', () => {
    render(<CaptureIndicator />)
    expect(screen.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'stopped')
    expect(screen.getByText('Not capturing')).toBeInTheDocument()
  })

  it('says it is listening once capture is running', () => {
    setStatus({ running: true, state: 'listening' })
    render(<CaptureIndicator />)
    expect(screen.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'listening')
    expect(screen.getByText('Listening')).toBeInTheDocument()
  })

  it('names the character it is decoding', () => {
    setStatus({ running: true, state: 'decoding', characters: ['Sabrael'] })
    render(<CaptureIndicator />)
    expect(screen.getByText('Sabrael')).toBeInTheDocument()
  })

  it('shows a count, not a name, for two clients at once', () => {
    // The title bar has no room for two names, so it shows how many and puts
    // the names in the tooltip.
    setStatus({ running: true, state: 'decoding', characters: ['Sabrael', 'Deoradhan'] })
    render(<CaptureIndicator />)
    expect(screen.getByText('2 characters')).toBeInTheDocument()
  })

  it('warns about a missed handshake ahead of everything else', () => {
    // The user can fix this one, so it has to outrank the running state.
    setStatus({
      running: true,
      state: 'decoding',
      characters: ['Sabrael'],
      missedHandshake: true
    })
    render(<CaptureIndicator />)
    expect(screen.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'warning')
    expect(screen.getByText('Idle')).toBeInTheDocument()
  })

  it.each(Object.keys(themesByName) as ThemeName[])(
    '%s: rings the dot in the bar text colour, so it shows on the bar',
    (name) => {
      // The dot's status colour can be close to the bar colour. The ring is
      // secondary.contrastText, which the palette test holds at 4.5:1 on the bar.
      const theme = themesByName[name]
      render(
        <ThemeProvider theme={theme}>
          <CaptureIndicator />
        </ThemeProvider>
      )
      const shadow = getComputedStyle(
        screen.getByTestId('capture-indicator').firstElementChild!
      ).boxShadow.toLowerCase()
      expect(shadow).toContain(theme.palette.secondary.contrastText.toLowerCase())
      cleanup()
    }
  )
})
