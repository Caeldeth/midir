import type { CharacterRecord } from '../shared/character'
import type { CaptureStatus } from '../shared/types'
import type { Recorder } from './capture/recorder'
import { teeSink } from './capture/recorder'
import type { CaptureSink, PacketSource } from './capture/source'
import { createSessionTracker, type TrackedEvent } from './capture/tracker'
import type { UnreadableReason } from './protocol/session'
import {
  isIdentified,
  newSession,
  reduce,
  resolvePendingBank,
  type CharacterSession
} from './model/character'
import { mergeCharacter, withCharacter, type CharacterStore } from './store/characterStore'

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

/**
 * The unreadable packets that hide what they were.
 *
 * `notModelled` is not one of them. The opcode is in the clear and Midir read
 * it, so that packet is known not to be the one being waited for — and most
 * server packets are unmodelled, so counting them would cancel every wait. The
 * greeting is known too. The other three could have been anything.
 */
const HIDES_CONTENT: ReadonlySet<UnreadableReason> = new Set<UnreadableReason>([
  'noSessionKey',
  'decryptFailed',
  'decodeFailed'
])

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
  /**
   * Connections that have lost bytes since their last decoded packet.
   *
   * The reducer cannot see a loss, and one changes what silence means: a bank
   * request with no list behind it is an empty bank only while nothing went
   * missing. See applyBankWait in model/character.ts.
   */
  const lossy = new Set<string>()

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

  /** Save a record that changed outside the packet path, such as on close. */
  function saveSession(session: CharacterSession): void {
    if (!isIdentified(session)) return
    save(session.record)
  }

  /**
   * Queue a record for the next write.
   *
   * The queue holds one record for each character, so two logins in one
   * capture meet here before either reaches the file. They are merged the same
   * way the file merges them, or the second login would drop the bank the
   * first one read.
   */
  function save(record: CharacterRecord): void {
    unsaved.set(record.name, mergeCharacter(unsaved.get(record.name), record))
    scheduleSave()
    onCharacter?.(record)
  }

  /**
   * Run the bank wait out on a connection, if it is over.
   *
   * Time settles a bank request, not any one packet, so anything arriving on
   * the connection can do it — including a packet Midir does not model, which
   * is most of what the world server sends.
   *
   * A close settles nothing, because it carries no time of its own. A request
   * that was the last packet on its connection therefore stays unsettled, and
   * the bank stays unread. That is the honest answer: nothing on the wire says
   * how long the player waited before leaving.
   */
  function settleBank(id: string, atMs: number): void {
    const session = sessions.get(id)
    if (session === undefined || lossy.has(id)) return
    const settled = resolvePendingBank(session, atMs)
    if (settled === session) return
    sessions.set(id, settled)
    if (settled.record !== session.record) saveSession(settled)
  }

  function handleEvent(tracked: TrackedEvent): void {
    if (tracked.event.type !== 'packet') {
      unreadableCount++
      if (HIDES_CONTENT.has(tracked.event.reason)) lossy.add(tracked.connection.id)
      else settleBank(tracked.connection.id, tracked.timestampMs)
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
      settleBank(id, tracked.timestampMs)
      if (tracked.event.packet.confirmed && liveCharacters.delete(id)) publishStatus()
      return
    }

    const before = sessions.get(id) ?? newSession(tracked.connection.openedAtMs)
    const after = reduce(before, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      keyName: tracked.keyName,
      sawLoss: lossy.delete(id)
    })
    sessions.set(id, after)

    // The record, not the session. A bank request the service is still waiting
    // on changes the session and nothing worth writing.
    if (after.record === before.record || !isIdentified(after)) return

    save(after.record)

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
      lossy.clear()
      tracker.clear()

      device = nextDevice
      recorder = (await options.createRecorder?.(now())) ?? null

      const decode: CaptureSink = {
        onOpen: (connection) => {
          tracker.onOpen?.(connection)
          connectionCount = tracker.activeConnections().length
          publishStatus()
        },
        onChunk: (chunk) => {
          // TCP lost a range. The frame reader resynchronises, but whole
          // packets went missing with it.
          if (chunk.gap) lossy.add(chunk.connectionId)
          tracker.onChunk?.(chunk)
        },
        onClose: (connection) => {
          tracker.onClose?.(connection)
          lossy.delete(connection.id)
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
