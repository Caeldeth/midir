import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { shouldDisableHardwareAcceleration, REMOTE_SESSION_CSS } from '../remoteSession'

/**
 * HTOO-325. The predicate takes its platform and its environment as arguments, so
 * every case here is a plain call — no `process.env` mutation, no electron, and no
 * machine-dependent skip.
 *
 * **The negatives are the load-bearing half.** The card's own verification section
 * says a local-only test proves nothing, because the local path must stay
 * unchanged; that is exactly what a test CAN prove, and what a run on an RDP
 * session cannot.
 */
describe('shouldDisableHardwareAcceleration', () => {
  it('is false on a local Windows console session', () => {
    // The whole of the local half. A regression here is a slower app on every
    // Windows desktop, with no error and nothing on screen to explain it.
    expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'Console' })).toBe(false)
  })

  it('is true in a Windows Remote Desktop session', () => {
    expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'RDP-Tcp#42' })).toBe(true)
  })

  it('treats an unset SESSIONNAME as local', () => {
    // Absent in some service and scheduled-task launch contexts. Unset is not
    // evidence of a remote session, and the safe default is to change nothing.
    expect(shouldDisableHardwareAcceleration('win32', {})).toBe(false)
    expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: '' })).toBe(false)
  })

  it('case-folds the console comparison', () => {
    // A strict compare fails in the bad direction: a differently-spelled `console`
    // would drop a LOCAL session to software rendering.
    expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'console' })).toBe(false)
    expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'CONSOLE' })).toBe(false)
  })

  it('never fires off Windows from detection alone', () => {
    // `SESSIONNAME` is a Windows variable and means nothing elsewhere. A version
    // that "helpfully" generalised the check would change another platform's
    // rendering on the strength of a variable that means nothing there.
    expect(shouldDisableHardwareAcceleration('linux', { SESSIONNAME: 'RDP-Tcp#1' })).toBe(false)
    expect(shouldDisableHardwareAcceleration('darwin', { SESSIONNAME: 'RDP-Tcp#1' })).toBe(false)
    expect(shouldDisableHardwareAcceleration('linux', {})).toBe(false)
  })

  describe('a live OS answer, when an app has a native module to ask', () => {
    // The reconnect gap. `SESSIONNAME` is written at logon and never revised, so
    // a console session that Windows later RECONNECTS over RDP keeps reporting
    // `Console`. A live `GetSystemMetrics(SM_REMOTESESSION)` answer outranks it.
    it('outranks a stale SESSIONNAME in both directions', () => {
      expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'Console' }, true)).toBe(
        true
      )
      expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'RDP-Tcp#42' }, false)).toBe(
        false
      )
    })

    it('is the template default to NOT supply — null falls through to the variable', () => {
      // Pinned so that "nothing supplies it" reads as a decision rather than an
      // omission: the template carries no native module, and a `.node` load on
      // the pre-`ready` boot path is a new way to fail to start, for one integer.
      expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'RDP-Tcp#42' }, null)).toBe(
        true
      )
      expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'Console' }, null)).toBe(
        false
      )
    })

    it('still yields to the override', () => {
      expect(
        shouldDisableHardwareAcceleration(
          'win32',
          { SESSIONNAME: 'Console', MIDIR_DISABLE_GPU: '0' },
          true
        )
      ).toBe(false)
    })
  })

  describe('the MIDIR_DISABLE_GPU escape hatch', () => {
    it('forces software rendering anywhere, which is how the remote path is exercised', () => {
      expect(shouldDisableHardwareAcceleration('linux', { MIDIR_DISABLE_GPU: '1' })).toBe(true)
      expect(shouldDisableHardwareAcceleration('darwin', { MIDIR_DISABLE_GPU: 'yes' })).toBe(true)
    })

    it('forces hardware rendering back on inside a real remote session', () => {
      // The direction that matters in the field. There is deliberately no setting,
      // so this is a user's only recourse if the detection is ever wrong for them.
      expect(
        shouldDisableHardwareAcceleration('win32', {
          SESSIONNAME: 'RDP-Tcp#42',
          MIDIR_DISABLE_GPU: '0'
        })
      ).toBe(false)
    })

    it('treats an empty value as unset and falls through to detection', () => {
      // An unrecognised value must not fall silently through — that would read as an
      // override that did nothing. Empty is the one spelling that means "not set".
      expect(
        shouldDisableHardwareAcceleration('win32', {
          SESSIONNAME: 'RDP-Tcp#42',
          MIDIR_DISABLE_GPU: ''
        })
      ).toBe(true)
      expect(
        shouldDisableHardwareAcceleration('win32', {
          SESSIONNAME: 'Console',
          MIDIR_DISABLE_GPU: ''
        })
      ).toBe(false)
    })
  })

  it('reads its arguments and not the ambient process', () => {
    // The property that makes every case above meaningful. A version that reached
    // for `process.env` directly would pass all of them on a developer's machine and
    // answer a different question on a runner.
    const before = process.env.SESSIONNAME
    try {
      process.env.SESSIONNAME = 'RDP-Tcp#99'
      expect(shouldDisableHardwareAcceleration('win32', { SESSIONNAME: 'Console' })).toBe(false)
    } finally {
      if (before === undefined) delete process.env.SESSIONNAME
      else process.env.SESSIONNAME = before
    }
  })
})

describe('REMOTE_SESSION_CSS — the half the first adopter shipped without (HTOO-327)', () => {
  it('removes the backdrop filter in both spellings', () => {
    // The unprefixed property is not enough on its own: Chromium still honours
    // `-webkit-backdrop-filter`, and a rule that overrides one of the two leaves
    // the blur in place on the surfaces that matter.
    expect(REMOTE_SESSION_CSS).toContain('backdrop-filter: none !important')
    expect(REMOTE_SESSION_CSS).toContain('-webkit-backdrop-filter: none !important')
  })

  it('overrides nothing but the filter', () => {
    // A runtime mitigation for one environment. Anything else in here is a design
    // change smuggled in behind a performance fix, and it would only apply to the
    // users least able to see what happened to their app. In particular NOT
    // `text-shadow`: the house themes' only one is a zero-blur keyline outline,
    // which is cheap and is what keeps the fantasy themes legible.
    const declarations = REMOTE_SESSION_CSS.match(/[\w-]+\s*:/g) ?? []
    expect(new Set(declarations.map((d) => d.replace(/\s*:$/, '')))).toEqual(
      new Set(['backdrop-filter', '-webkit-backdrop-filter'])
    )
  })

  it('is still needed — the themes really do carry the blur this removes', () => {
    // **The assumption the whole fix rests on, pinned to the themes themselves.**
    // If a later change drops `backdropFilter` from the theme set, this mitigation
    // becomes a no-op injected on every remote launch and nothing else in the
    // repository would say so. The house theme set is a common ancestor, not a
    // shared dependency — oghma's copies carry no blur and ship no CSS — so this
    // is measured here rather than assumed from the card.
    const dir = join(__dirname, '../../renderer/src/themes')
    const withBlur = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(join(dir, f), 'utf-8').includes('backdropFilter'))
    expect(withBlur.sort()).toEqual(['chadul.ts', 'danaan.ts', 'grinneal.ts', 'hybrasyl.ts'])
  })
})
