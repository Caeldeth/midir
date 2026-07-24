import type { AssistState, AssistWindow, SpeakerState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSpeakerStore } from '../speakerStore'

const WINDOW: AssistWindow = {
  connectionId: 'A',
  windowHandle: 1000,
  title: 'Dark Ages',
  characterName: 'Alice'
}

describe('useSpeakerStore', () => {
  beforeEach(() => {
    useSpeakerStore.setState({
      windows: [],
      selected: '',
      stopped: false,
      stopReason: undefined,
      running: {},
      busy: false,
      error: null
    })
  })

  it('reads the windows, the stop state, and the running speakers together', async () => {
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    window.api.assist.state = vi.fn(async () => ({ stopped: true, reason: 'test' }))
    window.api.speaker.state = vi.fn(async () => [{ connectionId: 'A', running: true }])

    await useSpeakerStore.getState().refresh()
    expect(useSpeakerStore.getState().windows).toHaveLength(1)
    expect(useSpeakerStore.getState().stopped).toBe(true)
    expect(useSpeakerStore.getState().running.A?.running).toBe(true)
  })

  it('keeps a start failure to show the user', async () => {
    window.api.speaker.start = vi.fn(async () => {
      throw new Error('No character is logged in on the selected window.')
    })
    await useSpeakerStore
      .getState()
      .start({ lines: ['x'], intervalMs: 5000, repeat: true, connectionId: 'A' })
    expect(useSpeakerStore.getState().error).toBe(
      'No character is logged in on the selected window.'
    )
    expect(useSpeakerStore.getState().busy).toBe(false)
  })

  it('mirrors the stop state pushed from main', () => {
    let push: ((state: AssistState) => void) | undefined
    window.api.assist.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.speaker.onState = vi.fn(() => () => undefined)

    const stop = useSpeakerStore.getState().subscribe()
    push?.({ stopped: true, reason: 'the game window closed' })
    expect(useSpeakerStore.getState().stopped).toBe(true)
    expect(useSpeakerStore.getState().stopReason).toBe('the game window closed')
    stop()
  })

  it('clears the stop banner at once, before the push confirms', async () => {
    useSpeakerStore.setState({ stopped: true, stopReason: 'test' })
    window.api.assist.clearStop = vi.fn(async () => undefined)
    await useSpeakerStore.getState().clearStop()
    expect(useSpeakerStore.getState().stopped).toBe(false)
    expect(window.api.assist.clearStop).toHaveBeenCalledOnce()
  })

  it('toggle starts the selected window when nothing runs, and stops it when it does', () => {
    window.api.speaker.start = vi.fn(async () => undefined)
    window.api.speaker.stop = vi.fn(async () => undefined)
    useSpeakerStore.setState({ selected: 'A', running: {} })

    useSpeakerStore.getState().toggle()
    expect(window.api.speaker.start).toHaveBeenCalledOnce()

    useSpeakerStore.setState({ running: { A: { connectionId: 'A', running: true } } })
    useSpeakerStore.getState().toggle()
    expect(window.api.speaker.stop).toHaveBeenCalledWith('A')
  })

  it('toggle does nothing with no window selected', () => {
    window.api.speaker.start = vi.fn(async () => undefined)
    useSpeakerStore.setState({ selected: '' })
    useSpeakerStore.getState().toggle()
    expect(window.api.speaker.start).not.toHaveBeenCalled()
  })

  it('runs toggle when the hotkey event arrives', () => {
    let fire: (() => void) | undefined
    window.api.speaker.onToggle = vi.fn((handler) => {
      fire = handler
      return () => undefined
    })
    window.api.assist.onState = vi.fn(() => () => undefined)
    window.api.speaker.onState = vi.fn(() => () => undefined)
    window.api.speaker.start = vi.fn(async () => undefined)
    useSpeakerStore.setState({ selected: 'A', running: {} })

    const stop = useSpeakerStore.getState().subscribe()
    fire?.()
    expect(window.api.speaker.start).toHaveBeenCalledOnce()
    stop()
  })

  it('adds and removes a running speaker on a pushed state', () => {
    let push: ((state: SpeakerState) => void) | undefined
    window.api.speaker.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.assist.onState = vi.fn(() => () => undefined)

    const stop = useSpeakerStore.getState().subscribe()
    push?.({ connectionId: 'A', running: true })
    expect(useSpeakerStore.getState().running.A).toBeDefined()
    push?.({ connectionId: 'A', running: false })
    expect(useSpeakerStore.getState().running.A).toBeUndefined()
    stop()
  })
})
