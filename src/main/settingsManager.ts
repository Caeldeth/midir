import { join } from 'path'
import { promises as fs } from 'fs'
import { DEFAULT_SETTINGS, THEME_NAMES, type MidirSettings, type ThemeName } from '../shared/types'

function withDefaults(data: Partial<MidirSettings>): MidirSettings {
  return {
    theme: THEME_NAMES.includes(data.theme as ThemeName)
      ? (data.theme as ThemeName)
      : DEFAULT_SETTINGS.theme,
    captureDevice:
      typeof data.captureDevice === 'string' ? data.captureDevice : DEFAULT_SETTINGS.captureDevice,
    autoStartCapture:
      typeof data.autoStartCapture === 'boolean'
        ? data.autoStartCapture
        : DEFAULT_SETTINGS.autoStartCapture,
    recordSessions:
      typeof data.recordSessions === 'boolean'
        ? data.recordSessions
        : DEFAULT_SETTINGS.recordSessions
  }
}

async function tryReadJson(filePath: string): Promise<Partial<MidirSettings> | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    return parsed as Partial<MidirSettings>
  } catch {
    return null
  }
}

// Windows occasionally returns EPERM/EACCES on rename when AV scanners or
// file watchers briefly hold the destination open. Back off a few times
// before falling back to unlink+rename. Without this, atomic settings saves
// silently fail under common Windows configurations.
async function renameWithRetry(src: string, dest: string, retries = 3, delay = 50): Promise<void> {
  for (let i = 0; i < retries; i++) {
    try {
      await fs.rename(src, dest)
      return
    } catch (err) {
      const e = err as NodeJS.ErrnoException
      if (e.code !== 'EPERM' && e.code !== 'EACCES') throw err
      await new Promise((r) => setTimeout(r, delay * (i + 1)))
    }
  }
  try {
    await fs.unlink(dest)
  } catch {
    /* dest may not exist */
  }
  await fs.rename(src, dest)
}

export function createSettingsManager(userDataPath: string) {
  const primary = join(userDataPath, 'settings.json')
  const backup = join(userDataPath, 'settings.bak.json')
  const tmp = join(userDataPath, 'settings.tmp.json')

  async function load(): Promise<MidirSettings> {
    let data = await tryReadJson(primary)
    if (data) return withDefaults(data)

    console.warn('settings.json unreadable, trying backup')
    data = await tryReadJson(backup)
    if (data) {
      console.warn('Recovered settings from backup')
      await save(withDefaults(data))
      return withDefaults(data)
    }

    console.warn('No valid settings found, using defaults')
    return { ...DEFAULT_SETTINGS }
  }

  async function doSave(settings: MidirSettings): Promise<void> {
    const content = JSON.stringify(settings, null, 2)
    await fs.mkdir(userDataPath, { recursive: true })
    await fs.writeFile(tmp, content, 'utf-8')
    try {
      await fs.copyFile(primary, backup)
    } catch {
      /* primary may not exist yet */
    }
    await renameWithRetry(tmp, primary)
  }

  let saveQueue: Promise<void> = Promise.resolve()

  function save(settings: MidirSettings): Promise<void> {
    // Two-arg .then() so a failed save doesn't poison the queue. Under a
    // one-arg .then(async fn) pattern, a single rejection would short-circuit
    // every subsequent save through the rejected chain — every later save
    // would silently no-op forever. The two-arg form runs doSave on both
    // branches.
    const op = saveQueue.then(
      () => doSave(settings),
      () => doSave(settings)
    )
    op.catch((err) => console.error('[settings] save failed:', err))
    saveQueue = op.catch(() => {})
    return op
  }

  return { load, save }
}
