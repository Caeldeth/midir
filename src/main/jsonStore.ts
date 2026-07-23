import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { delay } from './delay'

/**
 * One crash-safe JSON store.
 *
 * This is a house widget, ported from a sibling app. Do not redesign it.
 *
 * It writes to a temporary file and renames it over the primary, so a crash
 * during a write cannot leave a half-written file. It retries the rename,
 * because Windows anti-virus and indexer software hold files briefly. It keeps
 * an optional backup, and it can move a corrupt file aside instead of throwing
 * it away.
 *
 * The store heals on load: primary, then backup, then defaults. That is right
 * for availability, but it means a corrupt file looks to the user like the app
 * lost their data. `onFailure` is the breadcrumb that explains what happened.
 */

/** A load-side failure worth reporting. */
export interface JsonStoreFailure {
  /** The file that failed. */
  path: string
  /** `parse` means unreadable or rejected. `quarantine` means moved aside. */
  stage: 'parse' | 'quarantine'
  /** The cause: an error message, or where the file went. */
  message: string
}

export interface JsonStoreOptions<T> {
  path: string
  /** The value to use when nothing can be read. */
  fallback: () => T
  /** Check and coerce a parsed value. Return null to reject it. */
  normalize: (raw: unknown) => T | null
  /** Keep a `.bak.json` copy. Use this for data the user cannot recreate. */
  backup?: boolean
  /** Move a corrupt primary aside instead of discarding it. */
  quarantine?: boolean
  /** Serve `load` from memory after the first read. */
  cacheReads?: boolean
  /** Where to send a failure breadcrumb. Injected, so this file stays plain. */
  onFailure?: (failure: JsonStoreFailure) => void
}

export interface JsonStore<T> {
  load: () => Promise<T>
  save: (value: T) => Promise<void>
  /** Read, change, and write, with each change seeing the one before it. */
  update: (transform: (current: T) => T) => Promise<void>
  /** The value in memory now, without reading the file. */
  current: () => T
}

async function renameWithRetry(source: string, destination: string, retries = 4): Promise<void> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      await fs.rename(source, destination)
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EEXIST') throw error
      if (attempt === retries - 1) break
      await delay(50 * (attempt + 1))
    }
  }
  await fs.unlink(destination).catch(() => undefined)
  await fs.rename(source, destination)
}

export function createJsonStore<T>(options: JsonStoreOptions<T>): JsonStore<T> {
  const {
    path,
    fallback,
    normalize,
    backup = false,
    quarantine = false,
    cacheReads = false,
    onFailure
  } = options

  const report = (target: string, stage: JsonStoreFailure['stage'], message: string): void => {
    try {
      onFailure?.({ path: target, stage, message })
    } catch {
      // A failing breadcrumb must never break a load.
    }
  }

  const backupPath = path.replace(/\.json$/i, '.bak.json')
  const tempPath = path.replace(/\.json$/i, '.tmp.json')
  let current = fallback()
  let loaded = false
  let saveQueue: Promise<void> = Promise.resolve()
  let mutations: Promise<void> = Promise.resolve()

  async function readOne(target: string): Promise<{ exists: boolean; value: T | null }> {
    try {
      const value = normalize(JSON.parse(await fs.readFile(target, 'utf8')))
      // normalize returns null rather than throwing when the shape is wrong,
      // so a rejection arrives here as a successful read of nothing.
      if (!value) report(target, 'parse', 'contents rejected by the schema')
      return { exists: true, value }
    } catch (error) {
      const missing = (error as NodeJS.ErrnoException).code === 'ENOENT'
      if (!missing) report(target, 'parse', (error as Error)?.message ?? String(error))
      return { exists: !missing, value: null }
    }
  }

  async function write(value: T): Promise<void> {
    await fs.mkdir(dirname(path), { recursive: true })
    await fs.writeFile(tempPath, JSON.stringify(value, null, 2), 'utf8')
    if (backup) {
      try {
        await fs.copyFile(path, backupPath)
      } catch {
        // The primary may not exist yet.
      }
    }
    await renameWithRetry(tempPath, path)
    current = value
  }

  // The two-argument form of then keeps one failed save from poisoning the
  // queue. A one-argument then would route every later save through the first
  // rejection and drop them all.
  function save(value: T): Promise<void> {
    const operation = saveQueue.then(
      () => write(value),
      () => write(value)
    )
    saveQueue = operation.catch(() => undefined)
    return operation
  }

  async function load(): Promise<T> {
    if (cacheReads && loaded) return current

    const main = await readOne(path)
    if (main.value) {
      current = main.value
      loaded = true
      return current
    }

    if (backup) {
      const fromBackup = await readOne(backupPath)
      if (fromBackup.value) {
        current = fromBackup.value
        loaded = true
        await save(current)
        return current
      }
    }

    if (quarantine && main.exists) {
      const aside = path.replace(/\.json$/i, `.corrupt-${Date.now()}.json`)
      const moved = await fs
        .rename(path, aside)
        .then(() => true)
        .catch(() => false)
      // The user is about to see defaults where their data was. Say why, and
      // say where the original went, so the loss can be diagnosed.
      report(path, 'quarantine', moved ? `moved aside to ${aside}` : 'could not be moved aside')
    }

    current = fallback()
    loaded = true
    return current
  }

  // Read, change, and write in order, so two changes cannot overwrite one
  // another.
  function update(transform: (current: T) => T): Promise<void> {
    const operation = mutations.then(async () => {
      await saveQueue
      await save(transform(await load()))
    })
    mutations = operation.catch(() => undefined)
    return operation
  }

  return { load, save, update, current: () => current }
}
