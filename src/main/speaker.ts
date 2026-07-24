import type { ActionRefusal, SpeakerConfig, SpeakerState } from '../shared/types'
import { MIN_SPEAKER_INTERVAL_MS } from '../shared/types'
import type { ActionLayer, LiveConnection } from './actionLayer'
import type { Logger } from './log'

/**
 * The Speaker: type a rotating list of lines into one selected window on an
 * interval, and stop when told.
 *
 * It is the smallest user of the action layer, and it proves it: almost all of
 * the work — the window, the keys, the stop — is the layer's. The Speaker adds a
 * list, an interval, and the one rule the layer cannot know: there must be a
 * character logged in to speak, or the Speaker types into a login screen.
 *
 * The layer and the capture service are injected, so the Speaker runs with a
 * fake action layer and no game.
 */

/** An interruptible sleep. `cancel` resolves the promise at once. */
export interface Sleeper {
  promise: Promise<void>
  cancel: () => void
}

export interface SpeakerOptions {
  actionLayer: ActionLayer
  /** The connections that carry a live character now. From the capture service. */
  liveConnections: () => LiveConnection[]
  log: Logger
  /** Called whenever a Speaker changes, so main can push it. */
  onState?: (state: SpeakerState) => void
  /** The clock. Injected by tests. */
  now?: () => number
  /** A number in [0, 1). Injected by tests to make jitter deterministic. */
  random?: () => number
  /** Build an interruptible sleep. Injected by tests. */
  sleep?: (ms: number) => Sleeper
}

export interface Speaker {
  /** Start speaking on a connection. Rejects with a message to show the user. */
  start(config: SpeakerConfig): Promise<void>
  /** Stop the Speaker on one connection. */
  stop(connectionId: string): void
  /** Every Speaker running now. */
  states(): SpeakerState[]
  /** Stop every Speaker quietly. Called on shutdown. */
  dispose(): void
}

/** The most extra time added to the interval floor, in milliseconds. */
const INTERVAL_JITTER_MS = 1500

interface Run {
  config: SpeakerConfig
  index: number
  running: boolean
  lastSentAtMs?: number
  cancelSleep?: () => void
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

/** Turn a refusal into a message worth showing the user. */
function refusalMessage(refusal: ActionRefusal): string {
  switch (refusal) {
    case 'noWindow':
      return 'The game window is not open.'
    case 'wrongProcess':
      return 'The game window changed.'
    case 'blocked':
      return 'No character is logged in on that window.'
    case 'rateLimited':
      return 'Midir refused a key that came too fast.'
    case 'stopped':
      return 'A stop is in force.'
  }
}

export function createSpeaker(options: SpeakerOptions): Speaker {
  const { actionLayer, liveConnections, log, onState } = options
  const now = options.now ?? Date.now
  const random = options.random ?? Math.random
  const sleep = options.sleep ?? defaultSleep

  const runs = new Map<string, Run>()

  function hasLiveCharacter(connectionId: string): boolean {
    return liveConnections().some((c) => c.connectionId === connectionId)
  }

  function publish(run: Run): void {
    onState?.({
      connectionId: run.config.connectionId,
      running: run.running,
      ...(run.lastSentAtMs !== undefined ? { lastSentAtMs: run.lastSentAtMs } : {})
    })
  }

  /** End a run, disarm the layer, and tell the renderer why it ended. */
  function finish(connectionId: string, reason: string): void {
    const run = runs.get(connectionId)
    if (run === undefined) return
    run.running = false
    run.cancelSleep?.()
    runs.delete(connectionId)
    actionLayer.disarm(connectionId)
    onState?.({
      connectionId,
      running: false,
      ...(run.lastSentAtMs !== undefined ? { lastSentAtMs: run.lastSentAtMs } : {}),
      reason
    })
    log.info('speaker', `Speaker stopped on ${connectionId}: ${reason}.`)
  }

  async function loop(connectionId: string): Promise<void> {
    const run = runs.get(connectionId)
    if (run === undefined) return

    while (run.running && !actionLayer.stopped) {
      if (!hasLiveCharacter(connectionId)) {
        finish(connectionId, 'the character logged off')
        return
      }
      const target = actionLayer.resolveTarget(connectionId)
      if (target === null) {
        finish(connectionId, 'the game window closed')
        return
      }

      const line = run.config.lines[run.index % run.config.lines.length]
      run.index++
      const refusal = await actionLayer.typeLine(target, line)
      if (!run.running) return // stopped while typing
      if (refusal !== null) {
        // A global stop is already handled through the arm callback, so it needs
        // no second message here.
        if (refusal !== 'stopped') finish(connectionId, refusalMessage(refusal))
        return
      }

      run.lastSentAtMs = now()
      publish(run)

      // Without repeat, stop once every line has gone once. The stop is here,
      // after the send, so the last line is never followed by a wait.
      if (!run.config.repeat && run.index >= run.config.lines.length) {
        finish(connectionId, 'the list finished')
        return
      }

      const waitMs = run.config.intervalMs + Math.floor(random() * INTERVAL_JITTER_MS)
      const sleeper = sleep(waitMs)
      run.cancelSleep = sleeper.cancel
      await sleeper.promise
      run.cancelSleep = undefined
    }
  }

  async function start(config: SpeakerConfig): Promise<void> {
    if (config.lines.length === 0) {
      throw new Error('Add at least one line before you start the speaker.')
    }
    const intervalMs = Math.max(config.intervalMs, MIN_SPEAKER_INTERVAL_MS)
    if (!hasLiveCharacter(config.connectionId)) {
      throw new Error('No character is logged in on the selected window.')
    }
    // Restart cleanly if one is already running on this connection.
    if (runs.has(config.connectionId)) finish(config.connectionId, 'restarted')

    const armed = actionLayer.arm(config.connectionId, (reason) =>
      finish(config.connectionId, reason)
    )
    if (typeof armed === 'string') {
      throw new Error(refusalMessage(armed))
    }

    const run: Run = { config: { ...config, intervalMs }, index: 0, running: true }
    runs.set(config.connectionId, run)
    publish(run)
    log.info('speaker', `Speaker started on ${config.connectionId}.`)
    void loop(config.connectionId)
  }

  return {
    start,
    stop(connectionId: string): void {
      finish(connectionId, 'you stopped it')
    },
    states(): SpeakerState[] {
      return [...runs.values()].map((run) => ({
        connectionId: run.config.connectionId,
        running: run.running,
        ...(run.lastSentAtMs !== undefined ? { lastSentAtMs: run.lastSentAtMs } : {})
      }))
    },
    dispose(): void {
      for (const connectionId of [...runs.keys()]) {
        const run = runs.get(connectionId)
        if (run !== undefined) {
          run.running = false
          run.cancelSleep?.()
        }
        runs.delete(connectionId)
        actionLayer.disarm(connectionId)
      }
    }
  }
}
