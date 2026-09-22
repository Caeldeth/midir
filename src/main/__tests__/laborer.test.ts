import { describe, expect, it } from 'vitest'
import { createLaborer, rowY, type Sleeper } from '../laborer'
import type { ActionLayer, LiveConnection } from '../actionLayer'
import type { ActionRefusal, ActionTarget, Errand, WalkOutcome } from '../../shared/types'
import type { DialogState } from '../model/dialog'
import type { Position } from '../model/position'
import type { Passport } from '../route/access'
import { creaturePoint } from '../laborer/view'
import type { NoticeState } from '../model/notice'
import type { NpcMenu } from '../protocol/decode/dialog'
import type { PursuitMessage } from '../protocol/decode/pursuit'
import { builtinErrands } from '../laborer/errands'
import cloutExchange from '../laborer/__tests__/fixtures/clout-exchange-2026-09-21.json'
import laborExchange from '../laborer/__tests__/fixtures/labor-exchange-2026-09-21.json'
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

/**
 * A dialog feed: a list of dialogs the server shows, one per acted step. A
 * notice at an index is the newest server notice while the feed is there; an
 * index past the list is a closed dialog.
 */
interface Feed {
  list: DialogState[]
  index: number
  noticeAt?: Record<number, NoticeState>
  /** An index whose dialog is on screen only from this clock time: the player opens it later. */
  appearAt?: Record<number, number>
}

function notice(text: string, asOfMs: number): NoticeState {
  return { packet: { kind: 'systemMessage', messageType: 3, text }, asOfMs }
}

/** A click on a row, as the Laborer posts it. */
type Click = { x: number; y: number }

/** The click the Laborer posts for a one-based `row` of a `rows`-row dialog. */
function rowClick(rows: number, row: number): Click {
  return { x: 540, y: rowY(rows, row) }
}

/** The click that closes a dialog. */
const CLOSE_CLICK: Click = { x: 589, y: 461 }

interface FakeLayer {
  layer: ActionLayer
  /** Every click posted, in order. Rows are chosen by a click. */
  clicks: Click[]
  typed: string[]
  armed: string[]
  disarmed: string[]
  state: { stopped: boolean }
  fireStop: (reason: string) => void
  setRefusal: (refusal: ActionRefusal | null) => void
}

function fakeLayer(feed: Feed): FakeLayer {
  const state = { stopped: false }
  const clicks: Click[] = []
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
    click: async (_t: ActionTarget, x: number, y: number): Promise<ActionRefusal | null> => {
      clicks.push({ x, y })
      if (refusal !== null) return refusal
      advance()
      return null
    },
    typeText: async (_t: ActionTarget, text: string): Promise<ActionRefusal | null> => {
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
    clicks,
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
  /** Where the character stands, for the NPC click. Absent: no position known. */
  position?: Position
  /** The errand's map id, as the graph would resolve it. */
  destinationMapId?: number
  /** Registration and citizenship as the record knows them. Absent: no record. */
  passport?: Passport
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
    dialogFor: (id: string): DialogState | null => {
      if (id !== CID) return null
      const appears = opts.feed.appearAt?.[opts.feed.index]
      if (appears !== undefined && clock.now() < appears) return null
      return opts.feed.list[opts.feed.index] ?? null
    },
    positionFor: (id: string): Position | null => (id === CID ? (opts.position ?? null) : null),
    resolveDestination: () => opts.destinationMapId ?? null,
    passportFor: (id: string): Passport | null => (id === CID ? (opts.passport ?? null) : null),
    noticeFor: (id: string): NoticeState | null =>
      id === CID ? (opts.feed.noticeAt?.[opts.feed.index] ?? null) : null,
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
    // Chose row 2 of 2 (Give clout) then row 1 of 2 (Yes), each by a click.
    expect(fake.clicks).toEqual([rowClick(2, 2), rowClick(2, 1)])
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
    expect(fake.clicks).toEqual([rowClick(2, 1), rowClick(2, 2)])
  })

  it('stops on an unmatched dialog and reports what it saw', async () => {
    const feed = feedOf([pursuit({ pursuit: 999, options: [{ text: 'Nothing here' }] })])
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })

    expect(outcome.kind).toBe('stopped')
    if (outcome.kind === 'stopped') {
      expect(outcome.reason).toBe('unmatchedDialog')
      // The id is decimal, as the errand data and the capture tools write it.
      expect(outcome.saw).toBe('pursuit 999 from Donnan, options: ["Nothing here"]')
    }
    expect(fake.clicks).toEqual([]) // nothing posted
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
    expect(fake.clicks).toEqual([])
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
    // Fire the global stop as soon as the first click is posted.
    const originalClick = fake.layer.click
    ;(fake.layer as unknown as { click: ActionLayer['click'] }).click = async (t, x, y) => {
      const result = await originalClick(t, x, y)
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

  it('stops on a refusal: no dialog after the step, and a notice that says why', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] })
    ])
    feed.noticeAt = {
      1: notice("(( Register first: www.darkages.com -> Click 'Register' ))", 2100)
    }
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({
      kind: 'stopped',
      reason: 'serverNotice',
      saw: "(( Register first: www.darkages.com -> Click 'Register' ))"
    })
    expect(fake.clicks).toEqual([rowClick(2, 2)])
  })

  it('opens again from the first step when the server says "You were distracted"', async () => {
    // Give clout, then the dialog closes with the notice; the player reopens
    // the menu ten seconds later, and the run works it through.
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] }),
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] }),
      pursuit({ pursuit: 0x0065, options: [{ text: 'Yes' }, { text: 'No' }] })
    ])
    feed.noticeAt = { 1: notice('You were distracted', 2100) }
    feed.appearAt = { 1: 1000 + 6000 + 10_000 }
    feed.list[1]!.asOfMs = 20_000
    feed.list[2]!.asOfMs = 20_400
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'done' })
    expect(fake.clicks).toEqual([rowClick(2, 2), rowClick(2, 2), rowClick(2, 1)])
  })

  it('stops after the third distraction', async () => {
    const menu = (): PursuitMessage =>
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] })
    const feed = feedOf([menu(), menu(), menu()])
    feed.list[1]!.asOfMs = 20_000
    feed.list[2]!.asOfMs = 40_000
    feed.noticeAt = {
      1: notice('You were distracted', 2100),
      2: notice('You were distracted', 20_100),
      3: notice('You were distracted', 40_100)
    }
    feed.appearAt = { 1: 17_000, 2: 37_000 }
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'serverNotice', saw: 'You were distracted' })
    expect(fake.clicks).toEqual([rowClick(2, 2), rowClick(2, 2), rowClick(2, 2)])
  })

  it('does not read a notice beside the next dialog as a refusal', async () => {
    const feed = feedOf([
      pursuit({ pursuit: 0x0064, options: [{ text: 'Ask' }, { text: 'Give clout' }] }),
      pursuit({ pursuit: 0x0065, options: [{ text: 'Yes' }, { text: 'No' }] })
    ])
    feed.noticeAt = { 1: notice('(( 4 Temauiran days = 12 Terran hours ))', 2200) }
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'done' })
    expect(fake.clicks).toEqual([rowClick(2, 2), rowClick(2, 1)])
  })

  it('ignores a notice while waiting for the player to open the conversation', async () => {
    const feed = feedOf([])
    feed.noticeAt = { 0: notice('[Billy]: anyone have a grand stilla?', 5000) }
    const { laborer, fake } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'timeout' })
    expect(fake.clicks).toEqual([])
  })

  it('names every pursuit id in the stop line, so a run is a capture', async () => {
    const feed = feedOf([
      menu({
        npcName: 'Aingeal',
        options: [
          { text: 'Buy', pursuit: 64 },
          { text: 'Mileth Civics', pursuit: 1700 }
        ]
      }) as unknown as PursuitMessage
    ])
    const { laborer } = make({ errand: twoStepErrand(), feed })
    const outcome = await laborer.run({ connectionId: CID, errand: 'Test errand' })
    expect(outcome).toEqual({
      kind: 'stopped',
      reason: 'unmatchedDialog',
      saw: 'pursuit per row from Aingeal saying "Hello.  What can I do for you?", options: ["Buy" (64), "Mileth Civics" (1700)]'
    })
  })
})

function menu(overrides: Partial<NpcMenu> = {}): NpcMenu {
  return {
    kind: 'npcMenu',
    sourceId: 6703,
    npcName: 'Eduardo',
    menuType: 0,
    text: 'Hello.  What can I do for you?',
    isTextInput: false,
    options: [],
    ...overrides
  }
}

/** The dialogs the recorded civic conversation shows, from the fixture. */
type Exchange = Array<{ at: number; server?: unknown; client?: unknown }>

/** The server dialogs of one conversation in the fixture, from `from` to `to`. */
function serverDialogs(from: number, to: number): DialogState[] {
  return (cloutExchange as Exchange)
    .slice(from, to)
    .filter((entry) => entry.server !== undefined)
    .map((entry) => ({ packet: entry.server as PursuitMessage | NpcMenu, asOfMs: entry.at }))
}

/**
 * The rows the player chose in the fixture, in the Laborer's terms: a menu
 * row chosen by its pursuit is a click on that row of that menu, a pursuit
 * choice is a click on that row of that dialog, and typed text is the text.
 */
function playerAnswers(from: number, to: number): { clicks: Click[]; typed: string[] } {
  const clicks: Click[] = []
  const typed: string[] = []
  let shown: NpcMenu | PursuitMessage | undefined
  for (const entry of (cloutExchange as Exchange).slice(from, to)) {
    const server = entry.server as NpcMenu | PursuitMessage | undefined
    if (server !== undefined) shown = server
    const client = entry.client as
      | { kind: 'merchantResponse'; pursuit: number }
      | { kind: 'pursuitResponse'; choice?: number; text?: string }
      | undefined
    if (client === undefined) continue
    if (client.kind === 'merchantResponse') {
      if (shown?.kind !== 'npcMenu') continue
      const row = shown.options.findIndex((o) => o.pursuit === client.pursuit)
      clicks.push(rowClick(shown.options.length, row + 1))
    } else if (client.choice !== undefined && shown?.kind === 'pursuitMessage') {
      clicks.push(rowClick(shown.options?.length ?? 0, client.choice))
    } else if (client.text !== undefined) {
      typed.push(client.text)
    }
  }
  return { clicks, typed }
}

describe('the recorded clout conversation (Eduardo, 2026-09-21)', () => {
  const errand = builtinErrands().find((e) => e.npcName === 'Eduardo')!
  const request = { connectionId: CID, errand: errand.name, params: { citizen: 'Pandsala' } }

  // The fixture's entries: 0 to 7 is the first support; 8 and 9 a menu the
  // player opened and closed; 10 to 15 the already-supporting branch and the
  // withdrawal; 16 to 23 the support again after the player reopened the menu.
  it('supports a citizen with the same keys the player pressed', async () => {
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run(request)
    expect(outcome).toEqual({ kind: 'done' })
    const player = playerAnswers(0, 8)
    expect(fake.clicks).toEqual(player.clicks)
    expect(fake.typed).toEqual(player.typed)
    // Row 1 of the 6-row menu, row 1 of 2, row 2 of 2: the measured positions.
    expect(fake.clicks).toEqual([
      { x: 540, y: 245 },
      { x: 540, y: 317 },
      { x: 540, y: 335 }
    ])
    expect(fake.typed).toEqual(['Pandsala'])
  })

  it('withdraws support from another citizen, restarts, and supports the wanted one', async () => {
    const feed = { list: serverDialogs(10, 24), index: 0 }
    const { laborer, fake, states } = make({ errand, feed })
    const outcome = await laborer.run({ ...request, params: { citizen: 'Sabrael' } })
    expect(outcome).toEqual({ kind: 'done' })
    // Civics, Support, Withdraw; then Civics, Support, I am sure, and the name.
    const player = playerAnswers(10, 24)
    expect(fake.clicks).toEqual(player.clicks)
    expect(fake.clicks).toEqual([
      rowClick(6, 1),
      rowClick(2, 1),
      rowClick(2, 2),
      rowClick(6, 1),
      rowClick(2, 1),
      rowClick(2, 2)
    ])
    expect(fake.typed).toEqual(['Sabrael'])
    // After the withdrawal it waited for the player to open the menu again.
    expect(states.filter((s) => s.running).length).toBeGreaterThan(0)
  })

  it('is done at once when the wanted citizen is already supported', async () => {
    const feed = { list: serverDialogs(10, 15), index: 0 }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run(request)
    expect(outcome).toEqual({ kind: 'done' })
    // Civics, Support, then "I continue to support the Aisling" (row 1).
    expect(fake.clicks).toEqual([rowClick(6, 1), rowClick(2, 1), rowClick(2, 1)])
    expect(fake.typed).toEqual([])
  })

  it('refuses to run without the citizen', async () => {
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer, fake } = make({ errand, feed })
    await expect(laborer.run({ connectionId: CID, errand: errand.name })).rejects.toThrow(
      /Citizen to support/
    )
    await expect(
      laborer.run({ connectionId: CID, errand: errand.name, params: { citizen: '  ' } })
    ).rejects.toThrow(/Citizen to support/)
    expect(fake.clicks).toEqual([])
  })

  it('waits for the menu after a withdrawal even though a notice came with the close', async () => {
    const feed = { list: serverDialogs(10, 15), index: 0 }
    const withdrawn = feed.list[2]!.asOfMs + 150
    const { laborer, fake } = make({
      errand,
      feed: { ...feed, noticeAt: { 3: notice('You stop supporting Pandsala', withdrawn) } }
    })
    const outcome = await laborer.run({ ...request, params: { citizen: 'Sabrael' } })
    // The player never reopened the menu: a timeout, not a refusal.
    expect(outcome).toEqual({ kind: 'stopped', reason: 'timeout' })
    expect(fake.clicks).toEqual([rowClick(6, 1), rowClick(2, 1), rowClick(2, 2)])
  })

  it('stops rather than restart twice', async () => {
    // Two withdrawals in a row: the server keeps saying another is supported.
    const branch = serverDialogs(10, 15)
    // The repeat is later than the first, as a real repeat would be.
    const again = branch.map((d) => ({ ...d, asOfMs: d.asOfMs + 60_000 }))
    const feed = { list: [...branch, ...again], index: 0 }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run({ ...request, params: { citizen: 'Sabrael' } })
    expect(outcome.kind).toBe('stopped')
    if (outcome.kind === 'stopped') expect(outcome.reason).toBe('unmatchedDialog')
    expect(fake.clicks).toEqual([
      rowClick(6, 1),
      rowClick(2, 1),
      rowClick(2, 2),
      rowClick(6, 1),
      rowClick(2, 1),
      rowClick(2, 2)
    ])
  })
})

describe('the recorded labor conversation (Evenue at Antonio, 2026-09-21)', () => {
  const errand = builtinErrands().find((e) => e.npcName === 'Antonio')!
  const exchange = laborExchange as Exchange
  // Entries 0 to 5 are the menu, the offer, and the name; 7 is the verdict.
  const dialogs = exchange
    .slice(0, 6)
    .filter((entry) => entry.server !== undefined)
    .map((entry) => ({ packet: entry.server as PursuitMessage | NpcMenu, asOfMs: entry.at }))
  const verdict = exchange[7]!

  it('works for an Aisling with the keys the player pressed, and reports the verdict', async () => {
    const feed: Feed = {
      list: dialogs,
      index: 0,
      noticeAt: {
        3: {
          packet: verdict.server as NoticeState['packet'],
          asOfMs: verdict.at
        }
      }
    }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run({
      connectionId: CID,
      errand: errand.name,
      params: { aisling: 'Pandsala' }
    })
    // "Labor" is row 9 of Antonio's 12-row menu; "I want to work" is row 2 of
    // 3. Both are the positions the hand run measured (y 281 and 317).
    expect(fake.clicks).toEqual([
      { x: 540, y: 281 },
      { x: 540, y: 317 }
    ])
    expect(fake.typed).toEqual(['Pandsala'])
    expect(outcome).toEqual({
      kind: 'done',
      saw: "Pandsala doesn't need any jobs done. The Aisling hasn't done anything"
    })
  })

  it('is done with no word when the server says nothing after the name', async () => {
    const { laborer } = make({ errand, feed: { list: dialogs, index: 0 } })
    const outcome = await laborer.run({
      connectionId: CID,
      errand: errand.name,
      params: { aisling: 'Pandsala' }
    })
    expect(outcome).toEqual({ kind: 'done' })
  })
})

describe('the labor fix (Antonio, 2026-09-21)', () => {
  const errand = builtinErrands().find((e) => e.name.startsWith('Labor fix — Antonio'))!
  const exchange = laborExchange as Exchange
  const menuOf = exchange[0]!.server as NpcMenu
  const offer = exchange[2]!.server as PursuitMessage
  const notice = (text: string, step: number): PursuitMessage => ({
    ...offer,
    dialogType: 0,
    dialogKind: 'text',
    step,
    text,
    options: undefined
  })

  it('closes the reset notice and reports its text', async () => {
    const feed: Feed = {
      list: [
        { packet: menuOf, asOfMs: 1000 },
        { packet: offer, asOfMs: 1400 },
        {
          packet: notice('This will reset your labor to one hour. You can only do this once.', 75),
          asOfMs: 1800
        }
      ],
      index: 0
    }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run({ connectionId: CID, errand: errand.name })
    expect(fake.clicks).toEqual([rowClick(12, 9), rowClick(3, 3), CLOSE_CLICK])
    expect(fake.typed).toEqual([])
    expect(outcome).toEqual({
      kind: 'done',
      saw: 'This will reset your labor to one hour. You can only do this once.'
    })
  })

  it('closes the too-soon notice the same way', async () => {
    const feed: Feed = {
      list: [
        { packet: menuOf, asOfMs: 1000 },
        { packet: offer, asOfMs: 1400 },
        { packet: notice('You have already reset your labor.', 78), asOfMs: 1800 }
      ],
      index: 0
    }
    const { laborer, fake } = make({ errand, feed })
    const outcome = await laborer.run({ connectionId: CID, errand: errand.name })
    expect(fake.clicks.at(-1)).toEqual(CLOSE_CLICK)
    expect(outcome).toEqual({ kind: 'done', saw: 'You have already reset your labor.' })
  })
})

describe('opening the conversation', () => {
  const errand = builtinErrands().find((e) => e.npcName === 'Eduardo')!
  const request = { connectionId: CID, errand: errand.name, params: { citizen: 'Pandsala' } }
  const standing: Position = {
    mapId: 3049,
    x: 2,
    y: 11,
    facing: 0,
    asOfMs: 500,
    confidence: 'confirmed'
  }
  const npcClick = creaturePoint({ x: 2, y: 11 }, errand.npcTile!)

  it('clicks the NPC where the client draws it, then works the dialog that opens', async () => {
    // Nothing is up at first; the click on Eduardo brings the menu.
    const dialogs = serverDialogs(0, 8)
    const feed: Feed = { list: [dialogs[0]!, ...dialogs], index: 0, appearAt: { 0: Infinity } }
    const { laborer, fake } = make({ errand, feed, position: standing })
    const outcome = await laborer.run(request)
    expect(outcome).toEqual({ kind: 'done' })
    expect(fake.clicks[0]).toEqual({ x: 256, y: 187 })
    expect(fake.clicks[0]).toEqual(npcClick)
    expect(fake.clicks.slice(1)).toEqual([rowClick(6, 1), rowClick(2, 1), rowClick(2, 2)])
  })

  it('takes a dialog that is already up without clicking the NPC', async () => {
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer, fake } = make({ errand, feed, position: standing })
    await laborer.run(request)
    expect(fake.clicks[0]).toEqual(rowClick(6, 1))
  })

  it('waits for the player when the NPC tile is not known', async () => {
    const { npcTile: _tile, ...noTile } = errand
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer, fake } = make({ errand: noTile, feed, position: standing })
    await laborer.run(request)
    expect(fake.clicks[0]).toEqual(rowClick(6, 1))
  })

  it('gives up after three clicks that open nothing, and waits for the player', async () => {
    const menu = serverDialogs(0, 1)[0]!
    const feed: Feed = {
      list: [menu, menu, menu, menu],
      index: 0,
      appearAt: { 0: Infinity, 1: Infinity, 2: Infinity, 3: Infinity }
    }
    const { laborer, fake } = make({ errand, feed, position: standing })
    const outcome = await laborer.run(request)
    expect(outcome).toEqual({ kind: 'stopped', reason: 'timeout' })
    expect(fake.clicks).toEqual([npcClick, npcClick, npcClick])
  })
})

describe('what the record refuses before the walk (WP32)', () => {
  // Clout at Rucesion is for a registered Rucesion citizen (nation 6); labor
  // needs a registered character.
  const clout = builtinErrands().find((e) => e.npcName === 'Eduardo')!
  const labor = builtinErrands().find((e) => e.name.startsWith('Labor — Antonio'))!
  const feed = { list: [], index: 0 }

  it('refuses clout to a citizen of another town, before any walk', async () => {
    const { laborer, walkerStops, states } = make({
      errand: clout,
      feed,
      passport: { registered: true, citizenship: 4 }
    })
    const outcome = await laborer.run({
      connectionId: CID,
      errand: clout.name,
      params: { citizen: 'Pandsala' }
    })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'notCitizen' })
    expect(walkerStops).toEqual([])
    expect(states.some((s) => s.reason === 'walking to the NPC')).toBe(false)
  })

  it('refuses clout and labor to an unregistered character', async () => {
    for (const errand of [clout, labor]) {
      const { laborer } = make({ errand, feed, passport: { registered: false, citizenship: 6 } })
      const outcome = await laborer.run({
        connectionId: CID,
        errand: errand.name,
        params: { citizen: 'Pandsala', aisling: 'Pandsala' }
      })
      expect(outcome).toEqual({ kind: 'stopped', reason: 'unregistered' })
    }
  })

  it('lets the right citizen, and a character the record does not know, go on', async () => {
    // Unknown refuses nothing: the server's own refusal is then the verdict.
    for (const passport of [{ registered: true, citizenship: 6 }, {}, undefined]) {
      const { laborer, walkerStops } = make({
        errand: clout,
        feed,
        walkOutcome: { kind: 'stopped', reason: 'blocked' },
        ...(passport !== undefined ? { passport } : {})
      })
      const outcome = await laborer.run({
        connectionId: CID,
        errand: clout.name,
        params: { citizen: 'Pandsala' }
      })
      // The walk was attempted (and, in this fake, refused as blocked).
      expect(outcome).toEqual({ kind: 'stopped', reason: 'walker' })
      expect(walkerStops.length).toBe(0)
    }
  })

  it('does not ask citizenship of a labor errand', async () => {
    const { laborer } = make({
      errand: labor,
      feed,
      walkOutcome: { kind: 'stopped', reason: 'blocked' },
      passport: { registered: true, citizenship: 0 }
    })
    const outcome = await laborer.run({
      connectionId: CID,
      errand: labor.name,
      params: { aisling: 'Pandsala' }
    })
    expect(outcome).toEqual({ kind: 'stopped', reason: 'walker' })
  })
})

describe('a walk that fell short', () => {
  // Eduardo's errand and his recorded menu; the town hall is map 3049.
  const errand = builtinErrands().find((e) => e.npcName === 'Eduardo')!
  const request = { connectionId: CID, errand: errand.name, params: { citizen: 'Pandsala' } }
  const blocked: WalkOutcome = { kind: 'stopped', reason: 'blocked' }

  it('goes on when blocked on the right map within reach of the NPC', async () => {
    // Someone stands on the spot (2,11); the character stopped on (3,10).
    const near: Position = {
      mapId: 3049,
      x: 3,
      y: 10,
      facing: 0,
      asOfMs: 500,
      confidence: 'confirmed'
    }
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer, fake } = make({
      errand,
      feed,
      walkOutcome: blocked,
      position: near,
      destinationMapId: 3049
    })
    const outcome = await laborer.run(request)
    expect(outcome).toEqual({ kind: 'done' })
    expect(fake.clicks.length).toBeGreaterThan(0)
  })

  it('stops when blocked on another map, or far from the NPC', async () => {
    const elsewhere: Position = {
      mapId: 3048,
      x: 3,
      y: 10,
      facing: 0,
      asOfMs: 500,
      confidence: 'confirmed'
    }
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const away = make({
      errand,
      feed,
      walkOutcome: blocked,
      position: elsewhere,
      destinationMapId: 3049
    })
    expect(await away.laborer.run(request)).toEqual({ kind: 'stopped', reason: 'walker' })
    const far = make({
      errand,
      feed: { list: serverDialogs(0, 8), index: 0 },
      walkOutcome: blocked,
      position: { ...elsewhere, mapId: 3049, x: 11, y: 2 },
      destinationMapId: 3049
    })
    expect(await far.laborer.run(request)).toEqual({ kind: 'stopped', reason: 'walker' })
  })

  it('stops on any other walk failure', async () => {
    const feed = { list: serverDialogs(0, 8), index: 0 }
    const { laborer } = make({
      errand,
      feed,
      walkOutcome: { kind: 'stopped', reason: 'noRoute' },
      position: { mapId: 3049, x: 3, y: 10, facing: 0, asOfMs: 500, confidence: 'confirmed' },
      destinationMapId: 3049
    })
    expect(await laborer.run(request)).toEqual({ kind: 'stopped', reason: 'walker' })
  })
})
