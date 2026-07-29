import type { ActionRefusal, ActionTarget, ErrandOutcome, LaborerState } from '../shared/types'
import type { Errand } from '../shared/types'
import { errandStopMessage } from '../shared/types'
import type { ActionLayer, LiveConnection } from './actionLayer'
import type { DialogState } from './model/dialog'
import type { Logger } from './log'
import type { Walker } from './walker'
import { builtinErrands } from './laborer/errands'
import { matchStep, menuToView, pursuitToView, type DialogView } from './laborer/matcher'

/**
 * The Laborer: walk to an NPC and work its dialog, the errand that is pure
 * repetition.
 *
 * It is the first assistant that is neither legacy tool. DA Walker can arrive
 * and DA Speaker can type, but neither can read what the dialog says, so a
 * legacy attempt is a fixed key sequence on a timer that desynchronises the
 * moment the server says something unexpected. Midir reads the conversation
 * (WP11 and WP17 PR1), so the loop is closed: read the dialog on screen, choose
 * the option by what it says, post the keys, and wait for the next packet before
 * the next step.
 *
 * The one way to get this wrong is to choose an option by its position on the
 * screen. Rows move, so the matcher chooses on the pursuit id and the row text
 * (see laborer/matcher.ts), and an unmatched dialog is a full stop, never a
 * guess.
 *
 * The walker, the action layer, and the dialog feed are all injected, so the
 * whole run is provable against a fake action layer and a scripted dialog feed
 * with no game.
 */

/** An interruptible sleep. `cancel` resolves the promise at once. */
export interface Sleeper {
  promise: Promise<void>
  cancel: () => void
}

export interface LaborerOptions {
  actionLayer: ActionLayer
  /** The walker, used to reach the NPC before the dialog starts. */
  walker: Walker
  /** The connections that carry a live character now. From the capture service. */
  liveConnections: () => LiveConnection[]
  /** The NPC dialog on screen for a connection. From the capture service. */
  dialogFor: (connectionId: string) => DialogState | null
  log: Logger
  /** Called whenever a Laborer changes, so main can push it. */
  onState?: (state: LaborerState) => void
  /** The errands to offer and run. Defaults to the built-in list. Injected by tests. */
  errands?: Errand[]
  /** The clock. Injected by tests. */
  now?: () => number
  /** Build an interruptible sleep. Injected by tests. */
  sleep?: (ms: number) => Sleeper
}

export interface Laborer {
  /** Every built-in errand, for the picker. */
  errands(): Errand[]
  /** Run one built-in errand by name. Resolves with how the errand ended. */
  run(request: { connectionId: string; errand: string }): Promise<ErrandOutcome>
  /** Stop the Laborer on one connection. */
  stop(connectionId: string): void
  /** Every Laborer running now. */
  states(): LaborerState[]
  /** Stop every Laborer quietly. Called on shutdown. */
  dispose(): void
}

/**
 * How long to wait for the next dialog packet, in milliseconds.
 *
 * The server answers a dialog step fast: WP9 measured bank replies at 119 to
 * 253 ms. The first dialog waits on the player opening the conversation, so the
 * window is generous. A step that gets no reply in this window stops the run.
 */
const DIALOG_WAIT_MS = 6000

/** How often to poll the dialog feed while waiting, in milliseconds. */
const POLL_MS = 40

/**
 * The Win32 virtual key for a menu option's number.
 *
 * Selecting a dialog row by keyboard is a live fact of the retail client, and
 * it is the one thing the GUI check must prove — the same status as the walker's
 * arrow keys. The rows are one-based, so option 1 posts the digit `1` (0x31).
 * Kept here so a live correction is a one-line change.
 */
const OPTION_DIGIT_BASE = 0x30

interface Run {
  connectionId: string
  errand: string
  running: boolean
  step: number
  stopReason?: 'user' | 'lostCharacter'
  cancelWait?: () => void
}

function defaultSleep(ms: number): Sleeper {
  let timer: NodeJS.Timeout
  let resolveNow: () => void = () => undefined
  const promise = new Promise<void>((resolve) => {
    resolveNow = resolve
    timer = setTimeout(resolve, ms)
  })
  return {
    promise,
    cancel: () => {
      clearTimeout(timer)
      resolveNow()
    }
  }
}

/** Normalise the dialog on screen to the matcher's view. */
function toView(dialog: DialogState): DialogView {
  return dialog.packet.kind === 'pursuitMessage'
    ? pursuitToView(dialog.packet)
    : menuToView(dialog.packet)
}

/** Describe a dialog for the log and the user, so the next run can add the case. */
function describeDialog(view: DialogView): string {
  const rows = view.options.map((option) => `"${option.text}"`).join(', ')
  const pursuit = view.pursuit !== undefined ? `0x${view.pursuit.toString(16)}` : 'per row'
  return `pursuit ${pursuit} from ${view.npcName || 'an NPC'}, options: [${rows}]`
}

export function createLaborer(options: LaborerOptions): Laborer {
  const { actionLayer, walker, liveConnections, dialogFor, log, onState } = options
  const sleep = options.sleep ?? defaultSleep
  const errandList = options.errands ?? builtinErrands()

  const runs = new Map<string, Run>()

  function hasLiveCharacter(connectionId: string): boolean {
    return liveConnections().some((c) => c.connectionId === connectionId)
  }

  function publish(run: Run, waitingFor?: string, reason?: string): void {
    onState?.({
      connectionId: run.connectionId,
      running: run.running,
      errand: run.errand,
      step: run.step,
      ...(waitingFor !== undefined ? { waitingFor } : {}),
      ...(reason !== undefined ? { reason } : {})
    })
  }

  /** End a run: disarm, publish the final state, and log why it ended. */
  function finish(run: Run, outcome: ErrandOutcome): ErrandOutcome {
    run.running = false
    run.cancelWait?.()
    runs.delete(run.connectionId)
    actionLayer.disarm(run.connectionId)
    const reason =
      outcome.kind === 'done'
        ? 'the errand finished'
        : `${errandStopMessage(outcome.reason)}${outcome.saw !== undefined ? ` (${outcome.saw})` : ''}`
    onState?.({
      connectionId: run.connectionId,
      running: false,
      errand: run.errand,
      step: run.step,
      reason
    })
    log.info('laborer', `Laborer on ${run.connectionId} ended: ${reason}.`)
    return outcome
  }

  /** Wait for a dialog whose capture time is after `afterMs`, or null on timeout. */
  async function waitForDialog(
    run: Run,
    afterMs: number,
    timeoutMs: number
  ): Promise<DialogState | null> {
    const deadline = (options.now ?? Date.now)() + timeoutMs
    for (;;) {
      if (!run.running || actionLayer.stopped) return null
      const dialog = dialogFor(run.connectionId)
      if (dialog !== null && dialog.asOfMs > afterMs) return dialog
      if ((options.now ?? Date.now)() >= deadline) return null
      const sleeper = sleep(POLL_MS)
      run.cancelWait = sleeper.cancel
      await sleeper.promise
      run.cancelWait = undefined
    }
  }

  /** Post the keys that select a one-based menu row. */
  async function chooseRow(target: ActionTarget, index: number): Promise<ActionRefusal | null> {
    // Only single-digit options are selectable by one number key. A dialog with
    // more than nine rows is beyond this gesture; the run stops rather than post
    // a key that means nothing.
    if (index < 1 || index > 9) return 'blocked'
    return actionLayer.pressKey(target, OPTION_DIGIT_BASE + index)
  }

  async function run(request: { connectionId: string; errand: string }): Promise<ErrandOutcome> {
    const { connectionId } = request
    const errand = errandList.find((candidate) => candidate.name === request.errand)
    if (errand === undefined) throw new Error(`There is no errand named "${request.errand}".`)
    if (!hasLiveCharacter(connectionId)) {
      throw new Error('No character is logged in on the selected window.')
    }
    // Restart cleanly if one is already running on this connection.
    if (runs.has(connectionId)) stop(connectionId)

    const runState: Run = { connectionId, errand: errand.name, running: true, step: 0 }
    runs.set(connectionId, runState)
    publish(runState, 'walking to the NPC')
    log.info('laborer', `Laborer started on ${connectionId}: ${errand.name}.`)

    // Walk to the NPC first. The walker arms and disarms the connection itself,
    // so the Laborer arms again for the dialog phase after it arrives.
    const walk = await walker.go({
      connectionId,
      destination: errand.destination,
      ...(errand.npcTile !== undefined ? { tile: errand.npcTile } : {})
    })
    if (!runState.running)
      return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
    if (walk.kind !== 'arrived') return finish(runState, { kind: 'stopped', reason: 'walker' })

    const armed = actionLayer.arm(connectionId, (reason) => {
      runState.stopReason = reason.includes('window closed') ? 'lostCharacter' : 'user'
      runState.running = false
      runState.cancelWait?.()
    })
    if (typeof armed === 'string') {
      return finish(runState, {
        kind: 'stopped',
        reason: armed === 'stopped' ? 'user' : 'lostCharacter'
      })
    }
    const target = armed

    // Wait for a dialog newer than the one on screen now, so a stale dialog from
    // before the errand is never answered. The first step matches the dialog the
    // player has open, so the very first wait accepts the current one.
    let lastAsOf = 0

    for (let index = 0; index < errand.steps.length; index++) {
      if (!runState.running)
        return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
      if (actionLayer.stopped) return finish(runState, { kind: 'stopped', reason: 'user' })
      if (!hasLiveCharacter(connectionId)) {
        return finish(runState, { kind: 'stopped', reason: 'lostCharacter' })
      }
      runState.step = index
      publish(runState, `the dialog for step ${index + 1}`)

      const dialog = await waitForDialog(runState, lastAsOf, DIALOG_WAIT_MS)
      if (dialog === null) {
        if (!runState.running || actionLayer.stopped) {
          return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
        }
        return finish(runState, { kind: 'stopped', reason: 'timeout' })
      }
      lastAsOf = dialog.asOfMs

      const view = toView(dialog)
      const result = matchStep(errand.steps[index]!, view)

      if (result.kind === 'protected') {
        log.warn('laborer', 'A login or password dialog appeared. Stopping before any key.')
        return finish(runState, {
          kind: 'stopped',
          reason: 'protected',
          saw: 'a login or password dialog'
        })
      }
      if (result.kind === 'noMatch') {
        const saw = describeDialog(view)
        log.warn('laborer', `No step matched the dialog: ${saw}. Stopping.`)
        return finish(runState, { kind: 'stopped', reason: 'unmatchedDialog', saw })
      }

      const refusal =
        result.kind === 'choose'
          ? await chooseRow(target, result.index)
          : await actionLayer.typeLine(target, result.text)
      if (!runState.running) {
        return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
      }
      if (refusal !== null) {
        if (refusal === 'stopped') return finish(runState, { kind: 'stopped', reason: 'user' })
        return finish(runState, { kind: 'stopped', reason: 'lostCharacter' })
      }
    }

    return finish(runState, { kind: 'done' })
  }

  function stop(connectionId: string): void {
    const runState = runs.get(connectionId)
    if (runState === undefined) return
    runState.stopReason = 'user'
    runState.running = false
    runState.cancelWait?.()
    // Stop the walk too, in case the run is still on its way to the NPC.
    walker.stop(connectionId)
  }

  return {
    errands(): Errand[] {
      return errandList
    },
    run,
    stop,
    states(): LaborerState[] {
      return [...runs.values()].map((runState) => ({
        connectionId: runState.connectionId,
        running: runState.running,
        errand: runState.errand,
        step: runState.step
      }))
    },
    dispose(): void {
      for (const connectionId of [...runs.keys()]) {
        const runState = runs.get(connectionId)
        if (runState !== undefined) {
          runState.running = false
          runState.cancelWait?.()
        }
        runs.delete(connectionId)
        actionLayer.disarm(connectionId)
      }
    }
  }
}
