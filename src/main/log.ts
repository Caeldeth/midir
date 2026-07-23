import { appendFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { flattenMessage, formatLogLine, type LogEntry, type LogLevel } from '../shared/log'

/**
 * The diagnostic log.
 *
 * Midir writes one file for each launch. A packaged build has no console, so
 * without this file a user cannot say why something failed. Every message that
 * used to go to `console` goes here instead.
 *
 * The file name sorts chronologically, so rotation is a sort and a slice.
 *
 * Every write is best effort. A logging failure must never stop a capture the
 * user asked for.
 */

/** How many launches to keep. */
export const DEFAULT_KEEP = 10

/** How many entries to hold in memory for the view and for a bug report. */
export const DEFAULT_RING_MAX = 500

export interface Logger {
  info(scope: string, message: string): void
  warn(scope: string, message: string): void
  error(scope: string, message: string): void
  /** The file this launch writes. Empty when no file could be opened. */
  readonly filePath: string
  /** The most recent entries, oldest first. */
  recent(): LogEntry[]
}

export interface LoggerOptions {
  /** The clock. Injected by tests. */
  now?: () => number
  /** How many files to keep, this one included. */
  keep?: number
  /** How many entries to hold in memory. */
  ringMax?: number
  /** Called for each entry, so main can push it to the renderer. */
  onEntry?: (entry: LogEntry) => void
}

/**
 * A file name that sorts chronologically: `session-YYYYMMDD-HHmmss-SSS.log`.
 * Rotation depends on that, because it keeps the last names in a plain sort.
 */
export function logFileName(timeMs: number): string {
  const iso = new Date(timeMs).toISOString() // 2026-07-23T16:42:15.123Z
  const date = iso.slice(0, 10).replace(/-/g, '')
  const time = iso.slice(11, 19).replace(/:/g, '')
  const ms = iso.slice(20, 23)
  return `session-${date}-${time}-${ms}.log`
}

/** Matches a name `logFileName` produced. Used by rotation and by the handlers. */
export const LOG_FILE_PATTERN = /^session-\d{8}-\d{6}-\d{3}\.log$/

/** Keep the newest `keep` files and delete the rest. Best effort. */
function rotate(dir: string, keep: number): void {
  try {
    const names = readdirSync(dir)
      .filter((name) => LOG_FILE_PATTERN.test(name))
      .sort() // oldest first
    for (const name of names.slice(0, Math.max(0, names.length - keep))) {
      try {
        unlinkSync(join(dir, name))
      } catch {
        /* another process may hold it — leave it for the next launch */
      }
    }
  } catch {
    /* the directory may not be readable — rotation is not worth failing for */
  }
}

// The console mirror is useful under `npm run dev` and noise under vitest.
const UNDER_TEST = process.env.VITEST === 'true' || process.env.NODE_ENV === 'test'

/**
 * Open the log for this launch in `dir`, and delete the oldest files past the
 * limit. A directory that cannot be created leaves the logger working with no
 * file: the ring buffer still fills, so the view still has something to show.
 */
export function createLogger(dir: string, options: LoggerOptions = {}): Logger {
  const now = options.now ?? Date.now
  const keep = options.keep ?? DEFAULT_KEEP
  const ringMax = options.ringMax ?? DEFAULT_RING_MAX

  let path = ''
  try {
    mkdirSync(dir, { recursive: true })
    path = join(dir, logFileName(now()))
    // Create the file even when the launch logs nothing, so it counts as a
    // launch for rotation and the view can show it.
    appendFileSync(path, '')
    rotate(dir, keep)
  } catch {
    path = ''
  }

  const ring: LogEntry[] = []

  function emit(level: LogLevel, scope: string, message: string): void {
    // Flatten here, not only in the line, so what the view shows and what the
    // file holds are the same text.
    const entry: LogEntry = { timeMs: now(), level, scope, message: flattenMessage(message) }
    const line = formatLogLine(entry)

    ring.push(entry)
    if (ring.length > ringMax) ring.shift()

    if (!UNDER_TEST) {
      const mirror =
        level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
      mirror(line)
    }

    if (path !== '') {
      try {
        appendFileSync(path, `${line}\n`)
      } catch {
        /* a transient file error must never break the caller */
      }
    }

    options.onEntry?.(entry)
  }

  return {
    get filePath(): string {
      return path
    },
    recent: () => [...ring],
    info: (scope, message) => emit('info', scope, message),
    warn: (scope, message) => emit('warn', scope, message),
    error: (scope, message) => emit('error', scope, message)
  }
}

/** Turn anything thrown into a message worth logging. */
export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message
  return String(error)
}
