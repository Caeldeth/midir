import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GameWindow, TcpConnection } from 'da-pcap'
import {
  createActionLayer,
  VK_RETURN,
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
function fakeWindows(clients: { pid: number; handle: number; local: number; title?: string }[]) {
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
    isWindow: (handle) => live.has(handle)
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
