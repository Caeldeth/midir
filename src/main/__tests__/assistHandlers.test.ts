import { describe, expect, it, vi } from 'vitest'
import {
  assistStopAll,
  assistWindows,
  speakerState,
  startSpeaker,
  startWalker,
  stopSpeaker,
  stopWalker,
  walkerState,
  type AssistHandlerContext
} from '../handlers/assist'
import type { ActionLayer } from '../actionLayer'
import type { Speaker } from '../speaker'
import type { Walker } from '../walker'

/**
 * The assist handler bodies, called directly with a fake action layer, a fake
 * Speaker, and a fake Walker. No IPC, and no game.
 */

function fakeContext(): AssistHandlerContext & {
  actionLayer: { listWindows: ReturnType<typeof vi.fn>; stopAll: ReturnType<typeof vi.fn> }
  speaker: {
    start: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    states: ReturnType<typeof vi.fn>
  }
  walker: {
    go: ReturnType<typeof vi.fn>
    stop: ReturnType<typeof vi.fn>
    states: ReturnType<typeof vi.fn>
  }
} {
  const actionLayer = {
    listWindows: vi.fn(() => [{ connectionId: 'A', windowHandle: 1, title: 'Dark Ages' }]),
    stopAll: vi.fn()
  }
  const speaker = {
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    states: vi.fn(() => [])
  }
  const walker = {
    go: vi.fn(async () => ({ kind: 'arrived' })),
    stop: vi.fn(),
    states: vi.fn(() => [])
  }
  return {
    actionLayer: actionLayer as unknown as ActionLayer & typeof actionLayer,
    speaker: speaker as unknown as Speaker & typeof speaker,
    walker: walker as unknown as Walker & typeof walker
  }
}

describe('the assist handlers', () => {
  it('lists the windows from the action layer', () => {
    const ctx = fakeContext()
    expect(assistWindows(ctx)).toHaveLength(1)
    expect(ctx.actionLayer.listWindows).toHaveBeenCalledOnce()
  })

  it('stops everything through the action layer', () => {
    const ctx = fakeContext()
    assistStopAll(ctx)
    expect(ctx.actionLayer.stopAll).toHaveBeenCalledOnce()
  })

  it('starts the Speaker with the blank lines dropped', async () => {
    const ctx = fakeContext()
    await startSpeaker(ctx, {
      lines: ['hello', '   ', 'world'],
      intervalMs: 5000,
      repeat: true,
      connectionId: 'A'
    })
    expect(ctx.speaker.start).toHaveBeenCalledWith({
      lines: ['hello', 'world'],
      intervalMs: 5000,
      repeat: true,
      connectionId: 'A'
    })
  })

  it('rejects a config with no lines left after the blanks go', async () => {
    const ctx = fakeContext()
    await expect(
      startSpeaker(ctx, { lines: ['  ', ''], intervalMs: 5000, repeat: true, connectionId: 'A' })
    ).rejects.toThrow(/at least one line/)
    expect(ctx.speaker.start).not.toHaveBeenCalled()
  })

  it('rejects a config with no connection', async () => {
    const ctx = fakeContext()
    await expect(
      startSpeaker(ctx, { lines: ['x'], intervalMs: 5000, repeat: true, connectionId: '' })
    ).rejects.toThrow()
    expect(ctx.speaker.start).not.toHaveBeenCalled()
  })

  it('stops the Speaker on a connection', () => {
    const ctx = fakeContext()
    stopSpeaker(ctx, 'A')
    expect(ctx.speaker.stop).toHaveBeenCalledWith('A')
  })

  it('ignores a stop with no connection id', () => {
    const ctx = fakeContext()
    stopSpeaker(ctx, '')
    expect(ctx.speaker.stop).not.toHaveBeenCalled()
  })

  it('reports the running speakers', () => {
    const ctx = fakeContext()
    expect(speakerState(ctx)).toEqual([])
    expect(ctx.speaker.states).toHaveBeenCalledOnce()
  })

  it('starts the Walker with a validated request', async () => {
    const ctx = fakeContext()
    const outcome = await startWalker(ctx, { connectionId: 'A', destination: 'Mileth' })
    expect(outcome).toEqual({ kind: 'arrived' })
    expect(ctx.walker.go).toHaveBeenCalledWith({ connectionId: 'A', destination: 'Mileth' })
  })

  it('accepts a numeric map id as a destination', async () => {
    const ctx = fakeContext()
    await startWalker(ctx, { connectionId: 'A', destination: 500 })
    expect(ctx.walker.go).toHaveBeenCalledWith({ connectionId: 'A', destination: 500 })
  })

  it('rejects a walk request with no connection', async () => {
    const ctx = fakeContext()
    await expect(startWalker(ctx, { connectionId: '', destination: 'Mileth' })).rejects.toThrow()
    expect(ctx.walker.go).not.toHaveBeenCalled()
  })

  it('stops the Walker on a connection', () => {
    const ctx = fakeContext()
    stopWalker(ctx, 'A')
    expect(ctx.walker.stop).toHaveBeenCalledWith('A')
  })

  it('reports the running walkers', () => {
    const ctx = fakeContext()
    expect(walkerState(ctx)).toEqual([])
    expect(ctx.walker.states).toHaveBeenCalledOnce()
  })
})
