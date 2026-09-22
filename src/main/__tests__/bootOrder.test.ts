import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

// The module-scope boot sequence in src/main/index.ts, pinned by POSITION.
//
// Read as text rather than imported: index.ts pulls in the electron module at
// load, which only resolves inside an Electron runtime. And position is the
// property under test — every statement here is a call that fails SILENTLY
// when it lands on the wrong side of another one, so no unit test that stubs
// `app` can see the defect, and neither can the e2e suite. This file is the
// only evidence the order holds.
//
// Comments are stripped before anything is matched. The statements below sit
// under comment blocks that discuss the very names being searched for, so a
// match against the raw file would pass on a version with the comment and no
// code. Crude on purpose: a `//` inside a string literal would be treated as a
// comment. Nothing in index.ts has one, and the alternative is a parser.
const RAW = readFileSync(join(__dirname, '..', 'index.ts'), 'utf-8')
const MAIN = RAW.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

/** First index of `needle`, asserting it exists so a missing statement fails
 *  by name rather than as `-1 < x`. */
function at(needle: string | RegExp): number {
  const i = typeof needle === 'string' ? MAIN.indexOf(needle) : MAIN.search(needle)
  expect(i, `${String(needle)} not found in index.ts`).toBeGreaterThan(-1)
  return i
}

describe('single-instance lock (HTOO-351)', () => {
  it('requests the lock after setPath and before whenReady', () => {
    // Four positions, one order, and each gap is a distinct silent failure:
    //
    //   setPath  <  disableHardwareAcceleration  <  requestSingleInstanceLock  <  whenReady
    //
    // The lock is keyed on the userData directory. Requested before the
    // `setPath('userData', …)` override it keys on Electron's default path, and
    // two builds that disagree about where their data lives never see each
    // other. After `whenReady` there is nothing left to prevent. And the lock
    // comes after the GPU call because that one is a no-op past `ready` and
    // cannot move down, while the lock is indifferent — a losing instance exits
    // before it renders. HTOO-325 and HTOO-351 share this assertion on purpose:
    // separating them would let one be reordered past the other with each
    // card's own test still green.
    const setPath = at("app.setPath('userData'")
    const gpu = at('app.disableHardwareAcceleration()')
    const lock = at('requestSingleInstanceLock()')
    const ready = at('app.whenReady()')
    expect(setPath).toBeLessThan(gpu)
    expect(gpu).toBeLessThan(lock)
    expect(lock).toBeLessThan(ready)
  })

  it('exits the losing instance with app.exit, never app.quit', () => {
    // `quit()` is asynchronous: it schedules a teardown and returns, so the
    // losing process runs every module-scope statement below the guard first —
    // the roaming migration, the settings manager, handler registration — all
    // against THE OWNER'S files. `exit()` stops on the statement.
    const lock = at('requestSingleInstanceLock()')
    const ready = at('app.whenReady()')
    const guard = MAIN.slice(lock, ready)
    expect(guard).toMatch(/if \(!gotSingleInstanceLock\) app\.exit\(0\)/)
    expect(guard).not.toMatch(/app\.quit\(/)
  })

  it('takes the lock before any module-scope side effect', () => {
    // The two side effects that make `quit()` wrong, asserted by position. Both
    // anchors are STATEMENT forms: a bare `migrateSettingsFromRoaming` also
    // matches the function's own declaration, and `createSettingsManager`
    // matches its import at the top of the file, which is above the lock by
    // construction. Match where the work HAPPENS, not where the name appears.
    const lock = at('requestSingleInstanceLock()')
    expect(at(/^migrateSettingsFromRoaming\(\)/m)).toBeGreaterThan(lock)
    expect(at(/^const settingsManager = createSettingsManager\(/m)).toBeGreaterThan(lock)
    expect(at(/^registerHandlers\(/m)).toBeGreaterThan(lock)
  })

  it('surfaces the running window on a second launch', () => {
    // A lock with no `second-instance` listener is worse than no lock: the
    // second launch then does nothing visible at all, which a user reads as the
    // app being broken rather than as already running. Registered at module
    // scope, because the losing instance signals as soon as it fails the lock
    // — which can land before this instance has finished booting.
    const listener = at(/app\.on\(\s*'second-instance'\s*,\s*focusMainWindow\s*\)/)
    expect(listener).toBeLessThan(at('app.whenReady()'))
  })

  it('restores before it shows, so a minimised window comes forward', () => {
    // Without `restore()` first, a minimised window takes focus in the taskbar
    // and never comes forward — which reads as the second launch having done
    // nothing. And `show()` is needed at all because the window is built with
    // `show: false` and a second launch during boot would otherwise focus a
    // window that has never been shown.
    const restore = at('mainWindow.restore()')
    const show = at('mainWindow.show()')
    const focus = at('mainWindow.focus()')
    expect(restore).toBeLessThan(show)
    expect(show).toBeLessThan(focus)
  })
})

describe('remote-session rendering (HTOO-325)', () => {
  it('disables hardware acceleration before app.whenReady is reached', () => {
    // **The silent failure this fix is most likely to grow.** The electron call
    // is a no-op after the `ready` event — it does not throw and it does not
    // warn in a way anyone reads — so a later reordering of boot would leave a
    // module, a test file and a card all describing a fix that had stopped
    // happening. Nothing else in the repository can see this: the unit suite
    // does not boot the app, and the e2e suite cannot tell a software-rendered
    // window from a composited one.
    expect(at('app.disableHardwareAcceleration()')).toBeLessThan(at('app.whenReady()'))
  })

  it('decides once, from the process, and keeps the answer', () => {
    // One constant read at module scope, consumed by both the electron call and
    // the CSS injection below. Two calls that could disagree is a worse shape
    // than one constant, however unlikely the disagreement — and the predicate
    // must be handed `process.platform` and `process.env` rather than reaching
    // for them, or its tests answer a different question than the app does.
    expect(MAIN).toMatch(
      /const isRemoteSession = shouldDisableHardwareAcceleration\(process\.platform, process\.env\)/
    )
  })

  it('injects the CSS on dom-ready, and only when software rendering is in force', () => {
    // Two claims a reader of `remoteSession.ts` alone cannot check. `dom-ready`
    // fires before first paint — `did-finish-load` does not, and the difference
    // is a visible flash of the blurred style on every remote launch. And the
    // injection is gated on the DECISION, so a local session's rendering stays
    // exactly as it was and the override reproduces the whole condition.
    //
    // Anchored to the gate NEAREST the injection, not the first one in the
    // file: there is a second `if (isRemoteSession)` at module scope for the
    // electron call, so a plain first-match search would report the injection
    // as gated even if somebody deleted its own `if`.
    expect(MAIN).toContain("'dom-ready'")
    expect(MAIN).not.toContain("'did-finish-load'")
    const createWindowAt = at('function createWindow')
    const inject = at('insertCSS(REMOTE_SESSION_CSS)')
    expect(inject).toBeGreaterThan(createWindowAt)
    expect(MAIN.lastIndexOf('if (isRemoteSession)', inject)).toBeGreaterThan(createWindowAt)
  })
})
