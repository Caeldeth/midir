import { readFile } from 'node:fs/promises'
import {
  decodeChunk,
  parseRecording,
  type RecordingChunk,
  type RecordingClose,
  type RecordingLine,
  type RecordingOpen
} from './recording'
import type { CaptureSink, ConnectionInfo, PacketSource } from './source'

/**
 * Replay a recorded session.
 *
 * This is the source everything above the capture layer is tested against. It
 * needs no adapter, no driver, and no game, so a session that happened once
 * can drive the decoder, the reducer, and the user interface forever.
 */

export interface ReplayOptions {
  /**
   * Replay at the pace the session actually ran, using the recorded
   * timestamps. The default is false, which delivers everything at once.
   */
  realTime?: boolean
  /** Cap on the wait between two events in real-time mode, in milliseconds. */
  maxDelayMs?: number
}

const DEFAULT_MAX_DELAY_MS = 2000

/** Replay a recording that is already in memory. */
export function createReplaySource(
  lines: RecordingLine[],
  options: ReplayOptions = {}
): PacketSource {
  let stopped = false
  let timer: NodeJS.Timeout | undefined

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => {
      timer = setTimeout(resolve, ms)
    })

  return {
    async start(sink: CaptureSink): Promise<void> {
      stopped = false
      const open = new Map<string, ConnectionInfo>()
      let previousTimestamp: number | undefined

      for (const line of lines) {
        if (stopped) return

        if (options.realTime === true) {
          const timestamp = timestampOf(line)
          if (timestamp !== undefined && previousTimestamp !== undefined) {
            const delay = Math.min(
              Math.max(0, timestamp - previousTimestamp),
              options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS
            )
            if (delay > 0) await wait(delay)
            if (stopped) return
          }
          if (timestamp !== undefined) previousTimestamp = timestamp
        }

        switch (line.kind) {
          case 'open': {
            const info = connectionOf(line)
            open.set(info.id, info)
            sink.onOpen?.(info)
            break
          }
          case 'chunk':
            sink.onChunk?.(decodeChunk(line as RecordingChunk))
            break
          case 'close': {
            const info = open.get((line as RecordingClose).id)
            if (info !== undefined) {
              open.delete(info.id)
              sink.onClose?.(info)
            }
            break
          }
          default:
            break // the header carries no event
        }
      }
    },

    async stop(): Promise<void> {
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }
}

/** Read a recording from disk and replay it. */
export async function createReplaySourceFromFile(
  path: string,
  options: ReplayOptions = {}
): Promise<PacketSource> {
  return createReplaySource(parseRecording(await readFile(path, 'utf8')), options)
}

function connectionOf(line: RecordingOpen): ConnectionInfo {
  return {
    id: line.id,
    localAddress: line.localAddress,
    localPort: line.localPort,
    remoteAddress: line.remoteAddress,
    remotePort: line.remotePort,
    openedAtMs: line.openedAtMs
  }
}

function timestampOf(line: RecordingLine): number | undefined {
  switch (line.kind) {
    case 'header':
      return line.startedAtMs
    case 'open':
      return line.openedAtMs
    default:
      return line.timestampMs
  }
}
