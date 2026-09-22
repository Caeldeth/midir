import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWalkerStore } from '@renderer/store/walkerStore'
import type { WalkerDestination } from '@shared/actionLayer'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Walker from '../Walker'

/**
 * A place with no route the graph knows is shown, dimmed, and cannot be
 * walked to (WP39). Midir marks it from where the character stands; the
 * player is told why, rather than watching Go fail.
 */

const PLACES: WalkerDestination[] = [
  { mapId: 2, name: 'Field', reachable: true },
  { mapId: 3, name: 'Hidden Cave', reachable: false }
]

beforeEach(() => {
  useWalkerStore.setState({ destinations: PLACES, selected: 'c1', destination: '' })
  window.api.assist.windows = vi.fn(async () => [
    {
      connectionId: 'c1',
      title: 'Dark Ages',
      characterName: 'Test',
      processId: 1,
      windowHandle: 1
    }
  ])
  window.api.walker.destinations = vi.fn(async () => PLACES)
})

describe('a destination Midir cannot reach', () => {
  it('turns Go off and says why, and leaves a reachable place alone', async () => {
    render(<Walker />)
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeInTheDocument())

    const destination = screen.getByLabelText('Destination')
    await userEvent.type(destination, 'Hidden Cave')
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeDisabled())
    expect(screen.getByText(/knows no way to walk there/)).toBeInTheDocument()

    await userEvent.clear(destination)
    await userEvent.type(destination, 'Field')
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeEnabled())
  })

  it('asks main for the destinations of the window it drives', async () => {
    render(<Walker />)
    await waitFor(() => expect(window.api.walker.destinations).toHaveBeenCalled())
    expect(window.api.walker.destinations).toHaveBeenCalledWith('c1')
  })
})
