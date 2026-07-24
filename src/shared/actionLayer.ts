// The data types the action layer and the Speaker share across processes. No
// runtime imports, so this file is safe to pull from main, preload, and the
// renderer. The behavioural interface (with promises) is main-only and lives in
// src/main/actionLayer.ts.

/**
 * Why an action did not happen. Never thrown — returned. A driver reads the
 * reason and stops cleanly rather than crashing.
 *
 * - `stopped` — a stop is in force.
 * - `noWindow` — the bound window is gone.
 * - `wrongProcess` — the window no longer belongs to the expected process.
 * - `rateLimited` — the layer refused a key that came too fast.
 * - `blocked` — a credential dialog is up, so the layer types nothing.
 */
export type ActionRefusal = 'stopped' | 'noWindow' | 'wrongProcess' | 'rateLimited' | 'blocked'

/** The window a driver is bound to, resolved from a connection. */
export interface ActionTarget {
  /** The connection this driver is bound to, and so the character. */
  connectionId: string
  /** The game window, resolved from the connection's process id. */
  windowHandle: number
}

/**
 * One open game window the user can pick to drive.
 *
 * The picker lists these. A window with a live character shows the character
 * name; a window with no decoded character yet shows only the title.
 */
export interface AssistWindow {
  connectionId: string
  windowHandle: number
  /** The window title, for the user to tell two clients apart. */
  title: string
  /** The character on this connection, when one is decoded. */
  characterName?: string
}

/** Whether a stop is in force, and why. Pushed on every change. */
export interface AssistState {
  stopped: boolean
  /** The reason the last stop fired, ready to show to the user. */
  reason?: string
}

/** The Speaker's configuration for one run. */
export interface SpeakerConfig {
  /** Lines to send, in order. Empty means the Speaker cannot start. */
  lines: string[]
  /** The floor between lines, in milliseconds. */
  intervalMs: number
  /** Rotate the list forever. When false, the Speaker sends each line once and stops. */
  repeat: boolean
  /** The connection, and so the character, this Speaker is bound to. */
  connectionId: string
}

/** What one Speaker is doing now. Pushed on every change. */
export interface SpeakerState {
  connectionId: string
  running: boolean
  /** When the last line went, in milliseconds since the epoch. */
  lastSentAtMs?: number
  /** Why the Speaker stopped, when it stopped for a reason worth showing. */
  reason?: string
}

/** The shortest interval the Speaker accepts, in milliseconds. */
export const MIN_SPEAKER_INTERVAL_MS = 1000

/** Show an Electron accelerator in the plain form a user reads. */
export function formatHotkey(accelerator: string): string {
  if (accelerator === '') return 'none'
  return accelerator
    .replace(/CommandOrControl|CmdOrCtrl|Control/g, 'Ctrl')
    .replace(/Command/g, 'Cmd')
}

/** The most characters the client sends in one chat line. */
export const MAX_CHAT_CHARS = 59

/**
 * The fewest letters a hyphen may leave on either side. Fewer than this, and the
 * whole word moves to the next line instead of being broken.
 */
export const MIN_HYPHEN_FRAGMENT = 4

/**
 * Break one line into pieces the client can send.
 *
 * The client sends at most `MAX_CHAT_CHARS` characters in one line, so a longer
 * line is broken into pieces and each piece is one send. The break prefers a
 * space, so a word is kept whole and a space is never hyphenated. A word is
 * hyphenated only when it does not fit whole and both fragments keep more than
 * three letters; otherwise the whole word moves to the next piece. A single word
 * longer than a whole line must be hyphenated, and the break still keeps the
 * tail above the minimum.
 */
export function wrapChatLine(text: string): string[] {
  if (text.length <= MAX_CHAT_CHARS) return [text]

  const pieces: string[] = []
  let line = ''

  const flush = (): void => {
    if (line.length > 0) {
      pieces.push(line)
      line = ''
    }
  }

  // Runs of spaces collapse to one, so a break never leaves a space beside a
  // hyphen or at the end of a piece.
  const words = text.split(/ +/).filter((word) => word.length > 0)

  for (const original of words) {
    let word = original
    while (word.length > 0) {
      // The free characters left on the current line, after the space that
      // would join this word.
      const used = line.length + (line.length > 0 ? 1 : 0)
      const room = MAX_CHAT_CHARS - used

      if (word.length <= room) {
        line = line.length > 0 ? `${line} ${word}` : word
        break
      }

      // The word does not fit whole. Try to hyphenate it into the room left,
      // but only when both fragments stay above the minimum.
      const before = room - 1 // one character is the hyphen
      const after = word.length - before
      if (before >= MIN_HYPHEN_FRAGMENT && after >= MIN_HYPHEN_FRAGMENT) {
        const head = word.slice(0, before)
        line = line.length > 0 ? `${line} ${head}-` : `${head}-`
        flush()
        word = word.slice(before)
        continue
      }

      // Hyphenation here would leave too small a fragment. Move the whole word
      // to a fresh line and try again.
      if (line.length > 0) {
        flush()
        continue
      }

      // A fresh line, and the word alone is longer than a whole line: it must be
      // hyphenated. Break as late as possible, but keep the tail above the
      // minimum so the next piece is not a tiny orphan.
      let headLength = MAX_CHAT_CHARS - 1
      if (word.length - headLength < MIN_HYPHEN_FRAGMENT) {
        headLength = word.length - MIN_HYPHEN_FRAGMENT
      }
      line = `${word.slice(0, headLength)}-`
      flush()
      word = word.slice(headLength)
    }
  }
  flush()
  return pieces
}
