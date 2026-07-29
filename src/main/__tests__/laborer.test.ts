import { describe, expect, it } from 'vitest'
import { createLaborer, type Sleeper } from '../laborer'
import type { ActionLayer, LiveConnection } from '../actionLayer'
import type { ActionRefusal, ActionTarget, Errand, WalkOutcome } from '../../shared/types'
import type { DialogState } from '../model/dialog'
import type { PursuitMessage } from '../protocol/decode/pursuit'
import type { Walker } from '../walker'
import type { Logger } from '../log'

/**
 * The Laborer driver, run whole against a fake action layer and a scripted
 * dialog feed with no game. The feed advances when the driver acts, exactly as
 * the server answers a selection with the next dialog.
 */

const CID = 'conn-1'
const TARGET: ActionTarget = { connectionId: CID, windowHandle: 1 }

const noop: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined
} as unknown as Logger

function pursuit(overrides: Partial<PursuitMessage> = {}): PursuitMessage {
  return {
    kind: 'pursuitMessage',
    dialogType: 2,
    dialogKind: 'options',
    objectType: 1,
    sourceId: 0x1f6f,
    npcName: 'Donnan',
    pursuit: 0x0064,
    step: 1,
    hasPrevious: false,
    hasNext: false,
    isProtected: false,
    ...overrides
  }
}

/** A dialog feed: a list of dialogs the server shows, one per acted step. */
interface Feed {
  list: DialogState[]
  index: number
}

interface FakeLayer {
  layer: ActionLayer
  keys: number[]
  typed: string[]
  armed: string[]
  disarmed: string[]
  state: { stopped: boolean }
  fireStop: (reason: string) => void
  setRefusal: (refusal: ActionRefusal | null) => void
}

function fakeLayer(feed: Feed): FakeLayer {
  const state = { stopped: false }
  const keys: number[] = []
  const typed: string[] = []
  const armed: string[] = []
  const disarmed: string[] = []
  let onStop: ((reason: string) => void) | undefined
  let refusal: ActionRefusal | null = null

  const advance = (): void => {
    if (feed.index < feed.list.length) feed.index++
  }

  const layer = {
    resolveTarget: (id: string): ActionTarget | null => (id === CID ? TARGET : null),
    arm: (id: string, cb?: (reason: string) => void): ActionTarget | ActionRefusal => {
      armed.push(id)
      onStop = cb
      return TARGET
    },
    disarm: (id: string): void => {
      disarmed.push(id)
    },
    pressKey: async (_t: ActionTarget, key: number): Promise<ActionRefusal | null> => {
      keys.push(key)
      if (refusal !== null) return refusal
      advance()
      return null
    },
    typeLine: async (_t: ActionTarget, text: string): Promise<ActionRefusal | null> => {
      typed.push(text)
      if (refusal !== null) return refusal
      advance()
      return null
    },
    get stopped(): boolean {
      return state.stopped
    }
  } as unknown as ActionLayer

  return {
    layer,
    keys,
    typed,
    armed,
    disarmed,
    state,
    fireStop: (reason: string): void => {
      state.stopped = true
      onStop?.(reason)
    },
    setRefusal: (value: ActionRefusal | null): void => {
      refusal = value
    }
  }
}

function fakeWalker(outcome: WalkOutcome = { kind: 'arrived' }): {
  walker: Walker
  stops: string[]
} {
  const stops: string[] = []
  const walker = {
    go: async (): Promise<WalkOutcome> => outcome,
    stop: (id: string): void => {
      stops.push(id)
    },
    destinations: () => [],
    states: () => [],
    dispose: () => undefined
  } as unknown as Walker
  return { walker, stops }
}

/** A clock and an interruptible sleep that advances it. */
function fakeClock(): { now: () => number; sleep: (ms: number) => Sleeper } {
  let clock = 1000
  return {
    now: () => clock,
    sleep: (ms: number): Sleeper => {
      let resolveNow: () => void = () => undefined
      const promise = new Promise<void>((resolve) => {
        resolveNow = resolve
      }).then(() => {
        clock += ms
      })
      // Resolve on the next microtask so the loop advances without a real timer.
      queueMicrotask(resolveNow)
      return { promise, cancel: resolveNow }
    }
  }
}

interface Options {
  errand: Errand
  feed: Feed
  walkOutcome?: WalkOutcome
  live?: boolean
}

function make(opts: Options): {
  laborer: ReturnType<typeof createLaborer>
  fake: FakeLayer
  walkerStops: string[]
  states: Array<{ running: boolean; reason?: string }>
} {
  const fake = fakeLayer(opts.feed)
  const { walker, stops } = fakeWalker(opts.walkOutcome)
  const clock = fakeClock()
  const live = opts.live ?? true
  const liveConnections = (): LiveConnection[] =>
    live ? [{ connectionId: CID, name: 'Sabrael' }] : []
  const states: Array<{ running: boolean; reason?: string }> = []

  const laborer = createLaborer({
    actionLayer: fake.layer,
    walker,
    liveConnections,
    dialogFor: (id: string): DialogState | null =>
      id === CID ? (opts.feed.list[opts.feed.index] ?? null) : null,
    log: noop,
    errands: [opts.errand],
    onState: (state) =>
      states.push({ running: state.running, ...(state.reason ? { reason: state.reason } : {}) }),
    now: clock.now,
    sleep: clock.sleep
  })

  return { laborer, fake, walkerStops: stops, states }
}

/** A two-step errand and the two dialogs the server shows for it. */
function twoStepErrand(): Errand {
  return {
    name: 'Test errand',
    destination: 1,
    npcTile: { x: 2, y: 2 },
    npcName: 'Donnan',
    steps: [
      { pursuit: 0x0064, choose: 'Give clout' },
      { pursuit: 0x0065, choose: 'Yes' }
    ]
  }
}

function feedOf(dialogs: PursuitMessage[]): Feed {
  return {
    list: dialogs.map((packet, i) => ({ packet, asOfMs: 2000 + i * 200 })),
    index: 0
  }
}

describe('createLaborer', () => {
  it('works a two-step dialog and finishes done', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] }),
      pursuit({ pursuit: 0x0065, options: [{ text: 'Yes' }, { text: 'No' }] })
    ])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })

    expect(outcome).toEqual({ kind: 'done' })
    // Chose row 2 (Give clout, digit '2') then row 1 (Yes, digit '1').
    expect(fake.keys).toEqual([0x32, 0x31])
    expect(fake.disarmed).toContain(CID)
  })

  it('selects the same row after the rows move', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Give clout' }, { text: 'Ask' }] }),
      pursuit({ pursuit: 0x0065, options: [{ text: 'No' }, { text: 'Yes' }] })
    ])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    await laborer.run({ connectionId: CID, errand: 'Test errand' })
    // Give clout is now row 1, Yes is now row 2.
    expect(fake.keys).toEqual([0x31, 0x32])
  })

  it('stops on an unmatched dialog and reports what it saw', async () => {
    const feed = feedOf([pursuit({ pursuit: 0x0999, options: [{ text: 'Nothing here' }] })])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })

    expect(outcome.kind).toBe('stopped')
    if (outcome.kind === 'stopped') {
      expect(outcome.reason).toBe('unmatchedDialog')
      expect(outcome.saw).toContain('0x999')
    }
    expect(fake.keys).toEqual([]) // nothing posted
  })

  it('stops immediately on a protected pane, before any key', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, dialogType: 9, dialogKind: 'protected', isProtected: true })
    ])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })

    expect(outcome).toEqual({
      kind: 'stopped',
      reason: 'protected',
      saw: 'a login or password dialog'
    })
    expect(fake.keys).toEqual([])
    expect(fake.typed).toEqual([])
  })

  it('stops on a timeout when no dialog arrives', async () => {
    const feed: Feed = { list: [], index: 0 }
    const { laborer } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'timeout' })
  })

  it('refuses to start with no live character', async () => {
    const feed = feedOf([pursuit()])
    const { laborer } = make({ errand: twoStepErrand(), feed, live: false })
    await expect(laborer.run({ connectionId: CID, errand: 'Test errand' })).rejects.toThrow(
      /No character is logged in/
    )
  })

  it('stops when the walk does not arrive', async () => {
    const feed = feedOf([pursuit()])
    const { laborer } = make({
      errand: twoStepErrand(),
      feed,
      walkOutcome: { kind: 'stopped', reason: 'noRoute' }
    })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'walker' })
  })

  it('stops between steps on the global stop', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Give clout' }] }),
      pursuit({ pursuit: 0x0065, options: [{ text: 'Yes' }] })
    ])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    // Fire the global stop as soon as the first key is posted.
    const originalPress = fake.layer.pressKey
    ;(fake.layer as unknown as { pressKey: ActionLayer['pressKey'] }).pressKey = async (t, key) => {
      const result = await originalPress(t, key)
      fake.fireStop('you pressed stop')
      return result
    }
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome.kind).toBe('stopped')
    if (outcome.kind === 'stopped') expect(outcome.reason).toBe('user')
  })

  it('throws for an unknown errand name', async () => {
    const feed = feedOf([pursuit()])
    const { laborer } = make({ errand: twoStepErrand(), feed })
    await expect(laborer.run({ connectionId: CID, errand: 'No such' })).rejects.toThrow(
      /no errand/i
    )
  })
})
