import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterRecord, CaptureStatus } from '../../shared/types'
import { createRecorder } from '../capture/recorder'
import { createReplaySource } from '../capture/replaySource'
import { encodeChunk, parseRecording, type RecordingLine } from '../capture/recording'
import type { ConnectionInfo, PacketSource, StreamChunk } from '../capture/source'
import { createCaptureService } from '../captureService'
import { ClientOpcode, ServerOpcode } from '../protocol/opcodes'
import { createCharacterStore } from '../store/characterStore'
import {
  frameOf,
  redirectBody,
  sessionBody,
  startupBody,
  str8,
  u16,
  u32
} from '../capture/__tests__/helpers'

/**
 * The service is driven from a recorded session here, exactly as it will be
 * driven from a real one. That is the whole point of the source seam.
 */

const CHARACTER = 'Sabrael'

const LOGIN: ConnectionInfo = {
  id: 'login',
  localAddress: '192.168.1.20',
  localPort: 51000,
  remoteAddress: '203.0.113.8',
  remotePort: 2611,
  openedAtMs: 1000
}

const WORLD: ConnectionInfo = {
  id: 'world',
  localAddress: '192.168.1.20',
  localPort: 51001,
  remoteAddress: '203.0.113.9',
  remotePort: 2612,
  openedAtMs: 2000
}

const chunk = (connection: ConnectionInfo, body: number[], timestampMs: number): StreamChunk => ({
  connectionId: connection.id,
  direction: 'serverToClient',
  bytes: Uint8Array.from(frameOf(body)),
  timestampMs,
  gap: false
})

const open = (connection: ConnectionInfo): RecordingLine => ({ kind: 'open', ...connection })

/** A client-direction chunk, which the client encrypts with the startup key. */
const clientChunk = (
  connection: ConnectionInfo,
  body: number[],
  timestampMs: number
): StreamChunk => ({
  connectionId: connection.id,
  direction: 'clientToServer',
  bytes: Uint8Array.from(frameOf(startupBody({ plaintext: body, saltSelector: 3 }))),
  timestampMs,
  gap: false
})

/** CClientExit 0x0B. `endSignal` 1 opens the quit dialog; 0 confirms it. */
const exitBody = (endSignal: number): number[] => [ClientOpcode.ClientExit, endSignal, 0x00]

/** A full SStatus, with every block present. */
const statusBody = [
  ServerOpcode.Status,
  0x3d,
  0x02,
  0x00,
  0x00,
  99, // level
  12, // ability level
  ...u32(2500),
  ...u32(1800),
  150,
  88,
  120,
  200,
  75,
  0x01,
  3,
  ...u16(1000),
  ...u16(742),
  ...u32(0),
  ...u32(2431),
  ...u32(1799),
  ...u32(1234567890),
  ...u32(4000),
  ...u32(88000),
  ...u32(1200),
  ...u32(45),
  ...u32(3000000000),
  0x00,
  0x00,
  0x00,
  0x00,
  0x00,
  0x01, // mail state
  0x01,
  0x02,
  30,
  0x00,
  0xf6, // armour class -10
  12,
  9
]

const itemBody = [
  ServerOpcode.AddInventory,
  1,
  ...u16(0x0021),
  0,
  ...str8('Raw Fish'),
  ...u32(65),
  0x01,
  ...u32(0),
  ...u32(0)
]

/** The recording of one login: a redirect, then the world's opening packets. */
function loginRecording(): RecordingLine[] {
  const world = (body: number[], sequence: number, timestampMs: number): RecordingLine =>
    encodeChunk(
      chunk(
        WORLD,
        sessionBody({ plaintext: body, keyName: CHARACTER, saltSelector: 3, sequence }),
        timestampMs
      )
    )

  return [
    { kind: 'header', version: 1, startedAtMs: 0 },
    open(LOGIN),
    encodeChunk(
      chunk(
        LOGIN,
        redirectBody({
          address: WORLD.remoteAddress,
          port: WORLD.remotePort,
          name: CHARACTER,
          saltSelector: 3
        }),
        1500
      )
    ),
    { kind: 'close', id: LOGIN.id, timestampMs: 1600 },
    open(WORLD),
    world(statusBody, 1, 2100),
    world(itemBody, 2, 2200)
  ]
}

describe('createCaptureService', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-service-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  function build(lines: RecordingLine[]): {
    service: ReturnType<typeof createCaptureService>
    statuses: CaptureStatus[]
    characters: CharacterRecord[]
    store: ReturnType<typeof createCharacterStore>
  } {
    const statuses: CaptureStatus[] = []
    const characters: CharacterRecord[] = []
    const store = createCharacterStore(directory)
    const service = createCaptureService({
      store,
      createSource: (): PacketSource => createReplaySource(lines),
      onStatus: (status) => statuses.push(status),
      onCharacter: (record) => characters.push(record),
      now: () => 7000,
      saveDebounceMs: 0
    })
    return { service, statuses, characters, store }
  }

  it('is stopped before it starts', () => {
    const { service } = build([])
    expect(service.status()).toMatchObject({ running: false, state: 'stopped', connections: 0 })
  })

  it('builds a character from a recorded login and writes it', async () => {
    const { service, store } = build(loginRecording())
    await service.start('adapter')
    await service.flush()

    const saved = (await store.load()).characters[CHARACTER]
    expect(saved).toBeDefined()
    expect(saved?.stats).toMatchObject({
      level: 99,
      maxHealth: 2500,
      currentHealth: 2431,
      gold: 3000000000,
      armorClass: -10
    })
    expect(saved?.inventory[1]).toMatchObject({ name: 'Raw Fish', count: 65, canStack: true })
    expect(saved?.hasMail).toBe(true)
    await service.stop()
  })

  it('reports the character it is decoding', async () => {
    const { service } = build(loginRecording())
    await service.start('adapter')
    expect(service.status()).toMatchObject({
      running: true,
      state: 'decoding',
      characterName: CHARACTER,
      device: 'adapter'
    })
    expect(service.status().decodedCount).toBeGreaterThan(0)
    await service.stop()
  })

  it('tells the renderer about every character change', async () => {
    const { service, characters } = build(loginRecording())
    await service.start('adapter')
    expect(characters.length).toBeGreaterThan(0)
    expect(characters.every((record) => record.name === CHARACTER)).toBe(true)
    await service.stop()
  })

  it('says the handshake was missed when a session packet cannot be read', async () => {
    // This is Midir started after the player logged in. It is the one failure
    // the user has to be told about, because the fix is to start Midir first.
    const lines: RecordingLine[] = [
      { kind: 'header', version: 1, startedAtMs: 0 },
      open(WORLD),
      encodeChunk(chunk(WORLD, sessionBody({ plaintext: itemBody, keyName: CHARACTER }), 2100))
    ]
    const { service } = build(lines)
    await service.start('adapter')

    expect(service.status().missedHandshake).toBe(true)
    expect(service.status().unreadableCount).toBeGreaterThan(0)
    expect(service.status().state).toBe('listening')
    await service.stop()
  })

  it('does not claim a missed handshake on a clean login', async () => {
    const { service } = build(loginRecording())
    await service.start('adapter')
    expect(service.status().missedHandshake).toBe(false)
    await service.stop()
  })

  it('returns to a stopped status and writes what is pending', async () => {
    const { service, store } = build(loginRecording())
    await service.start('adapter')
    await service.stop()

    expect(service.status()).toMatchObject({ running: false, state: 'stopped', connections: 0 })
    expect(service.status().characterName).toBeUndefined()
    expect((await store.load()).characters[CHARACTER]).toBeDefined()
  })

  it('clears its counters when it starts again', async () => {
    const { service } = build(loginRecording())
    await service.start('adapter')
    const first = service.status().decodedCount
    expect(first).toBeGreaterThan(0)

    await service.stop()
    await service.start('adapter')
    expect(service.status().decodedCount).toBe(first)
    await service.stop()
  })

  it('reports a source that will not start, and stays stopped', async () => {
    const store = createCharacterStore(directory)
    const statuses: CaptureStatus[] = []
    const service = createCaptureService({
      store,
      createSource: (): PacketSource => ({
        start: async () => {
          throw new Error('Npcap is not installed.')
        },
        stop: async () => undefined
      }),
      onStatus: (status) => statuses.push(status)
    })

    await expect(service.start('adapter')).rejects.toThrow('Npcap is not installed.')
    expect(service.status().running).toBe(false)
    expect(statuses.at(-1)?.error).toBe('Npcap is not installed.')
  })

  it('records a session to a file that replays into the same character', async () => {
    // The recording is the tool for pinning a packet whose shape is unknown,
    // so it has to be a faithful copy of what was decoded, not a summary.
    const path = join(directory, 'recorded.ndjson')
    const store = createCharacterStore(join(directory, 'store'))
    const service = createCaptureService({
      store,
      createSource: (): PacketSource => createReplaySource(loginRecording()),
      createRecorder: (startedAtMs) => createRecorder(path, { startedAtMs }),
      saveDebounceMs: 0
    })

    await service.start('adapter')
    expect(service.status().recordingPath).toBe(path)
    await service.stop()

    // Replay what was written, into a fresh store.
    const replayStore = createCharacterStore(join(directory, 'replay'))
    const replayService = createCaptureService({
      store: replayStore,
      createSource: (): PacketSource =>
        createReplaySource(parseRecording(readFileSync(path, 'utf8'))),
      saveDebounceMs: 0
    })
    await replayService.start('adapter')
    await replayService.stop()

    const original = (await store.load()).characters[CHARACTER]
    const replayed = (await replayStore.load()).characters[CHARACTER]
    expect(replayed).toBeDefined()
    expect(replayed?.stats).toEqual(original?.stats)
    expect(replayed?.inventory).toEqual(original?.inventory)
  })

  it('records nothing unless asked, and says so in the status', async () => {
    const { service } = build(loginRecording())
    await service.start('adapter')
    expect(service.status().recordingPath).toBeUndefined()
    await service.stop()
  })

  it('keeps the record when the same character logs in twice', async () => {
    const { service, store } = build(loginRecording())
    await service.start('adapter')
    await service.stop()
    await service.start('adapter')
    await service.stop()

    const file = await store.load()
    expect(Object.keys(file.characters)).toEqual([CHARACTER])
    expect(file.characters[CHARACTER]?.stats.level).toBe(99)
  })

  describe('logging off', () => {
    it('stops naming a character once the connection ends', async () => {
      // The bug this fixes: nothing cleared the name, so a character stayed
      // "logged in" on screen until capture stopped.
      const { service, statuses } = build([
        ...loginRecording(),
        { kind: 'close', id: WORLD.id, timestampMs: 3000 }
      ])
      await service.start('adapter')

      expect(service.status()).toMatchObject({ state: 'listening', connections: 0 })
      expect(service.status().characterName).toBeUndefined()
      // It named the character while the connection was open.
      expect(statuses.some((status) => status.characterName === CHARACTER)).toBe(true)
      await service.stop()
    })

    it('stops naming a character the moment they confirm the quit dialog', async () => {
      // The connection usually closes a moment later, but the close can be
      // missed and this is the earlier signal.
      const { service } = build([
        ...loginRecording(),
        encodeChunk(clientChunk(WORLD, exitBody(0), 2500))
      ])
      await service.start('adapter')

      expect(service.status().characterName).toBeUndefined()
      expect(service.status().state).toBe('listening')
      await service.stop()
    })

    it('keeps naming a character who only opened the quit dialog', async () => {
      // endSignal 1 means the dialog opened, not that anyone left. An earlier
      // reading of this packet had the two backwards, which would report a
      // player gone every time they changed their mind.
      const { service } = build([
        ...loginRecording(),
        encodeChunk(clientChunk(WORLD, exitBody(1), 2500))
      ])
      await service.start('adapter')

      expect(service.status()).toMatchObject({ state: 'decoding', characterName: CHARACTER })
      await service.stop()
    })

    it('names the next character after a logoff and a fresh login', async () => {
      const { service } = build([
        ...loginRecording(),
        encodeChunk(clientChunk(WORLD, exitBody(0), 2500)),
        { kind: 'close', id: WORLD.id, timestampMs: 2600 }
      ])
      await service.start('adapter')
      expect(service.status().characterName).toBeUndefined()
      await service.stop()

      // A second capture stands in for the next login.
      const again = build(loginRecording())
      await again.service.start('adapter')
      expect(again.service.status()).toMatchObject({ characterName: CHARACTER })
      await again.service.stop()
    })
  })
})
