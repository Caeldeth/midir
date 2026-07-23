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
  /**
   * Who is logged in, by connection.
   *
   * The character belongs to its connection, not to the service. A player who
   * logs off leaves the connection behind, and the status has to follow. This
   * used to be a single name that nothing ever cleared, so a character stayed
   * "logged in" until capture stopped.
   *
   * A map rather than one name because one day it will hold more than one:
   * two clients running at once are two live connections, and this shape
   * already describes that. Only `status` still narrows it to one.
   */
  const liveCharacters = new Map<string, string>()

  let source: PacketSource | undefined
  let device: string | undefined
  let recorder: Recorder | null = null
  let saveTimer: NodeJS.Timeout | undefined
  let decodedCount = 0
  let unreadableCount = 0
  let missedHandshake = false
  let lastError: string | undefined
  let connectionCount = 0

  /**
   * The character to name in the status.
   *
   * The most recent login wins while several are live, because the status has
   * room for one name. Nothing else depends on the choice.
   */
  function currentCharacter(): string | undefined {
    let latest: string | undefined
    for (const name of liveCharacters.values()) latest = name
    return latest
  }

  function status(): CaptureStatus {
    const character = currentCharacter()
    return {
      running: source !== undefined,
      state: source === undefined ? 'stopped' : character !== undefined ? 'decoding' : 'listening',
      connections: connectionCount,
      decodedCount,
      unreadableCount,
      missedHandshake,
      ...(device !== undefined ? { device } : {}),
      ...(character !== undefined ? { characterName: character } : {}),
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
      if (tracked.event.reason === 'noSessionKey' && currentCharacter() === undefined) {
        if (!missedHandshake) {
          missedHandshake = true
          publishStatus()
        }
      }
      return
    }

    decodedCount++
    const id = tracked.connection.id

    // The player confirmed the quit dialog. The connection usually closes a
    // moment later, but say so now: the close can be missed, and a passive
    // capture has no other way to learn that a session ended.
    if (tracked.event.packet.kind === 'clientExit') {
      if (tracked.event.packet.confirmed && liveCharacters.delete(id)) publishStatus()
      return
    }

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

    if (liveCharacters.get(id) !== after.record.name) {
      liveCharacters.set(id, after.record.name)
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
      connectionCount = 0
      liveCharacters.clear()
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
          // The character goes with the connection. This is the signal that
          // always arrives: a client that crashes or is killed sends no exit
          // packet, but its connection still ends.
          liveCharacters.delete(connection.id)
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
      liveCharacters.clear()
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
