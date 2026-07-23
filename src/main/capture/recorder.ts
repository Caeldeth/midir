import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { encodeChunk, RECORDING_VERSION, serialiseLine, type RecordingLine } from './recording'
import { createSecretScrubber, type StreamScrubber } from './scrub'
import type { CaptureSink, ConnectionInfo, StreamChunk } from './source'

/**
 * Write a session to disk so it can be replayed later.
 *
 * This is how a packet whose shape is not documented yet gets pinned. Record
 * the session that produced it, then work against the recording until the
 * decoder is right.
 *
 * A recording holds everything the client and the server exchanged, including
 * the character name and that session's encryption keys. It is private data,
 * and recording is off unless the user turns it on.
 *
 * Some things are left out on purpose. Three client packets carry an account
 * password, so every recorder removes them before it writes. See scrub.ts.
 * Nothing else is changed.
 */

export interface Recorder extends CaptureSink {
  /** The file being written. */
  readonly path: string
  /** How many lines have been written. */
  readonly lineCount: number
  /** Flush and close the file. */
  close(): Promise<void>
}

export interface RecorderOptions {
  /** A free note stored in the header, for example the client build. */
  note?: string
  /** The recording's start time. Pass it in so the caller controls the clock. */
  startedAtMs: number
  /** The clock, for the close timestamps. Injected by tests. */
  now?: () => number
}

/** Start recording to `path`. Parent directories are created as needed. */
export async function createRecorder(path: string, options: RecorderOptions): Promise<Recorder> {
  await mkdir(dirname(path), { recursive: true })
  const file: WriteStream = createWriteStream(path, { encoding: 'utf8', flags: 'w' })
  const now = options.now ?? Date.now
  let lines = 0

  /** One scrubber for each connection's client-to-server stream. */
  const scrubbers = new Map<string, StreamScrubber>()

  function write(line: RecordingLine): void {
    file.write(serialiseLine(line))
    lines++
  }

  /** Return the chunk to write. The client direction loses its secrets. */
  function scrubbed(chunk: StreamChunk): StreamChunk {
    if (chunk.direction !== 'clientToServer') return chunk
    let scrubber = scrubbers.get(chunk.connectionId)
    if (scrubber === undefined) {
      scrubber = createSecretScrubber()
      scrubbers.set(chunk.connectionId, scrubber)
    }
    // A gap invalidates the byte counts the walk is holding.
    if (chunk.gap) scrubber.reset()
    return { ...chunk, bytes: scrubber.push(chunk.bytes) }
  }

  write({
    kind: 'header',
    version: RECORDING_VERSION,
    startedAtMs: options.startedAtMs,
    ...(options.note !== undefined ? { note: options.note } : {})
  })

  return {
    path,

    get lineCount(): number {
      return lines
    },

    onOpen(connection: ConnectionInfo): void {
      write({ kind: 'open', ...connection })
    },

    onChunk(chunk: StreamChunk): void {
      write(encodeChunk(scrubbed(chunk)))
    },

    onClose(connection: ConnectionInfo): void {
      scrubbers.delete(connection.id)
      write({ kind: 'close', id: connection.id, timestampMs: now() })
    },

    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        file.end((error?: Error | null) => (error ? reject(error) : resolve()))
      })
    }
  }
}

/** Send every event to several sinks. Use this to record while decoding. */
export function teeSink(...sinks: CaptureSink[]): CaptureSink {
  return {
    onOpen(connection) {
      for (const sink of sinks) sink.onOpen?.(connection)
    },
    onChunk(chunk) {
      for (const sink of sinks) sink.onChunk?.(chunk)
    },
    onClose(connection) {
      for (const sink of sinks) sink.onClose?.(connection)
    },
    onError(error) {
      for (const sink of sinks) sink.onError?.(error)
    }
  }
}
