import type { Direction } from '../protocol/cipher'
import type { ConnectionInfo, StreamChunk } from './source'

/**
 * The session recording format.
 *
 * A recording is newline-delimited JSON. The first line is a header; every
 * line after it is one event. The format is deliberately readable, because its
 * whole job is to make a session that happened once repeatable forever.
 *
 * A recording holds the plaintext of everything the game client exchanged with
 * the server, including the character name and the encryption keys for that
 * session. Treat a recording as private data.
 */

export const RECORDING_VERSION = 1

export interface RecordingHeader {
  kind: 'header'
  version: number
  /** When the recording started, in milliseconds since the epoch. */
  startedAtMs: number
  /** A free note, for example which client build produced it. */
  note?: string
}

export interface RecordingOpen extends ConnectionInfo {
  kind: 'open'
}

export interface RecordingChunk {
  kind: 'chunk'
  connectionId: string
  direction: Direction
  timestampMs: number
  gap: boolean
  /** The bytes, base64-encoded. */
  data: string
}

export interface RecordingClose {
  kind: 'close'
  id: string
  timestampMs: number
}

export type RecordingLine = RecordingHeader | RecordingOpen | RecordingChunk | RecordingClose

/** Encode one chunk as a recording line. */
export function encodeChunk(chunk: StreamChunk): RecordingChunk {
  return {
    kind: 'chunk',
    connectionId: chunk.connectionId,
    direction: chunk.direction,
    timestampMs: chunk.timestampMs,
    gap: chunk.gap,
    data: Buffer.from(chunk.bytes).toString('base64')
  }
}

/** Decode a recording line back into a chunk. */
export function decodeChunk(line: RecordingChunk): StreamChunk {
  return {
    connectionId: line.connectionId,
    direction: line.direction,
    timestampMs: line.timestampMs,
    gap: line.gap,
    bytes: new Uint8Array(Buffer.from(line.data, 'base64'))
  }
}

/** Serialise one line, newline included. */
export function serialiseLine(line: RecordingLine): string {
  return `${JSON.stringify(line)}\n`
}

/**
 * Parse a whole recording.
 *
 * A blank line is skipped. A line that is not valid JSON, or that carries a
 * kind this version does not know, is skipped too: a recording cut short by a
 * crash must still replay up to the point it reached.
 */
export function parseRecording(text: string): RecordingLine[] {
  const lines: RecordingLine[] = []
  for (const raw of text.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (isRecordingLine(parsed)) lines.push(parsed)
  }
  return lines
}

function isRecordingLine(value: unknown): value is RecordingLine {
  if (typeof value !== 'object' || value === null) return false
  const kind = (value as { kind?: unknown }).kind
  return kind === 'header' || kind === 'open' || kind === 'chunk' || kind === 'close'
}
