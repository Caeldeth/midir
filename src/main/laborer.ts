import type {
  ActionRefusal,
  ActionTarget,
  DialogStep,
  ErrandOutcome,
  ErrandRequest,
  LaborerState
} from '../shared/types'
import type { Errand } from '../shared/types'
import { errandStopMessage } from '../shared/types'
import type { ActionLayer, LiveConnection } from './actionLayer'
import { CLOSE_BUTTON } from './dialogScreen'
import type { DialogState } from './model/dialog'
import type { Position } from './model/position'
import { creaturePoint, VIEW_CENTRE } from './laborer/view'
import type { NoticeState } from './model/notice'
import type { Logger } from './log'
import type { Walker } from './walker'
import { builtinErrands } from './laborer/errands'
import {
  fillStep,
  matchStep,
  menuToView,
  pursuitToView,
  type DialogView,
  type MatchResult
} from './laborer/matcher'

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
  /** The character's position. From the capture service. For the NPC click. */
  positionFor?: (connectionId: string) => Position | null
  /** A destination's map id, from the route graph. To know the walk fell short on the right map. */
  resolveDestination?: (destination: string | number) => number | null
  /**
   * The newest server notice for a connection. From the capture service. A
   * notice and a dialog close in place of the next dialog is a refusal.
   */
  noticeFor?: (connectionId: string) => NoticeState | null
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
  run(request: ErrandRequest): Promise<ErrandOutcome>
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
 * 253 ms, and the clout capture of 2026-09-21 shows each civic dialog within
 * 500 ms of the answer. The window is generous. A step that gets no reply in
 * this window stops the run.
 */
const DIALOG_WAIT_MS = 6000

/**
 * How long to wait for the conversation to open, in milliseconds.
 *
 * The Laborer clicks the NPC when it knows the NPC's tile (`openConversation`),
 * and waits for the player to when it does not, or when its own clicks got no
 * dialog. A player is slower than a server, so this wait is the long one.
 */
const FIRST_DIALOG_WAIT_MS = 30000

/**
 * The NPC click: how long to wait for the dialog after one, and how many
 * clicks to try. A click that misses the sprite is a click on the ground,
 * which the client answers with nothing.
 */
const OPEN_WAIT_MS = 3000
const OPEN_TRIES = 3

/**
 * How near the NPC, in tiles either way, a walk that fell short may end and
 * the errand still go on. The NPC is on screen and clickable from there; the
 * spot to stand on is a preference, not a need. Sabrael: someone standing on
 * the spot must not stop the vote.
 */
const NEAR_ENOUGH_TILES = 6

/**
 * How long to wait for the server's word after the last step, in milliseconds.
 *
 * A labor errand ends on a name, and the verdict comes back as a notice, not
 * a dialog: "<name> doesn't need any jobs done …". The run waits this long for
 * the first notice after its last key and reports it, so "done" says what was
 * done. Nothing is posted in this wait.
 */
const OUTCOME_WAIT_MS = 1500

/**
 * The notice that means "try again", and how many times to.
 *
 * "You were distracted" closes the dialog in place of the next step. Sabrael:
 * it is the server's exploit prevention, not a refusal, and the answer is to
 * open the conversation again. The run goes back to the first step and waits
 * for the player to reopen it, this many times, and then stops.
 */
const TRY_AGAIN_NOTICE = 'You were distracted'
const MAX_DISTRACTIONS = 2

/**
 * How many times a `restart` branch may send the run back to the first step.
 *
 * One restart is the errand that withdrew support from one citizen and then
 * supports another. A second restart is a loop, and the run stops instead.
 */
const MAX_RESTARTS = 1

/** How often to poll the dialog feed while waiting, in milliseconds. */
const POLL_MS = 40

/**
 * Where a dialog's rows are on the game's 640 x 480 screen.
 *
 * A row is selected by a click, and by nothing else: the live check of
 * 2026-09-21 posted a number key and the client sent nothing. The client's own
 * layouts (`lnpcd.txt` and `lnpcd2.txt` in `setoa.dat`) give the row pitch,
 * 18 px, and the row button's width, 20 to 406 in a 426-wide pane centred in
 * the 132 to 640 menu region, so 193 to 579 on screen. Where the rows sit
 * vertically is not in the layout: the pane grows with the row count, and the
 * hand run of the same night (forty clicks over 2-, 3-, 6-, and 12-row panes)
 * showed it grows upward. The last row's centre stays at y 335, and each row
 * above it is one pitch higher. Every measured click is within half a row of
 * this. A dialog with more rows than fit above the region's top is beyond
 * this gesture, and the run stops rather than click off the pane.
 *
 * The x is inside the band every hand click fell in (491 to 587), not the
 * centre a centred pane would give (386): a posted click at 386 was not
 * answered, and where the pane sits across the region is not measured. A
 * single click at 540 was answered on every row of the live run that closed
 * WP17; a double click was tried as a fallback that night and never needed.
 */
const ROW_PITCH = 18
const LAST_ROW_Y = 335
const ROW_X = 540

/** The screen y of a one-based row in a dialog of `rows` rows. */
export function rowY(rows: number, row: number): number {
  return LAST_ROW_Y - ROW_PITCH * (rows - row)
}

/** The dialog's Close button. Shared with the walker; see `dialogScreen.ts`. */
const CLOSE_X = CLOSE_BUTTON.x
const CLOSE_Y = CLOSE_BUTTON.y

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

/**
 * Describe a dialog for the log and the user, so the next run can add the case.
 *
 * Every id is in it: the view's pursuit, or each row's own for a menu. An
 * errand whose steps are not captured yet stops on its first dialog with this
 * line, and the line is the capture.
 */
function describeDialog(view: DialogView): string {
  const rows = view.options
    .map((option) =>
      option.pursuit !== undefined ? `"${option.text}" (${option.pursuit})` : `"${option.text}"`
    )
    .join(', ')
  const pursuit = view.pursuit !== undefined ? String(view.pursuit) : 'per row'
  const text = view.text !== undefined && view.text !== '' ? ` saying "${view.text.trim()}"` : ''
  const kind = view.isTextInput ? 'a text field' : `options: [${rows}]`
  return `pursuit ${pursuit} from ${view.npcName || 'an NPC'}${text}, ${kind}`
}

/** The labels of the errand's params the request gives no value for. */
function missingParams(errand: Errand, values: Record<string, string>): string[] {
  return (errand.params ?? [])
    .filter((param) => (values[param.name] ?? '').trim() === '')
    .map((param) => param.label)
}

export function createLaborer(options: LaborerOptions): Laborer {
  const { actionLayer, walker, liveConnections, dialogFor, log, onState } = options
  const noticeFor = options.noticeFor ?? ((): null => null)
  const positionFor = options.positionFor ?? ((): null => null)
  const resolveDestination = options.resolveDestination ?? ((): null => null)

  /**
   * Whether a walk that did not arrive still ended in reach of the NPC: on
   * the errand's map, within `NEAR_ENOUGH_TILES` of the NPC's tile.
   */
  function inReach(connectionId: string, errand: Errand): boolean {
    if (errand.npcTile === undefined) return false
    const position = positionFor(connectionId)
    if (position === null || position.confidence === 'unknown') return false
    const mapId = resolveDestination(errand.destination)
    if (mapId === null || position.mapId !== mapId) return false
    return (
      Math.abs(position.x - errand.npcTile.x) <= NEAR_ENOUGH_TILES &&
      Math.abs(position.y - errand.npcTile.y) <= NEAR_ENOUGH_TILES
    )
  }
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
        ? `the errand finished${outcome.saw !== undefined ? ` (${outcome.saw})` : ''}`
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

  /** What a wait for the next dialog ended with. */
  type Waited =
    | { kind: 'dialog'; dialog: DialogState }
    /** No dialog came, and a server notice did: the step was refused. */
    | { kind: 'notice'; notice: NoticeState }
    | { kind: 'timeout' }
    | { kind: 'stopped' }

  /**
   * Wait for a dialog whose capture time is after `afterMs`.
   *
   * A new dialog always wins. A server notice on its own is not a refusal:
   * the clout capture of 2026-09-21 shows "(( 4 Temauiran days = 12 Terran
   * hours ))" beside the confirmation, "You stop supporting …" beside the
   * close after a withdrawal, and world chat is the same packet. So a notice
   * counts only when the wait ends with no dialog at all, and then the first
   * notice after the step is the reason: "(( Register first …" is what an
   * unregistered character gets for Labor. `watchNotices` is off for the
   * opening wait, where nothing was asked of the server.
   */
  async function waitForDialog(
    run: Run,
    afterMs: number,
    timeoutMs: number,
    watchNotices: boolean
  ): Promise<Waited> {
    const deadline = (options.now ?? Date.now)() + timeoutMs
    let first: NoticeState | null = null
    for (;;) {
      if (!run.running || actionLayer.stopped) return { kind: 'stopped' }
      const dialog = dialogFor(run.connectionId)
      if (dialog !== null && dialog.asOfMs > afterMs) return { kind: 'dialog', dialog }
      if (watchNotices && first === null) {
        const notice = noticeFor(run.connectionId)
        if (notice !== null && notice.asOfMs > afterMs) first = notice
      }
      if ((options.now ?? Date.now)() >= deadline) {
        return first !== null ? { kind: 'notice', notice: first } : { kind: 'timeout' }
      }
      const sleeper = sleep(POLL_MS)
      run.cancelWait = sleeper.cancel
      await sleeper.promise
      run.cancelWait = undefined
    }
  }

  /**
   * Open the conversation by clicking the NPC, when its tile is known.
   *
   * The click aims at the NPC's sprite as the client draws it from where the
   * character stands (`laborer/view.ts`). Up to `OPEN_TRIES` clicks, each
   * waited on for `OPEN_WAIT_MS`; the caller then waits for the player. A
   * dialog already up when this starts is taken as it is.
   */
  async function openConversation(
    run: Run,
    target: ActionTarget,
    errand: Errand,
    afterMs: number
  ): Promise<ActionRefusal | null> {
    if (errand.npcTile === undefined) {
      log.info(
        'laborer',
        `The tile of ${errand.npcName} is not known; waiting for the player to open the conversation.`
      )
      return null
    }
    for (let attempt = 1; attempt <= OPEN_TRIES; attempt++) {
      const dialog = dialogFor(run.connectionId)
      if (dialog !== null && dialog.asOfMs > afterMs) return null
      const position = positionFor(run.connectionId)
      if (position === null) {
        log.warn(
          'laborer',
          `No position for the character; waiting for the player to open the conversation with ${errand.npcName}.`
        )
        return null
      }
      const point = creaturePoint({ x: position.x, y: position.y }, errand.npcTile)
      log.info(
        'laborer',
        `Clicking ${errand.npcName} on (${errand.npcTile.x}, ${errand.npcTile.y}) at game (${point.x}, ${point.y}) from (${position.x}, ${position.y}), view centre (${VIEW_CENTRE.x}, ${VIEW_CENTRE.y}), try ${attempt} of ${OPEN_TRIES}.`
      )
      const refusal = await actionLayer.click(target, point.x, point.y)
      if (refusal !== null) return refusal
      const waited = await waitForDialog(run, afterMs, OPEN_WAIT_MS, false)
      if (waited.kind === 'dialog') return null
      if (waited.kind === 'stopped') return 'stopped'
    }
    log.warn(
      'laborer',
      `No dialog after ${OPEN_TRIES} clicks on ${errand.npcName}; waiting for the player to open the conversation.`
    )
    return null
  }

  /** Click the one-based row `index` of a dialog that shows `rows` rows. */
  async function chooseRow(
    target: ActionTarget,
    index: number,
    rows: number
  ): Promise<ActionRefusal | null> {
    if (index < 1 || index > rows) return 'blocked'
    const y = rowY(rows, index)
    // The first row of a very tall pane would be above the menu region.
    if (y < ROW_PITCH / 2) return 'blocked'
    log.info('laborer', `Clicking row ${index} of ${rows} at game (${ROW_X}, ${y}).`)
    return actionLayer.click(target, ROW_X, y)
  }

  async function run(request: ErrandRequest): Promise<ErrandOutcome> {
    const { connectionId } = request
    const errand = errandList.find((candidate) => candidate.name === request.errand)
    if (errand === undefined) throw new Error(`There is no errand named "${request.errand}".`)
    if (!hasLiveCharacter(connectionId)) {
      throw new Error('No character is logged in on the selected window.')
    }
    const values = request.params ?? {}
    const missing = missingParams(errand, values)
    if (missing.length > 0) throw new Error(`The errand needs a value for: ${missing.join(', ')}.`)
    // The steps and the branches with the user's values in place of the
    // placeholders. The errand data itself never changes.
    const steps = errand.steps.map((step) => fillStep(step, values))
    const branches = (errand.branches ?? []).map((step) => fillStep(step, values))
    // Restart cleanly if one is already running on this connection.
    if (runs.has(connectionId)) stop(connectionId)

    const runState: Run = { connectionId, errand: errand.name, running: true, step: 0 }
    runs.set(connectionId, runState)
    publish(runState, 'walking to the NPC')
    log.info('laborer', `Laborer started on ${connectionId}: ${errand.name}.`)

    // Walk to the NPC first. The walker arms and disarms the connection itself,
    // so the Laborer arms again for the dialog phase after it arrives.
    // The spot to stand on wins over the NPC's own tile, which the walker
    // can only finish beside.
    const walk = await walker.go({
      connectionId,
      destination: errand.destination,
      ...(errand.standTile !== undefined
        ? { tile: errand.standTile, arrive: 'on' as const }
        : errand.npcTile !== undefined
          ? { tile: errand.npcTile, arrive: 'beside' as const }
          : {})
    })
    if (!runState.running)
      return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
    if (walk.kind !== 'arrived') {
      // A spot taken by someone else is not the end of the errand: from
      // anywhere near, the NPC is on screen and the click reaches it.
      if (walk.kind === 'stopped' && walk.reason === 'blocked' && inReach(connectionId, errand)) {
        const at = positionFor(connectionId)!
        log.info(
          'laborer',
          `The walk stopped short at (${at.x}, ${at.y}), in reach of ${errand.npcName}; going on.`
        )
      } else {
        return finish(runState, { kind: 'stopped', reason: 'walker' })
      }
    }

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
    let restarts = 0
    let distractions = 0
    let closedText: string | undefined

    for (let index = 0; index < steps.length; index++) {
      if (!runState.running)
        return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
      if (actionLayer.stopped) return finish(runState, { kind: 'stopped', reason: 'user' })
      if (!hasLiveCharacter(connectionId)) {
        return finish(runState, { kind: 'stopped', reason: 'lostCharacter' })
      }
      runState.step = index
      // The first dialog is opened by a click on the NPC, or by the player
      // when the NPC's tile is not known. The rest are the server's answers
      // to the Laborer's own clicks.
      const opening = index === 0
      if (opening) {
        publish(runState, `the conversation with ${errand.npcName} to open`)
        const refusal = await openConversation(runState, target, errand, lastAsOf)
        if (refusal === 'stopped' || !runState.running) {
          return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
        }
        if (refusal !== null) return finish(runState, { kind: 'stopped', reason: 'lostCharacter' })
      } else {
        publish(runState, `the dialog for step ${index + 1}`)
      }

      const waited = await waitForDialog(
        runState,
        lastAsOf,
        opening ? FIRST_DIALOG_WAIT_MS : DIALOG_WAIT_MS,
        !opening
      )
      if (waited.kind === 'stopped') {
        return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
      }
      if (waited.kind === 'timeout') return finish(runState, { kind: 'stopped', reason: 'timeout' })
      if (waited.kind === 'notice') {
        const saw = waited.notice.packet.text.trim()
        if (saw.startsWith(TRY_AGAIN_NOTICE) && distractions < MAX_DISTRACTIONS) {
          distractions += 1
          log.info(
            'laborer',
            `The server said "${saw}" at step ${index}: opening again from the first step.`
          )
          // The loop's own increment lands on the first step.
          index = -1
          continue
        }
        log.warn('laborer', `The server answered step ${index} with a notice: ${saw}. Stopping.`)
        return finish(runState, { kind: 'stopped', reason: 'serverNotice', saw })
      }
      const { dialog } = waited
      lastAsOf = dialog.asOfMs

      // The next step first. When it does not match, a branch may: a dialog the
      // server shows in place of the step, which says what follows it.
      const view = toView(dialog)
      let acted: DialogStep = steps[index]!
      let result: MatchResult = matchStep(acted, view)
      if (result.kind === 'noMatch') {
        for (const branch of branches) {
          const attempt = matchStep(branch, view)
          if (attempt.kind === 'noMatch') continue
          acted = branch
          result = attempt
          break
        }
      }

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

      let refusal: ActionRefusal | null
      if (result.kind === 'choose') {
        refusal = await chooseRow(target, result.index, view.options.length)
      } else if (result.kind === 'close') {
        // The verdict of a close step is the dialog it closed.
        closedText = view.text?.trim()
        log.info('laborer', `Closing the dialog at game (${CLOSE_X}, ${CLOSE_Y}).`)
        refusal = await actionLayer.click(target, CLOSE_X, CLOSE_Y)
      } else {
        refusal = await actionLayer.typeText(target, result.text)
      }
      if (!runState.running) {
        return finish(runState, { kind: 'stopped', reason: runState.stopReason ?? 'user' })
      }
      if (refusal !== null) {
        if (refusal === 'stopped') return finish(runState, { kind: 'stopped', reason: 'user' })
        return finish(runState, { kind: 'stopped', reason: 'lostCharacter' })
      }

      if (acted.then === 'done') break
      if (acted.then === 'restart') {
        if (restarts >= MAX_RESTARTS) {
          const saw = describeDialog(view)
          log.warn('laborer', `The errand asked to restart again after: ${saw}. Stopping.`)
          return finish(runState, { kind: 'stopped', reason: 'unmatchedDialog', saw })
        }
        restarts += 1
        log.info('laborer', `Restarting the errand from the first step after "${acted.when}".`)
        // The loop's own increment lands on the first step.
        index = -1
      }
    }

    // The server's word after the last step, when it gives one: a notice, or
    // the text of the dialog a close step closed.
    const after = await waitForDialog(runState, lastAsOf, OUTCOME_WAIT_MS, true)
    if (after.kind === 'notice') {
      const saw = after.notice.packet.text.trim()
      log.info('laborer', `The server said, after the last step: ${saw}.`)
      return finish(runState, { kind: 'done', saw })
    }
    if (closedText !== undefined && closedText !== '') {
      return finish(runState, { kind: 'done', saw: closedText })
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
