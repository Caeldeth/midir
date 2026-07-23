import { render, screen } from '@testing-library/react'
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
    setStatus({ running: true, state: 'decoding', characterName: 'Sabrael' })
    render(<CaptureIndicator />)
    expect(screen.getByText('Sabrael')).toBeInTheDocument()
  })

  it('warns about a missed handshake ahead of everything else', () => {
    // The user can fix this one, so it has to outrank the running state.
    setStatus({
      running: true,
      state: 'decoding',
      characterName: 'Sabrael',
      missedHandshake: true
    })
    render(<CaptureIndicator />)
    expect(screen.getByTestId('capture-indicator')).toHaveAttribute('data-state', 'warning')
    expect(screen.getByText('Start Midir first')).toBeInTheDocument()
  })
})
