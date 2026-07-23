// The diagnostic log format. Pure types and one pure pair of functions, with no
// electron or node imports, so main, preload, and the renderer all use them.

/** How serious an entry is. */
export type LogLevel = 'info' | 'warn' | 'error'

export const LOG_LEVELS: LogLevel[] = ['info', 'warn', 'error']

/** One line of the log. */
export interface LogEntry {
  /** When it happened, in milliseconds since the epoch. */
  timeMs: number
  level: LogLevel
  /** The part of Midir that wrote it, for example `capture` or `settings`. */
  scope: string
  message: string
}

/** One log file on disk. */
export interface LogFileInfo {
  name: string
  sizeBytes: number
  modifiedMs: number
  /** True for the file this run is writing. */
  current: boolean
}

/** One session recording on disk. */
export interface RecordingInfo {
  name: string
  sizeBytes: number
  /** When the recording started. Read from the file name. */
  startedAtMs: number
  /** True while capture is writing to this file. It must not be deleted. */
  active: boolean
}

/**
 * Put a message on one physical line.
 *
 * A stack trace arrives with newlines in it. One entry must stay one line, or
 * `parseLogLine` has to join the pieces again and a broken file becomes
 * unreadable. The separator keeps the frames legible.
 */
export function flattenMessage(message: string): string {
  return message
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(' | ')
}

/** Render one entry as a log line. The newline is not included. */
export function formatLogLine(entry: LogEntry): string {
  const time = new Date(entry.timeMs).toISOString()
  return `${time} [${entry.level.toUpperCase()}] (${entry.scope}) ${flattenMessage(entry.message)}`
}

const LINE = /^(\S+) \[(INFO|WARN|ERROR)\] \(([^)]*)\) ?(.*)$/

/**
 * Read one log line back.
 *
 * The result is null for a line this version cannot read. A file cut short by
 * a crash must still show every line before the damage.
 */
export function parseLogLine(line: string): LogEntry | null {
  const match = LINE.exec(line.trimEnd())
  if (match === null) return null
  const timeMs = Date.parse(match[1])
  if (Number.isNaN(timeMs)) return null
  return {
    timeMs,
    level: match[2].toLowerCase() as LogLevel,
    scope: match[3],
    message: match[4]
  }
}
