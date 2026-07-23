import { promises as fs } from 'node:fs'
import { basename, join } from 'node:path'
import type { RecordingInfo } from '../shared/log'
import { assertInsideDir } from './paths'

/**
 * The session recordings on disk.
 *
 * A recording is written only when the user turns recording on, and nothing
 * used to remove one. A player who leaves the setting on fills the disk, so
 * Midir lists them, deletes them on request, and deletes the oldest when the
 * folder passes a limit.
 *
 * The file being written is never deleted. Removing it under the recorder
 * would leave the session that is running with nowhere to go.
 */

/** Matches the name `startRecordingIfWanted` builds. */
export const RECORDING_FILE_PATTERN = /^session-[\d]{4}-[\d]{2}-[\d]{2}T[\d-]+Z\.ndjson$/

/** One megabyte, so a cap in megabytes becomes a cap in bytes. */
export const BYTES_PER_MB = 1024 * 1024

/**
 * Read the start time out of a recording's name.
 *
 * The recorder builds the name from an ISO timestamp with `:` and `.` replaced
 * by `-`, so the inverse puts them back. The result is NaN for a name this
 * code does not recognise, and the caller falls back to the file's own time.
 */
export function startedAtFromName(name: string): number {
  const stamp = name.replace(/^session-/, '').replace(/\.ndjson$/, '')
  const iso = stamp.replace(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
    '$1T$2:$3:$4.$5Z'
  )
  return Date.parse(iso)
}

/**
 * Choose which recordings to delete so the folder fits in `capBytes`.
 *
 * Oldest first, and it stops as soon as the total fits. `keepName` is never
 * chosen, because that is the file capture is writing. A cap of zero means no
 * limit and chooses nothing.
 *
 * This is pure, so the policy is tested without a disk.
 */
export function selectForPrune(
  files: RecordingInfo[],
  capBytes: number,
  keepName?: string
): string[] {
  if (capBytes <= 0) return []

  let total = files.reduce((sum, file) => sum + file.sizeBytes, 0)
  if (total <= capBytes) return []

  const oldestFirst = [...files].sort((a, b) => a.startedAtMs - b.startedAtMs)
  const doomed: string[] = []
  for (const file of oldestFirst) {
    if (total <= capBytes) break
    if (file.name === keepName) continue
    doomed.push(file.name)
    total -= file.sizeBytes
  }
  return doomed
}

/** Every recording in `dir`, newest first. A missing folder is an empty list. */
export async function listRecordings(dir: string, activePath?: string): Promise<RecordingInfo[]> {
  const active = activePath === undefined ? undefined : basename(activePath)
  let names: string[]
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }

  const found: RecordingInfo[] = []
  for (const name of names.filter((candidate) => RECORDING_FILE_PATTERN.test(candidate))) {
    try {
      const stats = await fs.stat(join(dir, name))
      const fromName = startedAtFromName(name)
      found.push({
        name,
        sizeBytes: stats.size,
        startedAtMs: Number.isNaN(fromName) ? stats.mtimeMs : fromName,
        active: name === active
      })
    } catch {
      /* the file went away between readdir and stat — leave it out */
    }
  }
  return found.sort((a, b) => b.startedAtMs - a.startedAtMs)
}

/** Delete one recording. The file capture is writing is refused. */
export async function deleteRecording(
  dir: string,
  name: string,
  activePath?: string
): Promise<void> {
  if (!RECORDING_FILE_PATTERN.test(name)) throw new Error('Invalid recording name')
  const full = assertInsideDir(dir, name)
  if (activePath !== undefined && basename(activePath) === name) {
    throw new Error('That recording is being written now. Stop capture first.')
  }
  await fs.unlink(full)
}

/** Delete every recording except the one being written. Returns how many went. */
export async function deleteAllRecordings(dir: string, activePath?: string): Promise<number> {
  const files = await listRecordings(dir, activePath)
  let removed = 0
  for (const file of files) {
    if (file.active) continue
    try {
      await fs.unlink(assertInsideDir(dir, file.name))
      removed++
    } catch {
      /* one that will not go must not stop the rest */
    }
  }
  return removed
}

/**
 * Delete the oldest recordings until the folder fits in `capMb`.
 *
 * Called when a capture starts, with the new recording as `keepPath`. Returns
 * the names that went, so the caller can log them.
 */
export async function pruneRecordings(
  dir: string,
  capMb: number,
  keepPath?: string
): Promise<string[]> {
  if (capMb <= 0) return []
  const files = await listRecordings(dir, keepPath)
  const doomed = selectForPrune(
    files,
    capMb * BYTES_PER_MB,
    keepPath === undefined ? undefined : basename(keepPath)
  )
  const removed: string[] = []
  for (const name of doomed) {
    try {
      await fs.unlink(assertInsideDir(dir, name))
      removed.push(name)
    } catch {
      /* best effort — a file that will not go is not worth failing a capture */
    }
  }
  return removed
}
