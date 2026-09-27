import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useExplorerStore } from '@renderer/store/explorerStore'
import { useWalkerStore } from '@renderer/store/walkerStore'
import type { AssistWindow, ExplorerState } from '@shared/types'
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ExplorerCard from '../ExplorerCard'

/**
 * The explorer's panel (WP41). It drives the window the Walker is pointed at,
 * it ships off, and it states what a run is doing while it runs.
 */

const WINDOW: AssistWindow = {
  connectionId: 'c1',
  title: 'Dark Ages',
  characterName: 'Test',
  windowHandle: 1
}

const RUN: ExplorerState = {
  connectionId: 'c1',
  running: true,
  visited: 3,
  remaining: 11,
  skipped: 2,
  budget: { maps: 20, minutes: 15 },
  avoidingHostile: true,
  target: { mapId: 3049, name: 'Rucesion Hall' }
}

beforeEach(() => {
  useWalkerStore.setState({ selectedWindow: '1', windows: [WINDOW] })
  useExplorerStore.setState({
    running: {},
    maps: '20',
    minutes: '15',
    avoidHostile: true,
    busy: false,
    error: null,
    lastOutcome: undefined
  })
})

describe('the explorer panel', () => {
  it('drives nothing until a window is picked', async () => {
    useWalkerStore.setState({ selectedWindow: '', windows: [] })
    render(<ExplorerCard />)
    expect(screen.getByTestId('explorer-start')).toBeDisabled()
    expect(screen.getByText(/Pick a game window above/)).toBeInTheDocument()
    await waitFor(() => expect(window.api.explorer.state).toHaveBeenCalled())
    expect(window.api.explorer.start).not.toHaveBeenCalled()
  })

  it('starts a run on the picked window, with the budget from the fields', async () => {
    render(<ExplorerCard />)
    await userEvent.clear(screen.getByLabelText('Maps'))
    await userEvent.type(screen.getByLabelText('Maps'), '5')
    await userEvent.click(screen.getByTestId('explorer-start'))
    expect(window.api.explorer.start).toHaveBeenCalledWith({
      connectionId: 'c1',
      budget: { maps: 5, minutes: 15 },
      avoidHostile: true
    })
  })

  it('leaves a blank field out, so the explorer applies its own default', async () => {
    render(<ExplorerCard />)
    await userEvent.clear(screen.getByLabelText('Maps'))
    await userEvent.click(screen.getByTestId('explorer-start'))
    expect(window.api.explorer.start).toHaveBeenCalledWith({
      connectionId: 'c1',
      budget: { minutes: 15 },
      avoidHostile: true
    })
  })

  it('says where the run is going and what it has counted', async () => {
    // The panel asks main for the runs as it mounts, so the mock is the source.
    window.api.explorer.state = vi.fn(async () => [RUN])
    render(<ExplorerCard />)
    const status = screen.getByTestId('explorer-status')
    await waitFor(() => expect(status).toHaveTextContent('Walking to Rucesion Hall (3049).'))
    expect(status).toHaveTextContent('3 visited of 20')
    expect(status).toHaveTextContent('11 unread within reach')
    expect(status).toHaveTextContent('2 set aside')
  })

  it('offers Stop while a run is going, and stops it', async () => {
    window.api.explorer.state = vi.fn(async () => [RUN])
    render(<ExplorerCard />)
    await waitFor(() => expect(screen.getByTestId('explorer-stop')).toBeInTheDocument())
    expect(screen.queryByTestId('explorer-start')).not.toBeInTheDocument()
    await userEvent.click(screen.getByTestId('explorer-stop'))
    expect(window.api.explorer.stop).toHaveBeenCalledWith('c1')
  })

  it('sends the hostile-map choice, and says so while the run is going', async () => {
    render(<ExplorerCard />)
    await userEvent.click(screen.getByTestId('explorer-avoid-hostile'))
    await userEvent.click(screen.getByTestId('explorer-start'))
    expect(window.api.explorer.start).toHaveBeenCalledWith(
      expect.objectContaining({ avoidHostile: false })
    )
  })

  it('says it is keeping out of hostile maps while a run is going', async () => {
    window.api.explorer.state = vi.fn(async () => [RUN])
    render(<ExplorerCard />)
    await waitFor(() =>
      expect(screen.getByTestId('explorer-status')).toHaveTextContent('keeping out of hostile maps')
    )
  })

  it('says how the run ended once it is over', () => {
    useExplorerStore.setState({ lastOutcome: { kind: 'ended', reason: 'budget' } })
    render(<ExplorerCard />)
    expect(screen.getByTestId('explorer-status')).toHaveTextContent('reached its budget')
  })

  it('shows a failure from main', () => {
    useExplorerStore.setState({ error: 'The explorer is already running on this window.' })
    render(<ExplorerCard />)
    expect(screen.getByText(/already running/)).toBeInTheDocument()
  })

  it('does not drive a window that has closed', async () => {
    useWalkerStore.setState({ selectedWindow: '1', windows: [] })
    window.api.explorer.state = vi.fn(async () => [RUN])
    render(<ExplorerCard />)
    await waitFor(() => expect(window.api.explorer.state).toHaveBeenCalled())
    expect(screen.getByTestId('explorer-start')).toBeDisabled()
  })

  it('keeps the pick through a logout, and waits for the next login', () => {
    // The client is still open, so the window stays picked. It carries no
    // connection until someone logs in, and there is nothing to drive yet.
    useWalkerStore.setState({
      selectedWindow: '1',
      windows: [{ windowHandle: 1, title: 'Dark Ages' }]
    })
    render(<ExplorerCard />)
    expect(screen.getByTestId('explorer-start')).toBeDisabled()
    expect(screen.getByText(/Log in on that client/)).toBeInTheDocument()
  })

  it('watches for pushed run states, and stops watching when it goes away', () => {
    const unsubscribe = vi.fn()
    window.api.explorer.onState = vi.fn(() => unsubscribe)
    const view = render(<ExplorerCard />)
    expect(window.api.explorer.onState).toHaveBeenCalled()
    view.unmount()
    expect(unsubscribe).toHaveBeenCalled()
  })
})
