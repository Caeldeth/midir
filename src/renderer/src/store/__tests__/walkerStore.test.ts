import type { AssistState, AssistWindow, WalkerState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { outcomeMessage, useWalkerStore } from '../walkerStore'

const WINDOW: AssistWindow = {
  connectionId: 'A',
  windowHandle: 1000,
  title: 'Dark Ages',
  characterName: 'Alice'
}

describe('useWalkerStore', () => {
  beforeEach(() => {
    useWalkerStore.setState({
      windows: [],
      destinations: [],
      selected: '',
      destination: '',
      stopped: false,
      stopReason: undefined,
      running: {},
      lastOutcome: undefined,
      busy: false,
      error: null
    })
  })

  it('reads the windows, stop state, walkers, and destinations together', async () => {
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    window.api.assist.state = vi.fn(async () => ({ stopped: true, reason: 'test' }))
    window.api.walker.state = vi.fn(async () => [
      { connectionId: 'A', running: true, stepsTaken: 3 }
    ])
    window.api.walker.destinations = vi.fn(async () => [{ mapId: 500, name: 'Mileth' }])

    await useWalkerStore.getState().refresh()
    expect(useWalkerStore.getState().windows).toHaveLength(1)
    expect(useWalkerStore.getState().stopped).toBe(true)
    expect(useWalkerStore.getState().running.A?.running).toBe(true)
    expect(useWalkerStore.getState().destinations).toEqual([{ mapId: 500, name: 'Mileth' }])
  })

  it('does nothing with no window or no destination', () => {
    window.api.walker.go = vi.fn(async () => ({ kind: 'arrived' as const }))
    useWalkerStore.getState().go('', 'Mileth')
    useWalkerStore.getState().go('A', '   ')
    expect(window.api.walker.go).not.toHaveBeenCalled()
  })

  it('keeps the outcome when a walk ends', async () => {
    window.api.walker.go = vi.fn(async () => ({
      kind: 'stopped' as const,
      reason: 'blocked' as const
    }))
    useWalkerStore.getState().go('A', 'Mileth')
    // The go call resolves on the next microtask.
    await vi.waitFor(() =>
      expect(useWalkerStore.getState().lastOutcome).toEqual({ kind: 'stopped', reason: 'blocked' })
    )
  })

  it('keeps a go failure to show the user', async () => {
    window.api.walker.go = vi.fn(async () => {
      throw new Error('No character is logged in on the selected window.')
    })
    useWalkerStore.getState().go('A', 'Mileth')
    await vi.waitFor(() =>
      expect(useWalkerStore.getState().error).toBe(
        'No character is logged in on the selected window.'
      )
    )
  })

  it('mirrors the stop state pushed from main', () => {
    let push: ((state: AssistState) => void) | undefined
    window.api.assist.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.walker.onState = vi.fn(() => () => undefined)

    const stop = useWalkerStore.getState().subscribe()
    push?.({ stopped: true, reason: 'the game window closed' })
    expect(useWalkerStore.getState().stopped).toBe(true)
    stop()
  })

  it('adds and removes a running walker on a pushed state', () => {
    let push: ((state: WalkerState) => void) | undefined
    window.api.walker.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.assist.onState = vi.fn(() => () => undefined)

    const stop = useWalkerStore.getState().subscribe()
    push?.({ connectionId: 'A', running: true, stepsTaken: 0 })
    expect(useWalkerStore.getState().running.A).toBeDefined()
    push?.({ connectionId: 'A', running: false, stepsTaken: 5 })
    expect(useWalkerStore.getState().running.A).toBeUndefined()
    stop()
  })

  it('reports an outcome as a line', () => {
    expect(outcomeMessage({ kind: 'arrived' })).toBe('Arrived.')
    expect(outcomeMessage({ kind: 'stopped', reason: 'noRoute' })).toBe(
      'There is no route to that place.'
    )
  })
})
