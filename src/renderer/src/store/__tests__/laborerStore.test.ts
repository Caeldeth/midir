import type { AssistState, AssistWindow, Errand, LaborerState } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { errandOutcomeMessage, useLaborerStore } from '../laborerStore'

const WINDOW: AssistWindow = {
  connectionId: 'A',
  windowHandle: 1000,
  title: 'Dark Ages',
  characterName: 'Alice'
}

const ERRAND: Errand = { name: 'Clout', destination: 3025, npcName: 'Donnan', steps: [] }

describe('useLaborerStore', () => {
  beforeEach(() => {
    useLaborerStore.setState({
      windows: [],
      errands: [],
      selected: '',
      errand: '',
      stopped: false,
      stopReason: undefined,
      running: {},
      lastOutcome: undefined,
      busy: false,
      error: null
    })
  })

  it('reads the windows, stop state, laborers, and errands together', async () => {
    window.api.assist.windows = vi.fn(async () => [WINDOW])
    window.api.assist.state = vi.fn(async () => ({ stopped: true, reason: 'test' }))
    window.api.laborer.state = vi.fn(async () => [
      { connectionId: 'A', running: true, errand: 'Clout', step: 1 }
    ])
    window.api.laborer.list = vi.fn(async () => [ERRAND])

    await useLaborerStore.getState().refresh()
    expect(useLaborerStore.getState().windows).toHaveLength(1)
    expect(useLaborerStore.getState().stopped).toBe(true)
    expect(useLaborerStore.getState().running.A?.running).toBe(true)
    expect(useLaborerStore.getState().errands).toEqual([ERRAND])
  })

  it('does nothing with no window or no errand', () => {
    window.api.laborer.run = vi.fn(async () => ({ kind: 'done' as const }))
    useLaborerStore.getState().run('', 'Clout')
    useLaborerStore.getState().run('A', '')
    expect(window.api.laborer.run).not.toHaveBeenCalled()
  })

  it('keeps the outcome when an errand ends', async () => {
    window.api.laborer.run = vi.fn(async () => ({
      kind: 'stopped' as const,
      reason: 'unmatchedDialog' as const,
      saw: 'pursuit 0x99'
    }))
    useLaborerStore.getState().run('A', 'Clout')
    await vi.waitFor(() =>
      expect(useLaborerStore.getState().lastOutcome).toEqual({
        kind: 'stopped',
        reason: 'unmatchedDialog',
        saw: 'pursuit 0x99'
      })
    )
  })

  it('keeps a run failure to show the user', async () => {
    window.api.laborer.run = vi.fn(async () => {
      throw new Error('No character is logged in on the selected window.')
    })
    useLaborerStore.getState().run('A', 'Clout')
    await vi.waitFor(() =>
      expect(useLaborerStore.getState().error).toBe(
        'No character is logged in on the selected window.'
      )
    )
  })

  it('adds and removes a running laborer on a pushed state', () => {
    let push: ((state: LaborerState) => void) | undefined
    window.api.laborer.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.assist.onState = vi.fn(() => () => undefined)

    const stop = useLaborerStore.getState().subscribe()
    push?.({ connectionId: 'A', running: true, errand: 'Clout', step: 0 })
    expect(useLaborerStore.getState().running.A).toBeDefined()
    push?.({ connectionId: 'A', running: false, errand: 'Clout', step: 2 })
    expect(useLaborerStore.getState().running.A).toBeUndefined()
    stop()
  })

  it('mirrors the stop state pushed from main', () => {
    let push: ((state: AssistState) => void) | undefined
    window.api.assist.onState = vi.fn((handler) => {
      push = handler
      return () => undefined
    })
    window.api.laborer.onState = vi.fn(() => () => undefined)

    const stop = useLaborerStore.getState().subscribe()
    push?.({ stopped: true, reason: 'you pressed stop' })
    expect(useLaborerStore.getState().stopped).toBe(true)
    stop()
  })

  it('reports an outcome as a line', () => {
    expect(errandOutcomeMessage({ kind: 'done' })).toBe('The errand finished.')
    expect(errandOutcomeMessage({ kind: 'stopped', reason: 'protected' })).toContain('login')
    expect(
      errandOutcomeMessage({ kind: 'stopped', reason: 'unmatchedDialog', saw: 'pursuit 0x99' })
    ).toContain('pursuit 0x99')
  })
})
