import { describe, it, expect } from 'vitest'
import { simplifyPlatform } from '../osName'

describe('simplifyPlatform', () => {
  it('maps the three platforms Balor ships for', () => {
    expect(simplifyPlatform('win32')).toBe('windows')
    expect(simplifyPlatform('darwin')).toBe('macOS')
    expect(simplifyPlatform('linux')).toBe('linux')
  })

  it('maps anything else to other rather than passing it through', () => {
    // Passing the raw value through would put `freebsd`, or whatever Node invents
    // next, straight into a report — and the point of this function is that only a
    // coarse family ever reaches one.
    expect(simplifyPlatform('freebsd')).toBe('other')
    expect(simplifyPlatform('')).toBe('other')
    expect(simplifyPlatform(undefined)).toBe('other')
  })
})
