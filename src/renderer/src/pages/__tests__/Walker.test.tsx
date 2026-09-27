import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWalkerStore } from '@renderer/store/walkerStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
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
  { mapId: 3, name: 'Hidden Cave', reachable: false },
  // Reachable, but only over a warp the imported world data proposes (WP24).
  { mapId: 401, name: 'Mileth Black Magic Master', reachable: true, viaUnconfirmed: true }
]

beforeEach(() => {
  useWalkerStore.setState({ destinations: PLACES, selectedWindow: '1', destination: '' })
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

  it('offers a place whose only route is unconfirmed, and says so', async () => {
    // Midir had the way to this map from its imported data and refused to use
    // it, reporting no route at all (2026-09-27).
    render(<Walker />)
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Destination'), 'Mileth Black Magic Master')
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeEnabled())
    expect(screen.getByText(/imported map data, which no walk has confirmed/)).toBeInTheDocument()
  })

  it('pins a spot under a name the user gives it, and fills the fields again from it', async () => {
    // "Mileth Altar" is a reactor on Mileth Village, so the label is not the map
    // name (Sabrael, 2026-09-27).
    useSettingsStore.setState({ walkerPinnedDestinations: [] })
    render(<Walker />)
    await waitFor(() => expect(screen.getByTestId('walker-go')).toBeInTheDocument())
    await userEvent.type(screen.getByLabelText('Destination'), 'Field')
    await userEvent.type(screen.getByLabelText('End x'), '12')
    await userEvent.type(screen.getByLabelText('End y'), '15')
    await userEvent.click(screen.getByRole('button', { name: 'Pin this destination' }))

    const name = await screen.findByLabelText('Pin name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Mileth Altar')
    await userEvent.click(screen.getByTestId('walker-pin-save'))

    expect(useSettingsStore.getState().walkerPinnedDestinations).toEqual([
      { label: 'Mileth Altar', destination: 'Field', tile: { x: 12, y: 15 } }
    ])
    const chip = await screen.findByTestId('walker-pin')
    expect(chip).toHaveTextContent('Mileth Altar')

    // Picking it puts the place and the tile back in the fields.
    await userEvent.clear(screen.getByLabelText('End x'))
    await userEvent.click(chip)
    expect(screen.getByLabelText('End x')).toHaveValue('12')
    expect(screen.getByLabelText('Destination')).toHaveValue('Field')
  })

  it('asks main for the destinations of the window it drives', async () => {
    render(<Walker />)
    await waitFor(() => expect(window.api.walker.destinations).toHaveBeenCalled())
    expect(window.api.walker.destinations).toHaveBeenCalledWith('c1')
  })
})
