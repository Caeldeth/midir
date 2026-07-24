import { describe, expect, it, vi } from 'vitest'
import type { ActionRefusal, ActionTarget, SpeakerState } from '../../shared/types'
import type { ActionLayer } from '../actionLayer'
import { createSpeaker, type Sleeper } from '../speaker'

/**
 * The Speaker with a fake action layer. No game, and no real clock: an
 * injected sleep lets the test drive the loop one line at a time.
 */

interface Typed {
  handle: number
  text: string
}

/** A controllable action layer. */
function fakeLayer() {
  let stopped = false
  const onStopByConn = new Map<string, (reason: string) => void>()
  const typed: Typed[] = []
  let typeResult: ActionRefusal | null = null
  let windowGone = false
  const disarm = vi.fn((id: string) => onStopByConn.delete(id))

  const handleOf = (connectionId: string): number => (connectionId === 'A' ? 1000 : 2000)

  const layer: ActionLayer = {
    resolveTarget: (connectionId): ActionTarget | null =>
      windowGone ? null : { connectionId, windowHandle: handleOf(connectionId) },
    listWindows: () => [],
    arm: (connectionId, onStop) => {
      if (windowGone) return 'noWindow'
      stopped = false
      if (onStop) onStopByConn.set(connectionId, onStop)
      return { connectionId, windowHandle: handleOf(connectionId) }
    },
    disarm,
    pressKey: async () => null,
    typeLine: async (target, text) => {
      if (stopped) return 'stopped'
      if (typeResult !== null) return typeResult
      typed.push({ handle: target.windowHandle, text })
      return null
    },
    get stopped() {
      return stopped
    },
    stopAll: (reason) => {
      stopped = true
      for (const cb of [...onStopByConn.values()]) cb(reason)
    },
    clearStop: () => {
      stopped = false
    },
    state: () => ({ stopped }),
    updateSettings: vi.fn(),
    register: vi.fn(),
    dispose: vi.fn()
  }

  return {
    layer,
    typed,
    disarm,
    setWindowGone: (v: boolean) => (windowGone = v),
    setTypeResult: (r: ActionRefusal | null) => (typeResult = r),
    stopFor: (id: string, reason: string) => onStopByConn.get(id)?.(reason)
  }
}

/** A sleep the test resolves by hand. */
function fakeSleeps() {
  const pending: { ms: number; resolve: () => void }[] = []
  const sleep = (ms: number): Sleeper => {
    let resolve: () => void = () => undefined
    const promise = new Promise<void>((r) => {
      resolve = r
    })
    pending.push({ ms, resolve })
    return { promise, cancel: () => resolve() }
  }
  return { sleep, pending }
}

const flush = async (): Promise<void> => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

const logFake = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), recent: () => [], filePath: '' }

function make(live: string[], sleeps = fakeSleeps()) {
  const layer = fakeLayer()
  const states: SpeakerState[] = []
  const speaker = createSpeaker({
    actionLayer: layer.layer,
    liveConnections: () => live.map((connectionId) => ({ connectionId, name: connectionId })),
    log: logFake,
    onState: (s) => states.push(s),
    now: () => 123,
    random: () => 0,
    sleep: sleeps.sleep
  })
  return { speaker, layer, states, sleeps }
}

describe('the Speaker', () => {
  it('rotates through the lines in order', async () => {
    const { speaker, layer, sleeps } = make(['A'])
    await speaker.start({
      lines: ['one', 'two', 'three'],
      intervalMs: 5000,
      repeat: true,
      connectionId: 'A'
    })
    await flush()
    // Advance three lines, resolving each interval sleep.
    for (let i = 0; i < 3; i++) {
      sleeps.pending.shift()?.resolve()
      await flush()
    }
    expect(layer.typed.map((t) => t.text)).toEqual(['one', 'two', 'three', 'one'])
  })

  it('without repeat, sends each line once in order and stops', async () => {
    const { speaker, layer, sleeps, states } = make(['A'])
    await speaker.start({
      lines: ['one', 'two'],
      intervalMs: 5000,
      repeat: false,
      connectionId: 'A'
    })
    await flush()
    // First line went; the interval sleep is pending before the second.
    sleeps.pending.shift()?.resolve()
    await flush()
    expect(layer.typed.map((t) => t.text)).toEqual(['one', 'two'])
    // No third line, and the run has ended.
    expect(speaker.states()).toHaveLength(0)
    expect(states.at(-1)).toMatchObject({ running: false, reason: 'the list finished' })
  })

  it('waits at least the interval floor between lines', async () => {
    const { speaker, sleeps } = make(['A'])
    await speaker.start({ lines: ['x'], intervalMs: 8000, repeat: true, connectionId: 'A' })
    await flush()
    expect(sleeps.pending[0]?.ms).toBeGreaterThanOrEqual(8000)
  })

  it('raises a sub-floor interval to the minimum', async () => {
    const { speaker, sleeps } = make(['A'])
    await speaker.start({ lines: ['x'], intervalMs: 10, repeat: true, connectionId: 'A' })
    await flush()
    expect(sleeps.pending[0]?.ms).toBeGreaterThanOrEqual(1000)
  })

  it('refuses to start with no live character', async () => {
    const { speaker, layer } = make([])
    await expect(
      speaker.start({ lines: ['x'], intervalMs: 5000, repeat: true, connectionId: 'A' })
    ).rejects.toThrow(/No character/)
    expect(layer.typed).toHaveLength(0)
  })

  it('refuses to start with no lines', async () => {
    const { speaker } = make(['A'])
    await expect(
      speaker.start({ lines: [], intervalMs: 5000, repeat: true, connectionId: 'A' })
    ).rejects.toThrow(/at least one line/)
  })

  it('stops within one line when the global stop fires', async () => {
    const { speaker, layer, states } = make(['A'])
    await speaker.start({ lines: ['a', 'b'], intervalMs: 5000, repeat: true, connectionId: 'A' })
    await flush()
    expect(layer.typed).toHaveLength(1)
    // The global stop reaches the Speaker through the arm callback.
    layer.layer.stopAll('the stop hotkey was pressed')
    await flush()
    expect(layer.typed).toHaveLength(1)
    expect(states.at(-1)).toMatchObject({ connectionId: 'A', running: false })
  })

  it('stops when the character logs off', async () => {
    const live = ['A']
    const sleeps = fakeSleeps()
    const layer = fakeLayer()
    const states: SpeakerState[] = []
    const speaker = createSpeaker({
      actionLayer: layer.layer,
      liveConnections: () => live.map((connectionId) => ({ connectionId, name: connectionId })),
      log: logFake,
      onState: (s) => states.push(s),
      sleep: sleeps.sleep,
      random: () => 0
    })
    await speaker.start({ lines: ['a'], intervalMs: 5000, repeat: true, connectionId: 'A' })
    await flush()
    // The character logs off, then the interval ends.
    live.length = 0
    sleeps.pending.shift()?.resolve()
    await flush()
    expect(states.at(-1)).toMatchObject({ running: false, reason: 'the character logged off' })
  })

  it('runs two speakers independently: stopping one leaves the other', async () => {
    const { speaker, layer } = make(['A', 'B'])
    await speaker.start({ lines: ['a'], intervalMs: 5000, repeat: true, connectionId: 'A' })
    await speaker.start({ lines: ['b'], intervalMs: 5000, repeat: true, connectionId: 'B' })
    await flush()
    expect(new Set(speaker.states().map((s) => s.connectionId))).toEqual(new Set(['A', 'B']))
    speaker.stop('A')
    expect(speaker.states().map((s) => s.connectionId)).toEqual(['B'])
    // A's line went to A's window, B's to B's window.
    expect(layer.typed.find((t) => t.text === 'a')?.handle).toBe(1000)
    expect(layer.typed.find((t) => t.text === 'b')?.handle).toBe(2000)
  })
})
