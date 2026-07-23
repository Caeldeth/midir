import { describe, it, expect, vi } from 'vitest'
import { loadSettings, saveSettings, type HandlerContext } from '../handlers'
import { DEFAULT_SETTINGS } from '../../shared/types'

function makeCtx(): HandlerContext {
  return {
    settingsPath: '/fake/settings',
    settingsManager: {
      load: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
      save: vi.fn(async () => undefined)
    },
    appGetVersion: () => '0.0.0-test'
  }
}

describe('handlers', () => {
  it('loadSettings delegates to the settings manager', async () => {
    const ctx = makeCtx()
    expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS)
    expect(ctx.settingsManager.load).toHaveBeenCalledOnce()
  })

  it('saveSettings persists a valid payload', async () => {
    const ctx = makeCtx()
    await saveSettings(ctx, { theme: 'grinneal' })
    expect(ctx.settingsManager.save).toHaveBeenCalledWith({ theme: 'grinneal' })
  })

  it('saveSettings rejects an invalid payload without persisting', async () => {
    const ctx = makeCtx()
    await expect(saveSettings(ctx, { theme: 'neon' })).rejects.toThrow('Invalid settings payload')
    expect(ctx.settingsManager.save).not.toHaveBeenCalled()
  })
})
