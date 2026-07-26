import type { GameWindow, TcpConnection } from 'da-pcap'
import type { ActionRefusal, ActionTarget, AssistState, AssistWindow } from '../shared/types'
import { wrapChatLine } from '../shared/types'
import { connectionIdOf } from './capture/source'
import { DEFAULT_PROCESS_NAME } from './capture/pcapSource'
import type { Logger } from './log'

/**
 * The one place that presses a key in the game window, and the one stop that
 * always works.
 *
 * The layer posts a message to a window's own input queue with PostMessageW. It
 * sends no packet, reads no memory, and injects nothing. The client validates
 * every posted key exactly as it validates a real one, so nothing happens that a
 * player could not do by hand.
 *
 * The layer is an interface with one real implementation, so a driver runs
 * against a fake window API with no game — the same seam PacketSource gives the
 * decode side.
 */

/** The subset of the native addon the layer drives. Injected, so tests fake it. */
export interface WindowApi {
  processIdsByName(name: string): number[]
  tcpConnectionsForPid(pid: number): TcpConnection[]
  windowsForPid(pid: number): GameWindow[]
  postMessageToWindow(handle: number, message: number, wParam: number, lParam: number): boolean
  setForegroundWindow(handle: number): boolean
  foregroundWindow(): number
  isWindow(handle: number): boolean
}

/** The global-hotkey registrar. Injected, so tests need no Electron. */
export interface HotkeyRegistrar {
  register(accelerator: string, callback: () => void): boolean
  unregisterAll(): void
}

/** One connection that carries a decoded character now. */
export interface LiveConnection {
  connectionId: string
  name: string
}

export interface ActionLayerOptions {
  /** The native window API. In the app this is the loaded da-pcap addon. */
  windows: WindowApi
  /** The global-hotkey registrar. In the app this wraps Electron globalShortcut. */
  hotkeys: HotkeyRegistrar
  /** The connections that carry a live character now. From the capture service. */
  liveConnections: () => LiveConnection[]
  log: Logger
  /** Called whenever the stop state changes, so main can push it. */
  onState?: (state: AssistState) => void
  /** The game process to resolve windows from. */
  processName?: string
  /** The global stop hotkey, an Electron accelerator string. */
  stopHotkey?: string
  /** The global Speaker start/stop hotkey. Empty registers no hotkey. */
  speakerToggleHotkey?: string
  /** Called when the Speaker toggle hotkey fires. */
  onSpeakerToggle?: () => void
  /** Also stop a driver when its window loses focus. */
  stopOnFocusLoss?: boolean
  /** The shortest gap between two driver actions, in milliseconds. */
  minActionGapMs?: number
  /** The clock. Injected by tests. */
  now?: () => number
  /** Sleep for a number of milliseconds. Injected by tests. */
  wait?: (ms: number) => Promise<void>
  /** A number in [0, 1). Injected by tests to make jitter deterministic. */
  random?: () => number
}

/** The action layer contract. One real implementation, and a fake for tests. */
export interface ActionLayer {
  /** Resolve the window for a connection, or null when it cannot be found. */
  resolveTarget(connectionId: string): ActionTarget | null
  /** The open game windows the user can pick to drive. */
  listWindows(): AssistWindow[]
  /**
   * Begin a driving session on a connection. Clears any stop, brings the window
   * to the foreground once, and watches it for the auto-stop conditions. Returns
   * the target, or a refusal when the window cannot be resolved.
   */
  arm(connectionId: string, onStop?: (reason: string) => void): ActionTarget | ActionRefusal
  /** End a driving session and stop watching the connection. */
  disarm(connectionId: string): void
  /** Post one key to a target. Refuses, never throws. */
  pressKey(target: ActionTarget, key: number): Promise<ActionRefusal | null>
  /** Type a whole line into a target, then send it. Refuses, never throws. */
  typeLine(target: ActionTarget, text: string): Promise<ActionRefusal | null>
  /** True while any stop is in force. Drivers poll this between steps. */
  readonly stopped: boolean
  /** Halt every driver now. Idempotent, and safe to call from anywhere. */
  stopAll(reason: string): void
  /** Clear a stop so a driver can start again. Arming clears it too. */
  clearStop(): void
  /** Whether a stop is in force, and why. */
  state(): AssistState
  /** Apply changed settings: the two hotkeys and the focus-loss rule. */
  updateSettings(settings: {
    stopHotkey: string
    speakerToggleHotkey: string
    stopOnFocusLoss: boolean
  }): void
  /** Register the global hotkey and start. Call once, after the app is ready. */
  register(): void
  /** Release the hotkey and stop the watch. Call once, on quit. */
  dispose(): void
}

// The Win32 messages and virtual keys the layer posts. Kept in one place so a
// live correction to the chat key sequence is a one-line change.
const WM_KEYDOWN = 0x0100
const WM_KEYUP = 0x0101
const WM_CHAR = 0x0102
export const VK_RETURN = 0x0d
// lParam for a key message: repeat count 1 for key-down, the transition and
// previous-state bits set for key-up. Only the low 32 bits are read by a window
// procedure, so the value is portable to 64-bit.
const KEYDOWN_LPARAM = 0x00000001
const KEYUP_LPARAM = 0xc0000001

// The four arrow keys and their hardware scan codes. Movement keys are extended
// keys, so a correct lParam carries the scan code and the extended-key bit. A
// client that reads the scan code, or polls the keyboard state, needs this; the
// bare KEYDOWN_LPARAM above is enough only for a control that reads the virtual
// key alone (the chat input reads Enter that way).
const VK_ARROWS = new Set([0x25, 0x26, 0x27, 0x28])
const ARROW_SCAN_CODE: Record<number, number> = {
  0x25: 0x4b, // VK_LEFT
  0x26: 0x48, // VK_UP
  0x27: 0x4d, // VK_RIGHT
  0x28: 0x50 // VK_DOWN
}
const EXTENDED_KEY_BIT = 0x01000000

/** How long a driver holds a movement key down, in milliseconds. */
const KEY_HOLD_BASE_MS = 60
const KEY_HOLD_JITTER_MS = 30

/** Build the lParam for a key message, with the scan code and extended-key bit. */
function keyLparam(vk: number, up: boolean): number {
  const scan = ARROW_SCAN_CODE[vk] ?? 0
  let lparam = 0x00000001 | (scan << 16)
  if (VK_ARROWS.has(vk)) lparam |= EXTENDED_KEY_BIT
  if (up) lparam |= 0xc0000000
  return lparam >>> 0
}

/** TCP states worth resolving. A closing connection has no window to drive. */
const LIVE_STATES = new Set([3 /* SYN_SENT */, 4 /* SYN_RCVD */, 5 /* ESTABLISHED */])

/** How often the watch checks the armed windows, in milliseconds. */
const WATCH_INTERVAL_MS = 500

/** The base gap between two typed characters, in milliseconds. */
const TYPE_BASE_GAP_MS = 45
/** The extra jitter added to each typed-character gap, in milliseconds. */
const TYPE_JITTER_MS = 40

// After opening the chat input, the client needs a moment to focus it before it
// reads characters. Too short a wait drops the first characters of a line.
const OPEN_SETTLE_BASE_MS = 110
const OPEN_SETTLE_JITTER_MS = 60

// After sending a line, the input closes and must reopen for the next line. Too
// short a wait here types the next line into a closing input, and a short line
// is lost whole. This is the gap between one send and the next line's opening.
const SEND_SETTLE_BASE_MS = 320
const SEND_SETTLE_JITTER_MS = 200

const DEFAULT_MIN_ACTION_GAP_MS = 40

interface ArmedDriver {
  target: ActionTarget
  onStop?: (reason: string) => void
  /** True once the window has been seen in the foreground. Gates focus-loss. */
  everFocused: boolean
}

export function createActionLayer(options: ActionLayerOptions): ActionLayer {
  const { windows, hotkeys, liveConnections, log, onState, onSpeakerToggle } = options
  const now = options.now ?? Date.now
  const wait = options.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const random = options.random ?? Math.random
  const processName = options.processName ?? DEFAULT_PROCESS_NAME
  const minActionGapMs = options.minActionGapMs ?? DEFAULT_MIN_ACTION_GAP_MS

  let stopHotkey = options.stopHotkey ?? 'CommandOrControl+Alt+.'
  let speakerToggleHotkey = options.speakerToggleHotkey ?? ''
  let stopOnFocusLoss = options.stopOnFocusLoss ?? false

  let stopped = false
  let stopReason: string | undefined
  let lastActionMs = Number.NEGATIVE_INFINITY
  let lastGapMs = -1

  const armed = new Map<string, ArmedDriver>()
  let watch: NodeJS.Timeout | undefined

  function publishState(): void {
    onState?.(state())
  }

  function state(): AssistState {
    return { stopped, ...(stopReason !== undefined ? { reason: stopReason } : {}) }
  }

  /** Find the game process that owns a connection. */
  function pidForConnection(connectionId: string): number | null {
    for (const pid of windows.processIdsByName(processName)) {
      for (const connection of windows.tcpConnectionsForPid(pid)) {
        const id = connectionIdOf(
          connection.localAddress,
          connection.localPort,
          connection.remoteAddress,
          connection.remotePort
        )
        if (id === connectionId) return pid
      }
    }
    return null
  }

  /** The first visible, titled window a process owns, or null. */
  function mainWindowOf(pid: number): GameWindow | null {
    const found = windows.windowsForPid(pid)
    return found.length > 0 ? found[0] : null
  }

  function resolveTarget(connectionId: string): ActionTarget | null {
    const pid = pidForConnection(connectionId)
    if (pid === null) return null
    const window = mainWindowOf(pid)
    if (window === null) return null
    return { connectionId, windowHandle: window.handle }
  }

  function listWindows(): AssistWindow[] {
    const names = new Map(liveConnections().map((c) => [c.connectionId, c.name]))
    const result: AssistWindow[] = []
    for (const pid of windows.processIdsByName(processName)) {
      const window = mainWindowOf(pid)
      if (window === null) continue
      const live = windows
        .tcpConnectionsForPid(pid)
        .filter((connection) => LIVE_STATES.has(connection.state))
        .map((connection) =>
          connectionIdOf(
            connection.localAddress,
            connection.localPort,
            connection.remoteAddress,
            connection.remotePort
          )
        )
      if (live.length === 0) continue
      // Prefer the connection that carries a character; a client has one world
      // connection worth driving, and it is the one Midir decoded a name on.
      const connectionId = live.find((id) => names.has(id)) ?? live[0]
      result.push({
        connectionId,
        windowHandle: window.handle,
        title: window.title,
        ...(names.has(connectionId) ? { characterName: names.get(connectionId) } : {})
      })
    }
    return result
  }

  /** Re-check a target and the stop before any action. Returns a refusal or null. */
  function guard(target: ActionTarget): ActionRefusal | null {
    if (stopped) return 'stopped'
    if (!windows.isWindow(target.windowHandle)) return 'noWindow'
    const fresh = resolveTarget(target.connectionId)
    if (fresh === null) return 'noWindow'
    if (fresh.windowHandle !== target.windowHandle) return 'wrongProcess'
    // A connection with no decoded character may be at a login or a character
    // screen. The layer never types there, so it can never touch a credential
    // field. This is the credential guard, not a nicety.
    const hasCharacter = liveConnections().some((c) => c.connectionId === target.connectionId)
    if (!hasCharacter) return 'blocked'
    return null
  }

  /** Enforce the minimum gap between two driver actions. */
  function rateGate(): ActionRefusal | null {
    if (now() - lastActionMs < minActionGapMs) return 'rateLimited'
    lastActionMs = now()
    return null
  }

  /** The next jittered gap, never the same as the last one. */
  function nextGap(): number {
    let gap = TYPE_BASE_GAP_MS + Math.floor(random() * TYPE_JITTER_MS)
    if (gap === lastGapMs) gap += 1
    lastGapMs = gap
    return gap
  }

  /** The wait after opening the input, before typing. */
  function openSettleMs(): number {
    return OPEN_SETTLE_BASE_MS + Math.floor(random() * OPEN_SETTLE_JITTER_MS)
  }

  /** The wait after a send, before the next line opens. */
  function sendSettleMs(): number {
    return SEND_SETTLE_BASE_MS + Math.floor(random() * SEND_SETTLE_JITTER_MS)
  }

  function postKey(handle: number, vk: number): void {
    windows.postMessageToWindow(handle, WM_KEYDOWN, vk, KEYDOWN_LPARAM)
    windows.postMessageToWindow(handle, WM_KEYUP, vk, KEYUP_LPARAM)
  }

  /** The hold time for one movement key, jittered so no two are identical. */
  function keyHoldMs(): number {
    return KEY_HOLD_BASE_MS + Math.floor(random() * KEY_HOLD_JITTER_MS)
  }

  /**
   * Post one key and hold it before releasing.
   *
   * The client reads movement by polling the keyboard, not from the message
   * queue, so a key that goes down and up in the same instant is never sampled
   * as down. The driver holds the key for a short time, exactly as a player's
   * finger does, and uses the extended-key lParam a real arrow key carries.
   */
  async function pressKey(target: ActionTarget, key: number): Promise<ActionRefusal | null> {
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal
    const handle = target.windowHandle
    const hold = keyHoldMs()
    windows.postMessageToWindow(handle, WM_KEYDOWN, key, keyLparam(key, false))
    await wait(hold)
    windows.postMessageToWindow(handle, WM_KEYUP, key, keyLparam(key, true))
    log.info('assist', `Posted key 0x${key.toString(16)} held ${hold} ms to window ${handle}.`)
    return null
  }

  async function typeLine(target: ActionTarget, text: string): Promise<ActionRefusal | null> {
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal

    // A line is typed one character at a time, so a stop must be able to break
    // in mid-line. Two things end it: the global stop, and this driver being
    // disarmed (the per-window Stop). The armed entry's identity is the token:
    // when it changes or goes, this run is over. A caller that never armed has
    // no token, so a bare pressKey/typeLine still works.
    const session = armed.get(target.connectionId)
    const aborted = (): boolean => stopped || armed.get(target.connectionId) !== session

    // The client sends at most MAX_CHAT_CHARS in one line, so a long line is
    // broken into pieces and each piece is one send.
    const pieces = wrapChatLine(text)
    const handle = target.windowHandle
    for (let i = 0; i < pieces.length; i++) {
      if (aborted()) return 'stopped'
      // Enter opens the chat input first. Without it the first line is typed
      // into the game world and lost, so the reader sees the second line first.
      postKey(handle, VK_RETURN)
      // Let the input take focus before typing, or the first characters drop.
      await wait(openSettleMs())
      // Each character arrives as WM_CHAR, the message a real key press produces
      // for a text control. The pacing is the layer's, with jitter so no two
      // gaps are the same.
      for (const character of pieces[i]) {
        if (aborted()) return 'stopped'
        windows.postMessageToWindow(handle, WM_CHAR, character.codePointAt(0) ?? 0, 1)
        await wait(nextGap())
      }
      if (aborted()) return 'stopped'
      // Enter sends the line.
      postKey(handle, VK_RETURN)
      // Settle before the next piece so its opening does not land in a closing
      // input. A short piece after a hyphen is the one that gets lost otherwise.
      if (i < pieces.length - 1) await wait(sendSettleMs())
    }
    log.info('assist', `Sent a line to window ${handle} in ${pieces.length} part(s).`)
    return null
  }

  function ensureWatch(): void {
    if (watch !== undefined) return
    watch = setInterval(tick, WATCH_INTERVAL_MS)
  }

  function stopWatch(): void {
    if (watch === undefined) return
    clearInterval(watch)
    watch = undefined
  }

  /** The watch: stop a driver whose window is gone, closed, or lost focus. */
  function tick(): void {
    if (stopped) return
    for (const [connectionId, driver] of armed) {
      const fresh = resolveTarget(connectionId)
      if (fresh === null) {
        stopAll('the game window closed')
        return
      }
      if (fresh.windowHandle !== driver.target.windowHandle) {
        stopAll('the game window closed')
        return
      }
      if (windows.foregroundWindow() === driver.target.windowHandle) driver.everFocused = true
      else if (stopOnFocusLoss && driver.everFocused) {
        stopAll('the game window lost focus')
        return
      }
    }
  }

  function arm(
    connectionId: string,
    onStop?: (reason: string) => void
  ): ActionTarget | ActionRefusal {
    const target = resolveTarget(connectionId)
    if (target === null) return 'noWindow'

    // A new driving session clears a stop from a previous run.
    if (stopped) {
      stopped = false
      stopReason = undefined
      publishState()
    }

    windows.setForegroundWindow(target.windowHandle)
    armed.set(connectionId, {
      target,
      onStop,
      everFocused: windows.foregroundWindow() === target.windowHandle
    })
    ensureWatch()
    log.info('assist', `Armed a driver on window ${target.windowHandle}.`)
    return target
  }

  function disarm(connectionId: string): void {
    if (armed.delete(connectionId) && armed.size === 0) stopWatch()
  }

  function stopAll(reason: string): void {
    const drivers = [...armed.values()]
    armed.clear()
    stopWatch()
    if (!stopped) {
      stopped = true
      stopReason = reason
      log.warn('assist', `Stopped every driver: ${reason}.`)
      publishState()
    }
    for (const driver of drivers) driver.onStop?.(reason)
  }

  function clearStop(): void {
    if (!stopped) return
    stopped = false
    stopReason = undefined
    log.info('assist', 'The stop was cleared.')
    publishState()
  }

  function registerHotkey(): void {
    hotkeys.unregisterAll()
    const ok = hotkeys.register(stopHotkey, () => stopAll('the stop hotkey was pressed'))
    if (!ok) {
      // A missing hotkey is not a missing stop: the polled flag and the auto
      // stops still work. Tell the user so they can pick a free combination.
      log.warn('assist', `Could not register the stop hotkey "${stopHotkey}". It may be in use.`)
    }
    if (onSpeakerToggle !== undefined && speakerToggleHotkey !== '') {
      const okToggle = hotkeys.register(speakerToggleHotkey, () => onSpeakerToggle())
      if (!okToggle) {
        log.warn(
          'assist',
          `Could not register the speaker hotkey "${speakerToggleHotkey}". It may be in use.`
        )
      }
    }
  }

  return {
    resolveTarget,
    listWindows,
    arm,
    disarm,
    pressKey,
    typeLine,
    get stopped(): boolean {
      return stopped
    },
    stopAll,
    clearStop,
    state,
    updateSettings(settings: {
      stopHotkey: string
      speakerToggleHotkey: string
      stopOnFocusLoss: boolean
    }): void {
      stopOnFocusLoss = settings.stopOnFocusLoss
      if (
        settings.stopHotkey !== stopHotkey ||
        settings.speakerToggleHotkey !== speakerToggleHotkey
      ) {
        stopHotkey = settings.stopHotkey
        speakerToggleHotkey = settings.speakerToggleHotkey
        registerHotkey()
      }
    },
    register(): void {
      registerHotkey()
    },
    dispose(): void {
      stopWatch()
      armed.clear()
      hotkeys.unregisterAll()
    }
  }
}
