import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSettingsManager } from '../settingsManager'
import { DEFAULT_SETTINGS } from '../../shared/types'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'midir-settings-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('settingsManager', () => {
  it('returns defaults when no settings file exists', async () => {
    const mgr = createSettingsManager(dir)
    expect(await mgr.load()).toEqual(DEFAULT_SETTINGS)
  })

  it('round-trips a save and load', async () => {
    const mgr = createSettingsManager(dir)
    await mgr.save({ theme: 'danaan' })
    expect(await mgr.load()).toEqual({ theme: 'danaan' })
  })

  it('writes human-readable JSON to settings.json', async () => {
    const mgr = createSettingsManager(dir)
    await mgr.save({ theme: 'chadul' })
    const raw = await readFile(join(dir, 'settings.json'), 'utf-8')
    expect(JSON.parse(raw)).toEqual({ theme: 'chadul' })
  })

  it('rotates the previous file into settings.bak.json on save', async () => {
    const mgr = createSettingsManager(dir)
    await mgr.save({ theme: 'chadul' })
    await mgr.save({ theme: 'grinneal' })
    const bak = JSON.parse(await readFile(join(dir, 'settings.bak.json'), 'utf-8'))
    expect(bak).toEqual({ theme: 'chadul' })
  })

  it('recovers from a corrupt primary via the backup', async () => {
    const mgr = createSettingsManager(dir)
    await mgr.save({ theme: 'danaan' })
    await mgr.save({ theme: 'danaan' }) // ensure a backup exists
    await writeFile(join(dir, 'settings.json'), '{not json', 'utf-8')
    expect(await mgr.load()).toEqual({ theme: 'danaan' })
  })

  it('coerces an unknown theme back to the default', async () => {
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ theme: 'neon' }), 'utf-8')
    const mgr = createSettingsManager(dir)
    expect(await mgr.load()).toEqual({ theme: DEFAULT_SETTINGS.theme })
  })
})
