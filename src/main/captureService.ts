import type { CharacterRecord } from '../shared/character'
import type { CaptureStatus } from '../shared/types'
import type { Recorder } from './capture/recorder'
import { teeSink } from './capture/recorder'
import type { CaptureSink, PacketSource } from './capture/source'
import { createSessionTracker, type TrackedEvent } from './capture/tracker'
import { isIdentified, newSession, reduce, type CharacterSession } from './model/character'
import { withCharacter, type CharacterStore } from './store/characterStore'

/**
 * The service that joins the parts: capture, decode, reduce, and save.
 *
 * It owns one reducer state for each connection, because each world connection
 * is one character's login. A record is saved once it has a name.
 *
 * The source is injected, so the whole service runs against a recorded session
 * with no adapter, no driver, and no game.
 */

export interface CaptureServiceOptions {
  store: CharacterStore
  /** Build the source for a device. Injected so a recording can stand in. */
  createSource: (device: string) => PacketSource
  /** Called whenever the status changes. */
  onStatus?: (status: CaptureStatus) => void
  /** Called whenever a character record changes. */
  onCharacter?: (record: CharacterRecord) => void
  /** The clock. Injected by tests. */
  now?: () => number
  /** How long to wait before writing a changed record to disk. */
  saveDebounceMs?: number
  /**
   * Start a recording for this capture, or return null to record nothing.
   *
   * A recording holds everything the client and server exchanged, including
   * the character name and that session's keys, so it is off unless the user
   * turns it on. It is the tool for pinning a packet whose shape is not known
   * yet, because it makes one live session repeatable forever.
   */
  createRecorder?: (startedAtMs: number) => Promise<Recorder | null>
}

/** How long to gather changes before writing. A login is a burst of packets. */
export const DEFAULT_SAVE_DEBOUNCE_MS = 1000

export interface CaptureService {
  start(device: string): Promise<void>
  stop(): Promise<void>
  status(): CaptureStatus
  /** Write every pending record now. */
  flush(): Promise<void>
}

export function createCaptureService(options: CaptureServiceOptions): CaptureService {
  const { store, createSource, onStatus, onCharacter } = options
  const now = options.now ?? Date.now
  const saveDebounceMs = options.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS

  /** One reducer state for each connection. */
  const sessions = new Map<string, CharacterSession>()
  /** Records changed but not yet written, by character name. */
  const unsaved = new Map<string, CharacterRecord>()

  let source: PacketSource | undefined
  let device: string | undefined
  let recorder: Recorder | null = null
  let saveTimer: NodeJS.Timeout | undefined
  let decodedCount = 0
  let unreadableCount = 0
  let missedHandshake = false
  let lastError: string | undefined
  let connectionCount = 0
  let currentCharacter: string | undefined

  function status(): CaptureStatus {
    return {
      running: source !== undefined,
      state:
        source === undefined
          ? 'stopped'
          : currentCharacter !== undefined
            ? 'decoding'
            : 'listening',
      connections: connectionCount,
      decodedCount,
      unreadableCount,
      missedHandshake,
      ...(device !== undefined ? { device } : {}),
      ...(currentCharacter !== undefined ? { characterName: currentCharacter } : {}),
      ...(recorder !== null ? { recordingPath: recorder.path } : {}),
      ...(lastError !== undefined ? { error: lastError } : {})
    }
  }

  function publishStatus(): void {
    onStatus?.(status())
  }

  function scheduleSave(): void {
    if (saveTimer !== undefined) return
    saveTimer = setTimeout(() => {
      saveTimer = undefined
      void flush()
    }, saveDebounceMs)
  }

  async function flush(): Promise<void> {
    if (unsaved.size === 0) return
    const pending = [...unsaved.values()]
    unsaved.clear()
    await store.update((file) => pending.reduce(withCharacter, file))
  }

  function handleEvent(tracked: TrackedEvent): void {
    if (tracked.event.type !== 'packet') {
      unreadableCount++
      // A session packet Midir cannot read means it never saw that
      // connection's keys. That is worth telling the user about, because the
      // fix is to start Midir before logging in.
      //
      // It is only worth telling them while nothing is being read. Capture
      // started during an earlier session leaves a few unreadable packets on
      // the connection that was already open; once the player logs in again
      // that connection is history and the warning would be a lie.
      if (tracked.event.reason === 'noSessionKey' && currentCharacter === undefined) {
        if (!missedHandshake) {
          missedHandshake = true
          publishStatus()
        }
      }
      return
    }

    decodedCount++
    const id = tracked.connection.id
    const before = sessions.get(id) ?? newSession(tracked.connection.openedAtMs)
    const after = reduce(before, {
      packet: tracked.event.packet,
      timestampMs: now(),
      keyName: tracked.keyName
    })
    sessions.set(id, after)

    if (after === before || !isIdentified(after)) return

    unsaved.set(after.record.name, after.record)
    scheduleSave()
    onCharacter?.(after.record)

    if (currentCharacter !== after.record.name) {
      currentCharacter = after.record.name
      // Whatever could not be read before belonged to a session that is over.
      missedHandshake = false
      publishStatus()
    }
  }

  const tracker = createSessionTracker(handleEvent)

  return {
    async start(nextDevice: string): Promise<void> {
      if (source !== undefined) await this.stop()

      decodedCount = 0
      unreadableCount = 0
      missedHandshake = false
      lastError = undefined
      currentCharacter = undefined
      connectionCount = 0
      sessions.clear()
      tracker.clear()

      device = nextDevice
      recorder = (await options.createRecorder?.(now())) ?? null

      const decode: CaptureSink = {
        onOpen: (connection) => {
          tracker.onOpen?.(connection)
          connectionCount = tracker.activeConnections().length
          publishStatus()
        },
        onChunk: (chunk) => tracker.onChunk?.(chunk),
        onClose: (connection) => {
          tracker.onClose?.(connection)
          sessions.delete(connection.id)
          connectionCount = tracker.activeConnections().length
          publishStatus()
        },
        onError: (error) => {
          lastError = error.message
          publishStatus()
        }
      }
      // Record the raw stream beside decoding it, never instead of it, so a
      // recording is a faithful copy of the session that was read.
      const sink = recorder === null ? decode : teeSink(recorder, decode)

      const next = createSource(nextDevice)
      try {
        await next.start(sink)
      } catch (error) {
        await recorder?.close()
        recorder = null
        device = undefined
        lastError = error instanceof Error ? error.message : String(error)
        publishStatus()
        throw error
      }

      source = next
      publishStatus()
    },

    async stop(): Promise<void> {
      if (saveTimer !== undefined) {
        clearTimeout(saveTimer)
        saveTimer = undefined
      }
      const running = source
      const writing = recorder
      source = undefined
      device = undefined
      recorder = null
      currentCharacter = undefined
      connectionCount = 0
      // Stop the source first, so no event arrives after the file is closed.
      if (running !== undefined) await running.stop()
      await writing?.close()
      tracker.clear()
      sessions.clear()
      await flush()
      publishStatus()
    },

    status,
    flush
  }
}
