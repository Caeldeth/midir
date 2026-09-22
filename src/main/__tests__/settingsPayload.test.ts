import { settingsSchema } from '../handlers/settings'
import { DEFAULT_SETTINGS } from '../../shared/types'
import { toSettings } from '../../shared/settings'
import { describe, expect, it } from 'vitest'

/**
 * The save payload carries every field the schema names, and nothing else.
 *
 * The store used to destructure the fields by name, which is silent data loss
 * the first time someone adds a field to the type and not to the list: the
 * new field saves as nothing and loads as its default. The payload is now
 * derived from `DEFAULT_SETTINGS`, and this test is the guard that fails
 * loudly if the schema and the defaults drift apart (HTOO-235).
 */
describe('the settings save payload', () => {
  const schemaKeys = Object.keys(settingsSchema.shape).sort()

  it('carries every schema field, with the optional one when it is set', () => {
    const payload = toSettings({ ...DEFAULT_SETTINGS, darkAgesPath: 'E:/Games/Dark Ages' })
    expect(Object.keys(payload).sort()).toEqual(schemaKeys)
    expect(settingsSchema.safeParse(payload).success).toBe(true)
  })

  it('leaves the optional field out when it is unset', () => {
    const payload = toSettings({ ...DEFAULT_SETTINGS })
    expect('darkAgesPath' in payload).toBe(false)
    expect(Object.keys(payload).sort()).toEqual(schemaKeys.filter((k) => k !== 'darkAgesPath'))
  })

  it('carries the value the store holds, not the default', () => {
    const payload = toSettings({ ...DEFAULT_SETTINGS, hideUnseenDays: 90, theme: 'chadul' })
    expect(payload.hideUnseenDays).toBe(90)
    expect(payload.theme).toBe('chadul')
  })

  it('drops store actions and anything else that is not a setting', () => {
    const state = { ...DEFAULT_SETTINGS, setTheme: () => undefined, stray: 1 }
    expect(Object.keys(toSettings(state))).not.toContain('setTheme')
    expect(Object.keys(toSettings(state))).not.toContain('stray')
  })
})
