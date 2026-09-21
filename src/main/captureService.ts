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
import { reducePosition, type Position } from './model/position'
import { reduceAnswer, reduceDialog, type DialogAnswer, type DialogState } from './model/dialog'
import { reduceNotice, type NoticeState } from './model/notice'
import { reduceExchange, type ExchangeState } from './model/exchange'
import { reduceFieldMap, type FieldMapState } from './model/fieldMap'
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
  /**
   * The live characters, by connection. The action layer reads this to attach a
   * name to a window and to refuse driving a connection with no character.
   */
  liveCharacterEntries(): { connectionId: string; name: string }[]
  /**
   * Where the character on `connectionId` stands, or null while it is unknown.
   *
   * The position is a live fact, not a record, so it is never saved and never
   * reaches the renderer on its own. The walker reads it to step and confirm.
   */
  positionFor(connectionId: string): Position | null
  /**
   * The NPC dialog on screen on `connectionId` now, or null while there is
   * none. Like the position, it is a live fact and is never saved. The Laborer
   * reads it to choose an option and wait for the next step.
   */
  dialogFor(connectionId: string): DialogState | null
  /**
   * The client's newest answer to a dialog on `connectionId`, with the dialog
   * it answered, or null. A live fact, never saved. The pane watcher pairs it
   * with the hand click before it.
   */
  answerFor(connectionId: string): DialogAnswer | null
  /**
   * The newest server notice on `connectionId`, or null while there is none.
   * A live fact, never saved. The Laborer reads it beside the dialog: a notice
   * and a close in place of the next dialog is a refusal, and the notice says
   * why.
   */
  noticeFor(connectionId: string): NoticeState | null
  /**
   * The exchange window on `connectionId` now, or the alert it left behind,
   * or null while there is neither. A live fact, never saved. The walker
   * reads it beside the dialog: an open exchange holds the character still.
   */
  exchangeFor(connectionId: string): ExchangeState | null
  /**
   * The world map on screen on `connectionId` now, or null while there is
   * none. A live fact, never saved. The walker reads it to click the point of
   * a cross-town hop and wait for the map change.
   */
  fieldMapFor(connectionId: string): FieldMapState | null
}

export function createCaptureService(options: CaptureServiceOptions): CaptureService {
  const { store, createSource, onStatus, onCharacter } = options
  const now = options.now ?? Date.now
  const saveDebounceMs = options.saveDebounceMs ?? DEFAULT_SAVE_DEBOUNCE_MS

  /** One reducer state for each connection. */
  const sessions = new Map<string, CharacterSession>()
  /**
   * One position for each connection, beside the character reducer.
   *
   * Position belongs to a connection, like the character, so two clients keep
   * two positions. It is never written to disk: where a character stood is a
   * live fact, and a saved one is a stale answer with a confident face on it.
   */
  const positions = new Map<string, Position>()
  /**
   * The NPC dialog on screen for each connection, beside the position.
   *
   * Like the position, it belongs to a connection and is never written to disk:
   * the dialog on screen is a live fact the Laborer reads to step a
   * conversation, not a record.
   */
  const dialogs = new Map<string, DialogState>()
  /** The client's newest dialog answer for each connection. A live fact, like the dialog. */
  const answers = new Map<string, DialogAnswer>()
  /** The newest server notice for each connection. A live fact, like the dialog. */
  const notices = new Map<string, NoticeState>()
  const exchanges = new Map<string, ExchangeState>()
  /** The world map on screen for each connection. A live fact, like the dialog. */
  const fieldMaps = new Map<string, FieldMapState>()
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
   * A map rather than one name because it holds more than one: two clients
   * running at once are two live connections, and the status reports the whole
   * list in connection order.
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
   * The characters being decoded now, in the order the connections opened.
   *
   * The map keeps insertion order, so this is the connection order. It drives
   * the status list and the derived state, and nothing else narrows it.
   */
  function liveCharacterList(): string[] {
    return [...liveCharacters.values()]
  }

  function status(): CaptureStatus {
    const characters = liveCharacterList()
    return {
      running: source !== undefined,
      state: source === undefined ? 'stopped' : characters.length > 0 ? 'decoding' : 'listening',
      characters,
      connections: connectionCount,
      decodedCount,
      unreadableCount,
      missedHandshake,
      ...(device !== undefined ? { device } : {}),
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
      if (tracked.event.reason === 'noSessionKey' && liveCharacters.size === 0) {
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

    // The loss is read once and given to both reducers. The set holds one flag
    // per connection, so a second read would always be false.
    const sawLoss = lossy.delete(id)

    const positionBefore = positions.get(id) ?? null
    const positionAfter = reducePosition(positionBefore, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      sawLoss
    })
    if (positionAfter === null) positions.delete(id)
    else positions.set(id, positionAfter)

    const dialogBefore = dialogs.get(id) ?? null
    const dialogInput = { packet: tracked.event.packet, timestampMs: tracked.timestampMs, sawLoss }
    const answerAfter = reduceAnswer(answers.get(id) ?? null, dialogBefore, dialogInput)
    if (answerAfter === null) answers.delete(id)
    else answers.set(id, answerAfter)
    const dialogAfter = reduceDialog(dialogBefore, dialogInput)
    if (dialogAfter === null) dialogs.delete(id)
    else dialogs.set(id, dialogAfter)

    const noticeAfter = reduceNotice(notices.get(id) ?? null, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      sawLoss
    })
    if (noticeAfter === null) notices.delete(id)
    else notices.set(id, noticeAfter)

    const exchangeAfter = reduceExchange(exchanges.get(id) ?? null, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      sawLoss
    })
    if (exchangeAfter === null) exchanges.delete(id)
    else exchanges.set(id, exchangeAfter)

    const fieldMapBefore = fieldMaps.get(id) ?? null
    const fieldMapAfter = reduceFieldMap(fieldMapBefore, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      sawLoss
    })
    if (fieldMapAfter === null) fieldMaps.delete(id)
    else fieldMaps.set(id, fieldMapAfter)

    const before = sessions.get(id) ?? newSession(tracked.connection.openedAtMs)
    const after = reduce(before, {
      packet: tracked.event.packet,
      timestampMs: tracked.timestampMs,
      keyName: tracked.keyName,
      sawLoss
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
      positions.clear()
      dialogs.clear()
      answers.clear()
      notices.clear()
      exchanges.clear()
      fieldMaps.clear()
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
          positions.delete(connection.id)
          dialogs.delete(connection.id)
          answers.delete(connection.id)
          notices.delete(connection.id)
          exchanges.delete(connection.id)
          fieldMaps.delete(connection.id)
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
      positions.clear()
      dialogs.clear()
      answers.clear()
      notices.clear()
      exchanges.clear()
      fieldMaps.clear()
      await flush()
      publishStatus()
    },

    status,
    flush,
    liveCharacterEntries(): { connectionId: string; name: string }[] {
      return [...liveCharacters.entries()].map(([connectionId, name]) => ({ connectionId, name }))
    },
    positionFor(connectionId: string): Position | null {
      return positions.get(connectionId) ?? null
    },
    dialogFor(connectionId: string): DialogState | null {
      return dialogs.get(connectionId) ?? null
    },
    answerFor(connectionId: string): DialogAnswer | null {
      return answers.get(connectionId) ?? null
    },
    noticeFor(connectionId: string): NoticeState | null {
      return notices.get(connectionId) ?? null
    },
    exchangeFor(connectionId: string): ExchangeState | null {
      return exchanges.get(connectionId) ?? null
    },
    fieldMapFor(connectionId: string): FieldMapState | null {
      return fieldMaps.get(connectionId) ?? null
    }
  }
}
