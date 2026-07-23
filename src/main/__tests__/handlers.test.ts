import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, type CaptureStatus } from '../../shared/types'
import type { CaptureService } from '../captureService'
import {
  captureStatus,
  getCharacter,
  listAvailability,
  listCharacters,
  loadSettings,
  removeCharacter,
  saveSettings,
  startCapture,
  stopCapture,
  type CaptureHandlerContext,
  type CharacterHandlerContext,
  type SettingsHandlerContext
} from '../handlers'
import { emptyCharacterFile, type CharacterFile } from '../store/characterStore'
import { emptyCharacter } from '../../shared/character'

function settingsContext(): SettingsHandlerContext & {
  settingsManager: { load: ReturnType<typeof vi.fn>; save: ReturnType<typeof vi.fn> }
} {
  return {
    settingsManager: {
      load: vi.fn(async () => ({ ...DEFAULT_SETTINGS })),
      save: vi.fn(async () => undefined)
    }
  }
}

const STOPPED: CaptureStatus = {
  running: false,
  state: 'stopped',
  connections: 0,
  decodedCount: 0,
  unreadableCount: 0,
  missedHandshake: false
}

function fakeService(status: CaptureStatus = STOPPED): CaptureService & {
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  flush: ReturnType<typeof vi.fn>
} {
  return {
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    status: () => status
  }
}

/** A character store backed by memory. */
function fakeStore(
  file: CharacterFile = emptyCharacterFile()
): CharacterHandlerContext['characterStore'] {
  let current = file
  return {
    load: async () => current,
    save: async (value) => {
      current = value
    },
    update: async (transform) => {
      current = transform(current)
    },
    current: () => current
  }
}

describe('settings handlers', () => {
  it('loads through the settings manager', async () => {
    const ctx = settingsContext()
    expect(await loadSettings(ctx)).toEqual(DEFAULT_SETTINGS)
    expect(ctx.settingsManager.load).toHaveBeenCalledOnce()
  })

  it('saves a valid payload', async () => {
    const ctx = settingsContext()
    const settings = { ...DEFAULT_SETTINGS, theme: 'grinneal', captureDevice: 'adapter' }
    await saveSettings(ctx, settings)
    expect(ctx.settingsManager.save).toHaveBeenCalledWith(settings)
  })

  it('rejects an unknown theme and saves nothing', async () => {
    const ctx = settingsContext()
    await expect(saveSettings(ctx, { ...DEFAULT_SETTINGS, theme: 'neon' })).rejects.toThrow(
      'Invalid settings payload'
    )
    expect(ctx.settingsManager.save).not.toHaveBeenCalled()
  })

  it('rejects a payload missing a field', async () => {
    const ctx = settingsContext()
    await expect(saveSettings(ctx, { theme: 'hybrasyl' })).rejects.toThrow(
      'Invalid settings payload'
    )
    expect(ctx.settingsManager.save).not.toHaveBeenCalled()
  })
})

describe('capture handlers', () => {
  function context(service = fakeService()): CaptureHandlerContext & {
    captureService: ReturnType<typeof fakeService>
  } {
    return {
      captureService: service,
      captureAvailability: () => ({ available: true, devices: [] })
    }
  }

  it('reports availability', () => {
    expect(listAvailability(context())).toEqual({ available: true, devices: [] })
  })

  it('starts on a named adapter and returns the new status', async () => {
    const ctx = context()
    expect(await startCapture(ctx, 'adapter-one')).toEqual(STOPPED)
    expect(ctx.captureService.start).toHaveBeenCalledWith('adapter-one')
  })

  it('refuses to start with no adapter, and says what to do', async () => {
    const ctx = context()
    await expect(startCapture(ctx, '')).rejects.toThrow('Choose a capture adapter first.')
    await expect(startCapture(ctx, 42)).rejects.toThrow()
    expect(ctx.captureService.start).not.toHaveBeenCalled()
  })

  it('stops and reports the status', async () => {
    const ctx = context()
    expect(await stopCapture(ctx)).toEqual(STOPPED)
    expect(ctx.captureService.stop).toHaveBeenCalledOnce()
  })

  it('reports the status', () => {
    expect(captureStatus(context())).toEqual(STOPPED)
  })
})

describe('character handlers', () => {
  const older = { ...emptyCharacter('Fintan', 1000), lastSeenMs: 1000 }
  const newer = { ...emptyCharacter('Sabrael', 2000), lastSeenMs: 5000 }
  const file: CharacterFile = {
    version: 1,
    characters: { Fintan: older, Sabrael: newer }
  }

  function context(): CharacterHandlerContext & { captureService: ReturnType<typeof fakeService> } {
    const service = fakeService()
    return { characterStore: fakeStore(structuredClone(file)), captureService: service }
  }

  it('lists characters with the most recently seen first', async () => {
    expect((await listCharacters(context())).map((c) => c.name)).toEqual(['Sabrael', 'Fintan'])
  })

  it('gets one character by name', async () => {
    expect((await getCharacter(context(), 'Fintan'))?.name).toBe('Fintan')
  })

  it('returns nothing for a name it does not hold', async () => {
    expect(await getCharacter(context(), 'Nobody')).toBeNull()
    expect(await getCharacter(context(), '')).toBeNull()
  })

  it('removes a character', async () => {
    const ctx = context()
    await removeCharacter(ctx, 'Fintan')
    expect((await listCharacters(ctx)).map((c) => c.name)).toEqual(['Sabrael'])
  })

  it('writes pending records before removing, so a delete is not undone', async () => {
    const ctx = context()
    await removeCharacter(ctx, 'Fintan')
    expect(ctx.captureService.flush).toHaveBeenCalledOnce()
  })

  it('rejects an empty name', async () => {
    await expect(removeCharacter(context(), '')).rejects.toThrow('Invalid character name')
  })
})
