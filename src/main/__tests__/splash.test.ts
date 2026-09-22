import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The splash is a BrowserWindow, so stand in a fake for the electron module.
const created: FakeWindow[] = []
/** When set, the next window's loadFile rejects (a missing/unreadable file). */
let failLoad = false

class FakeWindow {
  options: Record<string, unknown>
  destroyed = false
  visible = false
  loadedFile: string | null = null
  private handlers = new Map<string, () => void>()

  constructor(options: Record<string, unknown>) {
    this.options = options
    created.push(this)
  }

  loadFile(path: string): Promise<void> {
    this.loadedFile = path
    return failLoad ? Promise.reject(new Error('ENOENT')) : Promise.resolve()
  }
  once(event: string, handler: () => void): void {
    this.handlers.set(event, handler)
  }
  emit(event: string): void {
    this.handlers.get(event)?.()
  }
  show(): void {
    this.visible = true
  }
  isVisible(): boolean {
    return this.visible
  }
  destroy(): void {
    this.destroyed = true
    this.emit('closed')
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
}

vi.mock('electron', () => ({ BrowserWindow: FakeWindow }))

const { createSplashWindow } = await import('../splash')

beforeEach(() => {
  created.length = 0
  failLoad = false
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

/** The fake the controller was built over — `created` is push-ordered. */
const win = (): FakeWindow => created[created.length - 1]

describe('createSplashWindow', () => {
  it('creates a frameless, transparent, always-on-top window that starts hidden', () => {
    const splash = createSplashWindow()
    expect(win().options).toMatchObject({
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false
    })
    expect(win().isVisible()).toBe(false)
    expect(splash.isDestroyed()).toBe(false)
  })

  it('has a fully transparent native background', () => {
    // `transparent: true` alone leaves the NATIVE background at Electron's
    // default opaque white, and that is what the compositor paints for a frame
    // at either end of the window's life — a white rectangle behind the card's
    // rounded corners. The renderer's `background: transparent` cannot reach
    // it; only this option does (HTOO-456).
    createSplashWindow()
    expect(win().options).toMatchObject({ backgroundColor: '#00000000' })
  })

  it('loads the unpacked resources/splash.html', () => {
    createSplashWindow()
    // resources/** is asarUnpacked, so this path resolves in production too.
    expect(win().loadedFile).toMatch(/resources[\\/]splash\.html$/)
  })

  it('shows as soon as ready-to-show fires', () => {
    createSplashWindow()
    win().emit('ready-to-show')
    expect(win().isVisible()).toBe(true)
  })

  // Backstop 1. Transparent windows on Windows don't reliably emit
  // ready-to-show; without a fallback the splash would silently never appear.
  it('shows anyway if ready-to-show never fires', () => {
    createSplashWindow()
    expect(win().isVisible()).toBe(false)
    vi.advanceTimersByTime(150)
    expect(win().isVisible()).toBe(true)
  })

  it('does not double-show when the fallback and the event both fire', () => {
    createSplashWindow()
    const show = vi.spyOn(win(), 'show')
    win().emit('ready-to-show')
    vi.advanceTimersByTime(1000)
    expect(show).toHaveBeenCalledTimes(1)
  })

  // Backstop 2. It is alwaysOnTop + skipTaskbar: a boot that dies before the
  // reveal would otherwise strand a window the user can't focus, close or find.
  it('self-destructs if nothing ever tears it down', () => {
    const splash = createSplashWindow()
    vi.advanceTimersByTime(19000)
    expect(splash.isDestroyed()).toBe(false)
    vi.advanceTimersByTime(2000)
    expect(splash.isDestroyed()).toBe(true)
  })

  it('drops its timers once closed, so it is never destroyed twice', () => {
    const splash = createSplashWindow()
    splash.destroy()
    const destroy = vi.spyOn(win(), 'destroy')
    vi.advanceTimersByTime(60000)
    expect(destroy).not.toHaveBeenCalled()
  })

  it('survives a failed load without an unhandled rejection', async () => {
    // A missing or unreadable splash.html must not take the boot down with it.
    // Midir's splash reports the failure to the session log, never the console
    // (a packaged build has no console to read).
    const error = vi.fn()
    failLoad = true

    createSplashWindow({ error } as never)
    await vi.waitFor(() => expect(error).toHaveBeenCalled())

    // ...and the window still shows via the fallback rather than hanging hidden.
    vi.advanceTimersByTime(150)
    expect(win().isVisible()).toBe(true)
  })
})

// Backstop 4. A packaged boot can signal `app:ready` before the splash has
// painted. Destroying it there meant `show()` no-opped on a destroyed window
// and the user never saw a splash at all.
describe('dismiss', () => {
  it('still shows the splash when dismissed before it ever appeared', () => {
    const splash = createSplashWindow()
    expect(win().isVisible()).toBe(false)

    splash.dismiss()

    expect(win().isVisible()).toBe(true)
    expect(splash.isDestroyed()).toBe(false)
  })

  it('holds the splash for the minimum visible time, then hands off', () => {
    const splash = createSplashWindow()
    const done = vi.fn()

    splash.dismiss(done)
    expect(done).not.toHaveBeenCalled()

    vi.advanceTimersByTime(599)
    expect(splash.isDestroyed()).toBe(false)
    expect(done).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(splash.isDestroyed()).toBe(true)
    expect(done).toHaveBeenCalledTimes(1)
  })

  // A slow boot has already paid the floor, so the handoff must not add delay.
  it('tears down immediately once the floor has already passed', () => {
    const splash = createSplashWindow()
    const done = vi.fn()
    win().emit('ready-to-show')
    vi.advanceTimersByTime(5000)

    splash.dismiss(done)

    expect(splash.isDestroyed()).toBe(true)
    expect(done).toHaveBeenCalledTimes(1)
  })

  it('runs the callback immediately when already destroyed', () => {
    const splash = createSplashWindow()
    const done = vi.fn()
    splash.destroy()

    splash.dismiss(done)

    expect(done).toHaveBeenCalledTimes(1)
  })

  // Backstop 3 interacts with this: the main window's `closed` handler destroys
  // the splash, and a reveal waiting on the floor must not be stranded.
  it('releases a pending reveal if the window is destroyed underneath it', () => {
    const splash = createSplashWindow()
    const done = vi.fn()
    splash.dismiss(done)
    expect(done).not.toHaveBeenCalled()

    splash.destroy()

    expect(done).toHaveBeenCalledTimes(1)
  })

  it('never runs the reveal callback twice', () => {
    const splash = createSplashWindow()
    const done = vi.fn()
    splash.dismiss(done)
    vi.advanceTimersByTime(600)
    expect(done).toHaveBeenCalledTimes(1)

    splash.destroy()
    vi.advanceTimersByTime(60000)
    expect(done).toHaveBeenCalledTimes(1)
  })
})
