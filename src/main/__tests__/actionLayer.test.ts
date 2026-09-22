import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClientSize, GameWindow, TcpConnection } from 'da-pcap'
import {
  createActionLayer,
  RIGHT_CLICK_GAP_MS,
  VK_ESCAPE,
  VK_RETURN,
  VK_W,
  type ActionLayer,
  type HotkeyRegistrar,
  type LiveConnection,
  type WindowApi
} from '../actionLayer'
import { connectionIdOf } from '../capture/source'

/**
 * The action layer with a fake window API. No game, no Electron. This is the
 * seam WP13 promises: a driver runs against this exactly as it runs against the
 * real window API.
 */

const CLIENT_A = { pid: 100, handle: 1000, local: 5000, name: 'Alice' }
const CLIENT_B = { pid: 200, handle: 2000, local: 5001, name: 'Bob' }
const SERVER = { address: '10.0.0.1', port: 2612 }
const LOCAL_ADDRESS = '192.168.1.10'

function connOf(localPort: number): TcpConnection {
  return {
    localAddress: LOCAL_ADDRESS,
    localPort,
    remoteAddress: SERVER.address,
    remotePort: SERVER.port,
    state: 5 // ESTABLISHED
  }
}

function idOf(localPort: number): string {
  return connectionIdOf(LOCAL_ADDRESS, localPort, SERVER.address, SERVER.port)
}

interface Posted {
  handle: number
  message: number
  wParam: number
  lParam: number
}

/** A fake window API over one or two game clients. */
function fakeWindows(
  clients: { pid: number; handle: number; local: number; title?: string }[],
  sizes = new Map<number, ClientSize>()
) {
  const live = new Set(clients.map((c) => c.handle))
  let foreground = 0
  const posted: Posted[] = []

  const api: WindowApi = {
    processIdsByName: () => clients.map((c) => c.pid),
    tcpConnectionsForPid: (pid) => {
      const client = clients.find((c) => c.pid === pid)
      return client ? [connOf(client.local)] : []
    },
    windowsForPid: (pid): GameWindow[] => {
      const client = clients.find((c) => c.pid === pid)
      return client && live.has(client.handle)
        ? [{ handle: client.handle, title: client.title ?? 'Dark Ages' }]
        : []
    },
    postMessageToWindow: (handle, message, wParam, lParam) => {
      posted.push({ handle, message, wParam, lParam })
      return true
    },
    setForegroundWindow: (handle) => {
      foreground = handle
      return true
    },
    foregroundWindow: () => foreground,
    isWindow: (handle) => live.has(handle),
    pointerIn: () => null,
    clientSize: (handle) => sizes.get(handle) ?? null
  }

  return {
    api,
    posted,
    closeWindow: (handle: number) => live.delete(handle),
    setForeground: (handle: number) => (foreground = handle)
  }
}

function fakeHotkeys(): HotkeyRegistrar & { fire: (accelerator?: string) => void } {
  const registered = new Map<string, () => void>()
  return {
    register: (accelerator, cb) => {
      registered.set(accelerator, cb)
      return true
    },
    unregisterAll: () => {
      registered.clear()
    },
    // With no accelerator, fire the single registered hotkey.
    fire: (accelerator?: string) => {
      if (accelerator !== undefined) {
        registered.get(accelerator)?.()
        return
      }
      ;[...registered.values()][0]?.()
    }
  }
}

function build(
  windows: ReturnType<typeof fakeWindows>,
  liveConnections: () => LiveConnection[],
  overrides: Partial<Parameters<typeof createActionLayer>[0]> = {}
): { layer: ActionLayer; log: { warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn> } } {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    recent: () => [],
    filePath: ''
  }
  const layer = createActionLayer({
    windows: windows.api,
    hotkeys: fakeHotkeys(),
    liveConnections,
    log,
    wait: async () => undefined,
    random: () => 0,
    ...overrides
  })
  return { layer, log }
}

describe('the action layer', () => {
  it('resolves a target for a known connection and null for an unknown one', () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    expect(layer.resolveTarget(idOf(CLIENT_A.local))).toEqual({
      connectionId: idOf(CLIENT_A.local),
      windowHandle: CLIENT_A.handle
    })
    expect(layer.resolveTarget(idOf(9999))).toBeNull()
  })

  it('lists one window for each client, with the character name', () => {
    const windows = fakeWindows([CLIENT_A, CLIENT_B])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const list = layer.listWindows()
    expect(list).toHaveLength(2)
    expect(list[0]).toMatchObject({ windowHandle: CLIENT_A.handle, characterName: 'Alice' })
    expect(list[1].characterName).toBeUndefined()
  })

  it('posts a key to the resolved window and returns null', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.pressKey(target, VK_RETURN)).toBeNull()
    expect(windows.posted.every((p) => p.handle === CLIENT_A.handle)).toBe(true)
    expect(windows.posted.length).toBeGreaterThan(0)
  })

  it('posts Escape as a real press does: down with its scan code, its character, then up', async () => {
    // A pane that reads characters never sees a posted key-down alone (live,
    // 2026-09-21: Escape as down and up left the exchange window open).
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.pressKey(target, VK_ESCAPE)).toBeNull()
    const down = (0x01 << 16) | 1
    expect(windows.posted.map((p) => [p.message, p.wParam, p.lParam])).toEqual([
      [0x0100, 0x1b, down],
      [0x0102, 0x1b, down],
      [0x0101, 0x1b, (down | 0xc0000000) >>> 0]
    ])
  })

  it('posts Enter without a character, as the chat input reads the key alone', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.pressKey(target, VK_RETURN)).toBeNull()
    expect(windows.posted.map((p) => p.message)).toEqual([0x0100, 0x0101])
  })

  it('clicks as a move then two down-up pairs at the client position', async () => {
    // DA Walker's world-map gesture. The pairs are posted back to back, with
    // no hold: the pane selects on the release, and a hold is a window for the
    // real mouse to move the pointer off the point first.
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.click(target, 307, 77)).toBeNull()
    const lparam = (77 << 16) | 307
    expect(windows.posted.map((p) => [p.message, p.wParam, p.lParam])).toEqual([
      [0x0200, 0, lparam],
      [0x0201, 1, lparam],
      [0x0202, 0, lparam],
      [0x0201, 1, lparam],
      [0x0202, 0, lparam]
    ])
  })

  it('clicks once when asked, so a list row is selected and not opened (WP36)', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.click(target, 290, 27, { once: true })).toBeNull()
    const lparam = (27 << 16) | 290
    expect(windows.posted.map((p) => [p.message, p.wParam, p.lParam])).toEqual([
      [0x0200, 0, lparam],
      [0x0201, 1, lparam],
      [0x0202, 0, lparam]
    ])
  })

  it('posts W with its character, as the board list key is a letter (WP36)', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.pressKey(target, VK_W)).toBeNull()
    expect(windows.posted.map((p) => [p.message, p.wParam])).toEqual([
      [0x0100, 0x57],
      [0x0102, 0x77],
      [0x0101, 0x57]
    ])
  })

  it('scales a click to a larger DPI-aware window', async () => {
    // A 150 % display: the window is 960 x 720 and stretches the game's
    // 640 x 480, so the game's (307, 77) is the window's (461, 116).
    const windows = fakeWindows(
      [CLIENT_A],
      new Map([[CLIENT_A.handle, { width: 960, height: 720, dpiAware: true }]])
    )
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.click(target, 307, 77)).toBeNull()
    expect(windows.posted[0].lParam).toBe((116 << 16) | 461)
  })

  it('scales a click to a window Windows is stretching, the same way', async () => {
    // A DPI-unaware window on the same display: Windows draws it at 960 x 720
    // and translates a posted coordinate from Midir's space to the window's,
    // so the physical position is the one to post (live check, 2026-09-21).
    const windows = fakeWindows(
      [CLIENT_A],
      new Map([[CLIENT_A.handle, { width: 960, height: 720, dpiAware: false }]])
    )
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.click(target, 307, 77)).toBeNull()
    expect(windows.posted[0].lParam).toBe((116 << 16) | 461)
  })

  it('states the window size and the scale when it arms', () => {
    const windows = fakeWindows(
      [CLIENT_A],
      new Map([[CLIENT_A.handle, { width: 960, height: 720, dpiAware: false }]])
    )
    const { layer, log } = build(windows, () => [
      { connectionId: idOf(CLIENT_A.local), name: 'Alice' }
    ])
    layer.arm(idOf(CLIENT_A.local))
    const armed = log.info.mock.calls.map((c) => String(c[1])).find((l) => l.startsWith('Armed'))
    expect(armed).toBe(
      `Armed a driver on window ${CLIENT_A.handle} (960 x 720, DPI-unaware; game coordinates scale by 1.50 x 1.50).`
    )
  })

  it('posts a click as it is to a 640 x 480 window', async () => {
    const windows = fakeWindows(
      [CLIENT_A],
      new Map([[CLIENT_A.handle, { width: 640, height: 480, dpiAware: false }]])
    )
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.click(target, 307, 77)).toBeNull()
    expect(windows.posted[0].lParam).toBe((77 << 16) | 307)
  })

  it('right-clicks as a move then one down-up pair, never two (WP35)', async () => {
    // One press and one release: the client makes a double of two right
    // presses close together, and on a creature that is pursue-and-attack.
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.rightClick(target, 340, 213)).toBeNull()
    const lparam = (213 << 16) | 340
    expect(windows.posted.map((p) => [p.message, p.wParam, p.lParam])).toEqual([
      [0x0200, 0, lparam],
      [0x0204, 2, lparam],
      [0x0205, 0, lparam]
    ])
  })

  it('waits out the double-click window before a second right press, whatever the caller asks', async () => {
    let clock = 10_000
    const waited: number[] = []
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(
      windows,
      () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      {
        now: () => clock,
        wait: async (ms: number) => {
          waited.push(ms)
          clock += ms
        },
        minActionGapMs: 0
      }
    )
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.rightClick(target, 340, 213)).toBeNull()
    const first = clock
    // The caller asks again at once, as the walker does after a strand.
    expect(await layer.rightClick(target, 340, 213)).toBeNull()
    expect(clock - first).toBeGreaterThanOrEqual(RIGHT_CLICK_GAP_MS)
    expect(waited).toEqual([RIGHT_CLICK_GAP_MS])
    // The client's own window is 1000 ms; the gap clears it with margin.
    expect(RIGHT_CLICK_GAP_MS).toBeGreaterThanOrEqual(1500)
    // Well after the gap, no wait at all.
    clock += 5000
    expect(await layer.rightClick(target, 340, 213)).toBeNull()
    expect(waited).toEqual([RIGHT_CLICK_GAP_MS])
    expect(windows.posted.filter((p) => p.message === 0x0204)).toHaveLength(3)
  })

  it('honours a stop that lands during the wait before a right press', async () => {
    let clock = 10_000
    const windows = fakeWindows([CLIENT_A])
    const built = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }], {
      now: () => clock,
      wait: async (ms: number) => {
        clock += ms
        built.layer.stopAll('test')
      },
      minActionGapMs: 0
    })
    const target = built.layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await built.layer.rightClick(target, 1, 1)).toBeNull()
    expect(await built.layer.rightClick(target, 1, 1)).toBe('stopped')
    expect(windows.posted.filter((p) => p.message === 0x0204)).toHaveLength(1)
  })

  it('refuses a click while stopped', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    layer.stopAll('test')
    expect(await layer.click(target, 1, 1)).toBe('stopped')
    expect(windows.posted).toHaveLength(0)
  })

  it('refuses and posts nothing while stopped', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    layer.stopAll('test')
    expect(layer.stopped).toBe(true)
    expect(await layer.pressKey(target, VK_RETURN)).toBe('stopped')
    expect(windows.posted).toHaveLength(0)
  })

  it('refuses when the window is gone', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    windows.closeWindow(CLIENT_A.handle)
    expect(await layer.pressKey(target, VK_RETURN)).toBe('noWindow')
  })

  it('refuses a connection with no live character (the credential guard)', async () => {
    const windows = fakeWindows([CLIENT_A])
    // The window resolves, but no character is decoded on it.
    const { layer } = build(windows, () => [])
    const target = { connectionId: idOf(CLIENT_A.local), windowHandle: CLIENT_A.handle }
    expect(await layer.pressKey(target, VK_RETURN)).toBe('blocked')
    expect(windows.posted).toHaveLength(0)
  })

  it('holds the rate limit under a driver that asks as fast as it can', async () => {
    let clock = 0
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(
      windows,
      () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      { now: () => clock, minActionGapMs: 40 }
    )
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.pressKey(target, VK_RETURN)).toBeNull()
    // A second press at the same instant is refused.
    expect(await layer.pressKey(target, VK_RETURN)).toBe('rateLimited')
    // After the gap it is allowed again.
    clock = 41
    expect(await layer.pressKey(target, VK_RETURN)).toBeNull()
  })

  it('types into the focused control with no opening Enter, then presses Enter', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.typeText(target, 'Pandsala')).toBeNull()
    const chars = windows.posted.filter((p) => p.message === 0x0102)
    expect(chars.map((p) => String.fromCodePoint(p.wParam)).join('')).toBe('Pandsala')
    // The very first post is a character, not an Enter: a dialog's field has
    // focus already, and an Enter would submit it empty.
    expect(windows.posted[0]!.message).toBe(0x0102)
    const last = windows.posted.slice(-2)
    expect(last.every((p) => p.wParam === VK_RETURN && p.message !== 0x0102)).toBe(true)
  })

  it('opens the input with Enter, types WM_CHAR per character, then sends with Enter', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    expect(await layer.typeLine(target, 'hi')).toBeNull()
    const chars = windows.posted.filter((p) => p.message === 0x0102)
    expect(chars.map((p) => p.wParam)).toEqual(['h'.codePointAt(0), 'i'.codePointAt(0)])
    // The first two posts are the Enter that opens the input, so the first line
    // is not lost to the game world.
    const first = windows.posted.slice(0, 2)
    expect(first.every((p) => p.wParam === VK_RETURN && p.message !== 0x0102)).toBe(true)
    // The last two posts are the Enter that sends the line.
    const last = windows.posted.slice(-2)
    expect(last.every((p) => p.wParam === VK_RETURN)).toBe(true)
  })

  it('splits a line over the character limit into hyphenated sends', async () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    // 60 characters — one over the 59 limit. The break keeps more than three
    // letters on the tail, so it is 56 + hyphen, then 4.
    const text = 'a'.repeat(60)
    expect(await layer.typeLine(target, text)).toBeNull()
    const typed = windows.posted
      .filter((p) => p.message === 0x0102)
      .map((p) => String.fromCodePoint(p.wParam))
      .join('')
    expect(typed).toBe(`${'a'.repeat(56)}-${'a'.repeat(4)}`)
    // Two sends means four Enter key-downs (open + send, twice).
    const enterDowns = windows.posted.filter((p) => p.wParam === VK_RETURN && p.message === 0x0100)
    expect(enterDowns).toHaveLength(4)
  })

  it('stops typing mid-line when the driver is disarmed', async () => {
    // A gate lets the test resume the type loop one character at a time.
    const pending: (() => void)[] = []
    const gate = {
      wait: (): Promise<void> => new Promise((resolve) => pending.push(resolve)),
      release: async (): Promise<void> => {
        pending.shift()?.()
        await Promise.resolve()
        await Promise.resolve()
      }
    }
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(
      windows,
      () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      {
        wait: gate.wait
      }
    )
    const id = idOf(CLIENT_A.local)
    layer.arm(id) // establishes the driver session typeLine watches
    const target = layer.resolveTarget(id)!
    const promise = layer.typeLine(target, 'abcdefgh')

    // Let the open Enter and three characters go.
    for (let i = 0; i < 4; i++) await gate.release()
    const before = windows.posted.filter((p) => p.message === 0x0102).length
    expect(before).toBeGreaterThan(0)

    // The per-window Stop disarms the driver. The line must not finish.
    layer.disarm(id)
    await gate.release()
    expect(await promise).toBe('stopped')
    const after = windows.posted.filter((p) => p.message === 0x0102).length
    expect(after).toBe(before)
  })

  it('never posts to the other client when two are open', async () => {
    const windows = fakeWindows([CLIENT_A, CLIENT_B])
    const { layer } = build(windows, () => [
      { connectionId: idOf(CLIENT_A.local), name: 'Alice' },
      { connectionId: idOf(CLIENT_B.local), name: 'Bob' }
    ])
    const target = layer.resolveTarget(idOf(CLIENT_A.local))!
    await layer.typeLine(target, 'x')
    expect(windows.posted.length).toBeGreaterThan(0)
    expect(windows.posted.some((p) => p.handle === CLIENT_B.handle)).toBe(false)
  })

  it('stopAll notifies armed drivers and emits the state once', () => {
    const windows = fakeWindows([CLIENT_A])
    const states: { stopped: boolean; reason?: string }[] = []
    const { layer } = build(
      windows,
      () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      { onState: (s) => states.push(s) }
    )
    const onStop = vi.fn()
    layer.arm(idOf(CLIENT_A.local), onStop)
    layer.stopAll('the game window closed')
    expect(onStop).toHaveBeenCalledWith('the game window closed')
    expect(layer.state()).toEqual({ stopped: true, reason: 'the game window closed' })
    expect(states.at(-1)).toEqual({ stopped: true, reason: 'the game window closed' })
  })

  it('arm clears a stop from a previous run', () => {
    const windows = fakeWindows([CLIENT_A])
    const { layer } = build(windows, () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }])
    layer.stopAll('test')
    expect(layer.stopped).toBe(true)
    const armed = layer.arm(idOf(CLIENT_A.local))
    expect(typeof armed).not.toBe('string')
    expect(layer.stopped).toBe(false)
  })

  it('the global hotkey stops everything', () => {
    const windows = fakeWindows([CLIENT_A])
    const hotkeys = fakeHotkeys()
    const layer = createActionLayer({
      windows: windows.api,
      hotkeys,
      liveConnections: () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), recent: () => [], filePath: '' },
      wait: async () => undefined
    })
    layer.register()
    expect(layer.stopped).toBe(false)
    hotkeys.fire()
    expect(layer.stopped).toBe(true)
  })

  it('clearStop lifts a stop so a driver can start again', () => {
    const windows = fakeWindows([CLIENT_A])
    const states: { stopped: boolean }[] = []
    const { layer } = build(
      windows,
      () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      {
        onState: (s) => states.push(s)
      }
    )
    layer.stopAll('test')
    expect(layer.stopped).toBe(true)
    layer.clearStop()
    expect(layer.stopped).toBe(false)
    expect(states.at(-1)).toEqual({ stopped: false })
  })

  it('the speaker toggle hotkey fires its callback', () => {
    const windows = fakeWindows([CLIENT_A])
    const hotkeys = fakeHotkeys()
    const onSpeakerToggle = vi.fn()
    const layer = createActionLayer({
      windows: windows.api,
      hotkeys,
      liveConnections: () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), recent: () => [], filePath: '' },
      wait: async () => undefined,
      stopHotkey: 'CommandOrControl+Alt+.',
      speakerToggleHotkey: 'CommandOrControl+Alt+;',
      onSpeakerToggle
    })
    layer.register()
    hotkeys.fire('CommandOrControl+Alt+;')
    expect(onSpeakerToggle).toHaveBeenCalledOnce()
    // The stop hotkey still stops, and does not toggle.
    hotkeys.fire('CommandOrControl+Alt+.')
    expect(layer.stopped).toBe(true)
  })

  describe('the watch', () => {
    beforeEach(() => vi.useFakeTimers())
    afterEach(() => vi.useRealTimers())

    it('stops a driver when its window disappears', () => {
      const windows = fakeWindows([CLIENT_A])
      const { layer } = build(windows, () => [
        { connectionId: idOf(CLIENT_A.local), name: 'Alice' }
      ])
      windows.setForeground(CLIENT_A.handle)
      const armed = layer.arm(idOf(CLIENT_A.local))
      expect(typeof armed).not.toBe('string')

      windows.closeWindow(CLIENT_A.handle)
      vi.advanceTimersByTime(600)
      expect(layer.stopped).toBe(true)
    })

    it('stops on focus loss only when the user asked for it', () => {
      const windows = fakeWindows([CLIENT_A])
      const { layer } = build(
        windows,
        () => [{ connectionId: idOf(CLIENT_A.local), name: 'Alice' }],
        { stopOnFocusLoss: true }
      )
      windows.setForeground(CLIENT_A.handle)
      layer.arm(idOf(CLIENT_A.local))
      // Seen focused once, then focus moves away.
      vi.advanceTimersByTime(600)
      windows.setForeground(9999)
      vi.advanceTimersByTime(600)
      expect(layer.stopped).toBe(true)
    })
  })
})
