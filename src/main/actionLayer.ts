import type { ClientSize, GameWindow, PointerState, TcpConnection } from 'da-pcap'
import type { ActionRefusal, ActionTarget, AssistState, AssistWindow } from '../shared/types'
import { wrapChatLine } from '../shared/types'
import { connectionIdOf } from './capture/source'
import { DEFAULT_PROCESS_NAME } from './capture/pcapSource'
import type { Logger } from './log'

/**
 * The one place that presses a key or clicks in the game window, and the one
 * stop that always works.
 *
 * The layer posts a message to a window's own input queue with PostMessageW. It
 * sends no packet, reads no memory, and injects nothing. The client validates
 * every posted key and click exactly as it validates a real one, so nothing
 * happens that a player could not do by hand.
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
  /** The real pointer in a window's client area. See da-pcap `pointerIn`. */
  pointerIn(handle: number): PointerState | null
  /** The client area's size and DPI awareness. See da-pcap `clientSize`. */
  clientSize(handle: number): ClientSize | null
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
  /** Type a whole chat line into a target, then send it. Refuses, never throws. */
  typeLine(target: ActionTarget, text: string): Promise<ActionRefusal | null>
  /**
   * Type text into the control that has focus, then press Enter. For a
   * dialog's text field, which has focus when the dialog opens; `typeLine`
   * is for chat, and its opening Enter would submit the field empty.
   */
  typeText(target: ActionTarget, text: string): Promise<ActionRefusal | null>
  /**
   * Click the left button at a position in the game's own 640 x 480
   * coordinates, scaled to the window as it is. Refuses, never throws. The
   * walker uses it to pick a point on the world map. The click is posted
   * twice unless `once` is set: a list row opens on a double click, and the
   * board poll selects a row without opening it (WP36).
   */
  click(
    target: ActionTarget,
    x: number,
    y: number,
    options?: { once?: boolean }
  ): Promise<ActionRefusal | null>
  /**
   * Press and release the right button once at a position in the game's own
   * 640 x 480 coordinates. On empty ground the client walks there by its own
   * pathfinder (WP35). Two right presses close together on a creature are
   * pursue-and-attack, so this never posts a second press within
   * `RIGHT_CLICK_GAP_MS` of the last: it waits out the rest of the gap first,
   * whatever the caller asks. Refuses, never throws.
   */
  rightClick(target: ActionTarget, x: number, y: number): Promise<ActionRefusal | null>
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
const WM_MOUSEMOVE = 0x0200
const WM_LBUTTONDOWN = 0x0201
const WM_LBUTTONUP = 0x0202
const WM_RBUTTONDOWN = 0x0204
const WM_RBUTTONUP = 0x0205
/** The wParam of a left-button message while the left button is down. */
const MK_LBUTTON = 0x0001
/** The wParam of a right-button message while the right button is down. */
const MK_RBUTTON = 0x0002
/**
 * The least time between two posted right presses, in milliseconds.
 *
 * The client makes a double right-click of its own: a second right press
 * under 1000 ms after the last, within 2 px of it, is its pointer event 5
 * (darkages-741-re, `systems/events.md`), and on a creature or a player that
 * is pursue-and-attack. The gap is enforced in the one place that posts the
 * button, so no caller can make a double by mistake. Half a second of margin
 * over the client's own window covers a message queue that delivers late.
 */
export const RIGHT_CLICK_GAP_MS = 1500
export const VK_RETURN = 0x0d
export const VK_ESCAPE = 0x1b
export const VK_SPACE = 0x20
export const VK_UP = 0x26
export const VK_DOWN = 0x28
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
const SCAN_CODE: Record<number, number> = {
  0x1b: 0x01, // VK_ESCAPE
  0x25: 0x4b, // VK_LEFT
  0x26: 0x48, // VK_UP
  0x27: 0x4d, // VK_RIGHT
  0x28: 0x50 // VK_DOWN
}
const EXTENDED_KEY_BIT = 0x01000000

/**
 * The keys a real press also delivers as a character. TranslateMessage turns
 * a key-down for these into a WM_CHAR between the down and the up, and a pane
 * that reads characters (the dialog's text field does; the exchange window's
 * cancel on Escape is the live question) sees only that message. A posted
 * key-down alone is invisible to it: the live run of 2026-09-21 11:29Z posted
 * Escape as down and up at a dialog and at an exchange window, and both
 * stayed up, while Sabrael's own Escape cancelled the exchange at once.
 */
const CHAR_OF_KEY: Record<number, number> = {
  0x1b: 0x1b // VK_ESCAPE
}

/** How long a driver holds a movement key down, in milliseconds. */
const KEY_HOLD_BASE_MS = 60
const KEY_HOLD_JITTER_MS = 30

/** The size the game draws itself at, and the space every wire coordinate is in. */
export const GAME_WIDTH = 640
export const GAME_HEIGHT = 480

/**
 * Scale a game coordinate to the window's client area as Midir sees it.
 *
 * The game speaks 640 x 480: the world map's points, the view centre, every
 * position the wire or the legacy tools give. On a scaled display the window
 * is larger on screen, and the coordinate is scaled to that size whether the
 * window is DPI-aware or not. A DPI-aware window really is larger and
 * stretches its 640 x 480 to fit. A DPI-unaware window is stretched by
 * Windows, and Windows also translates the coordinates of a message posted
 * to it from a DPI-aware process such as Midir: the live check of 2026-09-21
 * posted an unscaled (307, 77) to a 960 x 720 unaware window and it landed
 * on nothing, while the physical (456, 108) of a hand click on the same
 * label was what the client acted on. So the physical size is the right
 * space for both. With no size to read, the coordinate is posted as it is.
 */
export function toClientPoint(
  x: number,
  y: number,
  size: ClientSize | null
): { x: number; y: number; scaled: boolean } {
  if (size === null || size.width <= 0 || size.height <= 0) return { x, y, scaled: false }
  if (size.width === GAME_WIDTH && size.height === GAME_HEIGHT) return { x, y, scaled: false }
  return {
    x: Math.round((x * size.width) / GAME_WIDTH),
    y: Math.round((y * size.height) / GAME_HEIGHT),
    scaled: true
  }
}

/** Build the lParam for a mouse message: the client-area x in the low word, y in the high. */
function mouseLparam(x: number, y: number): number {
  return (((y & 0xffff) << 16) | (x & 0xffff)) >>> 0
}

/** Build the lParam for a key message, with the scan code and extended-key bit. */
function keyLparam(vk: number, up: boolean): number {
  const scan = SCAN_CODE[vk] ?? 0
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
  /** When the last right press was posted, to any window. */
  let lastRightClickMs = Number.NEGATIVE_INFINITY

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
   * finger does, and uses the extended-key lParam a real arrow key carries. A
   * key that a real press also delivers as a character (Escape) gets its
   * WM_CHAR after the down, as TranslateMessage would give it.
   */
  async function pressKey(target: ActionTarget, key: number): Promise<ActionRefusal | null> {
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal
    const handle = target.windowHandle
    const hold = keyHoldMs()
    windows.postMessageToWindow(handle, WM_KEYDOWN, key, keyLparam(key, false))
    const character = CHAR_OF_KEY[key]
    if (character !== undefined) {
      windows.postMessageToWindow(handle, WM_CHAR, character, keyLparam(key, false))
    }
    await wait(hold)
    windows.postMessageToWindow(handle, WM_KEYUP, key, keyLparam(key, true))
    log.info(
      'assist',
      `Posted key 0x${key.toString(16)}${character !== undefined ? ' with its character' : ''} held ${hold} ms to window ${handle}.`
    )
    return null
  }

  /**
   * Move the pointer to a client-area position and click there, twice.
   *
   * The move first tells the client where the pointer is, as a real click is
   * always preceded by a move. The button goes down and up in one posting,
   * with no hold: the pane selects a point on the release over it, and a hold
   * is a window in which the real mouse can move the pointer off the point
   * before the release lands. A key is held because the client polls keys; a
   * click is a message, and needs no hold. The click is posted twice because
   * that is what DA Walker does for the world map, and it is the proven
   * gesture: a second release on the same point selects the same point again,
   * so the repeat costs nothing. A list row is the exception: the client opens
   * a row on a double click (the hand browse of 2026-09-22 did so), and a
   * caller that means to select a row and not open it asks for `once`.
   */
  async function click(
    target: ActionTarget,
    x: number,
    y: number,
    options: { once?: boolean } = {}
  ): Promise<ActionRefusal | null> {
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal
    const handle = target.windowHandle
    const size = windows.clientSize(handle)
    const point = toClientPoint(x, y, size)
    const lparam = mouseLparam(point.x, point.y)
    windows.postMessageToWindow(handle, WM_MOUSEMOVE, 0, lparam)
    const presses = options.once === true ? 1 : 2
    for (let i = 0; i < presses; i++) {
      windows.postMessageToWindow(handle, WM_LBUTTONDOWN, MK_LBUTTON, lparam)
      windows.postMessageToWindow(handle, WM_LBUTTONUP, 0, lparam)
      if (i === 0 && presses === 2) await wait(keyHoldMs())
    }
    const window =
      size === null
        ? ''
        : ` in a ${size.width} x ${size.height}${size.dpiAware ? '' : ' DPI-unaware'} window`
    const where = point.scaled ? `(${point.x}, ${point.y}) for game (${x}, ${y})` : `(${x}, ${y})`
    log.info(
      'assist',
      `Clicked ${where}${window}${presses === 1 ? ' once' : ''}, handle ${handle}.`
    )
    return null
  }

  /**
   * Move the pointer to a client-area position and press the right button
   * there, once.
   *
   * One press and one release, never two: the double is the client's attack
   * gesture. The gap since the last right press is waited out here, before
   * the guard, so a caller that clicks again after a strand cannot make a
   * double however fast it asks; the guard then runs after the wait, so a
   * stop during it is honoured.
   */
  async function rightClick(
    target: ActionTarget,
    x: number,
    y: number
  ): Promise<ActionRefusal | null> {
    const due = lastRightClickMs + RIGHT_CLICK_GAP_MS
    if (now() < due) {
      log.info('assist', `Waiting ${due - now()} ms so the right press is not a double.`)
      await wait(due - now())
    }
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal
    const handle = target.windowHandle
    const size = windows.clientSize(handle)
    const point = toClientPoint(x, y, size)
    const lparam = mouseLparam(point.x, point.y)
    const sinceLast = now() - lastRightClickMs
    lastRightClickMs = now()
    windows.postMessageToWindow(handle, WM_MOUSEMOVE, 0, lparam)
    windows.postMessageToWindow(handle, WM_RBUTTONDOWN, MK_RBUTTON, lparam)
    windows.postMessageToWindow(handle, WM_RBUTTONUP, 0, lparam)
    const window =
      size === null
        ? ''
        : ` in a ${size.width} x ${size.height}${size.dpiAware ? '' : ' DPI-unaware'} window`
    const where = point.scaled ? `(${point.x}, ${point.y}) for game (${x}, ${y})` : `(${x}, ${y})`
    const gap = Number.isFinite(sinceLast) ? `, ${sinceLast} ms after the last` : ''
    log.info('assist', `Right-clicked ${where}${window}${gap}, handle ${handle}.`)
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

  async function typeText(target: ActionTarget, text: string): Promise<ActionRefusal | null> {
    const refusal = guard(target) ?? rateGate()
    if (refusal !== null) return refusal
    const session = armed.get(target.connectionId)
    const aborted = (): boolean => stopped || armed.get(target.connectionId) !== session
    const handle = target.windowHandle
    // No opening Enter: the field already has focus, and Enter is its submit.
    for (const character of text) {
      if (aborted()) return 'stopped'
      windows.postMessageToWindow(handle, WM_CHAR, character.codePointAt(0) ?? 0, 1)
      await wait(nextGap())
    }
    if (aborted()) return 'stopped'
    postKey(handle, VK_RETURN)
    log.info(
      'assist',
      `Typed ${text.length} character(s) into the focused control of window ${handle}.`
    )
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
    // Measure the window up front, so the log states the scale every posted
    // click will use before anything is driven. Each click measures again,
    // because the window can be resized mid-run.
    log.info('assist', `Armed a driver on window ${target.windowHandle}${describeWindow(target)}.`)
    return target
  }

  /** The window's size and the scale a game coordinate gets, for the log. */
  function describeWindow(target: ActionTarget): string {
    const size = windows.clientSize(target.windowHandle)
    if (size === null) return ''
    const scaleX = size.width / GAME_WIDTH
    const scaleY = size.height / GAME_HEIGHT
    const scale =
      size.width === GAME_WIDTH && size.height === GAME_HEIGHT
        ? 'game coordinates post as they are'
        : `game coordinates scale by ${scaleX.toFixed(2)} x ${scaleY.toFixed(2)}`
    return ` (${size.width} x ${size.height}${size.dpiAware ? '' : ', DPI-unaware'}; ${scale})`
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
    typeText,
    click,
    rightClick,
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
