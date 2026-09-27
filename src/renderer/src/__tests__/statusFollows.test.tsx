import { act, render, screen, waitFor } from '@testing-library/react'
import { STOPPED_STATUS, type CaptureStatus } from '@shared/types'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import App from '../App'

/**
 * The title bar follows what capture is doing, by two paths.
 *
 * The push is the ordinary one. The re-read on the window's return is the
 * reconciliation, because nothing else checks the push: Midir sits behind the
 * game window all session, and the indicator read wrong until a visit to
 * Settings, which was the one tab that asked main again (Sabrael, 2026-09-27).
 */

const DECODING: CaptureStatus = {
  ...STOPPED_STATUS,
  running: true,
  state: 'decoding',
  characters: ['Gabrael']
}

describe('the title bar', () => {
  it('names the character a push names, with no tab to visit', async () => {
    let push: ((status: CaptureStatus) => void) | undefined
    window.api.capture.onStatus = vi.fn((handler) => {
      push = handler
      return () => undefined
    })

    render(<App />)
    await waitFor(() => expect(push).toBeDefined())
    expect(screen.getByText('Not capturing')).toBeInTheDocument()

    act(() => push!(DECODING))
    expect(screen.getByText('Gabrael')).toBeInTheDocument()
  })

  it('reads the status again when the window comes back', async () => {
    // Nothing pushes here: the point is that the return of the window is enough.
    window.api.capture.status = vi.fn(async () => DECODING)

    render(<App />)
    await waitFor(() => expect(screen.getByTestId('capture-indicator')).toBeInTheDocument())

    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await waitFor(() => expect(screen.getByText('Gabrael')).toBeInTheDocument())
  })

  it('asks nothing while the window is hidden', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('capture-indicator')).toBeInTheDocument())
    const status = vi.fn(async () => DECODING)
    window.api.capture.status = status

    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(status).not.toHaveBeenCalled()
  })
})
