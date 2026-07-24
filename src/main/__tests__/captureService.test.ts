import { readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CharacterRecord, CaptureStatus } from '../../shared/types'
import { createRecorder } from '../capture/recorder'
import { createReplaySource } from '../capture/replaySource'
import {
  encodeChunk,
  parseRecording,
  type RecordingChunk,
  type RecordingLine
} from '../capture/recording'
import type { ConnectionInfo, PacketSource, StreamChunk } from '../capture/source'
import { createCaptureService } from '../captureService'
import { ClientOpcode, ServerOpcode } from '../protocol/opcodes'
import { createCharacterStore } from '../store/characterStore'
import {
  clientSessionBody,
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

/** A second client, for the two-clients-at-once tests. Its world server has a
 *  distinct address, so the tracker parks its redirect apart from the first. */
const CHARACTER2 = 'Deoradhan'

const LOGIN2: ConnectionInfo = {
  id: 'login2',
  localAddress: '192.168.1.20',
  localPort: 51002,
  remoteAddress: '203.0.113.8',
  remotePort: 2611,
  openedAtMs: 5000
}

const WORLD2: ConnectionInfo = {
  id: 'world2',
  localAddress: '192.168.1.20',
  localPort: 51003,
  remoteAddress: '203.0.113.10',
  remotePort: 2612,
  openedAtMs: 6000
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

interface LoginTimes {
  redirect: number
  loginClose: number
  status: number
  item: number
}

/**
 * The lines of one login: a redirect on the login connection, then the world's
 * opening packets. No header, so two logins compose into one recording.
 */
function loginLines(
  login: ConnectionInfo,
  world: ConnectionInfo,
  name: string,
  times: LoginTimes
): RecordingLine[] {
  const worldChunk = (body: number[], sequence: number, timestampMs: number): RecordingLine =>
    encodeChunk(
      chunk(
        world,
        sessionBody({ plaintext: body, keyName: name, saltSelector: 3, sequence }),
        timestampMs
      )
    )

  return [
    open(login),
    encodeChunk(
      chunk(
        login,
        redirectBody({
          address: world.remoteAddress,
          port: world.remotePort,
          name,
          saltSelector: 3
        }),
        times.redirect
      )
    ),
    { kind: 'close', id: login.id, timestampMs: times.loginClose },
    open(world),
    worldChunk(statusBody, 1, times.status),
    worldChunk(itemBody, 2, times.item)
  ]
}

/** The recording of one login: a redirect, then the world's opening packets. */
function loginRecording(): RecordingLine[] {
  return [
    { kind: 'header', version: 1, startedAtMs: 0 },
    ...loginLines(LOGIN, WORLD, CHARACTER, {
      redirect: 1500,
      loginClose: 1600,
      status: 2100,
      item: 2200
    })
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

  // The clock is fixed because nothing above the source seam reads it any
  // more: the record runs on the capture time each chunk carries.
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
      characters: [CHARACTER],
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
    expect(service.status().characters).toEqual([])
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

  describe('the bank the player asked for', () => {
    /**
     * A live CMerchant 0x39 with its dialog wrapper still on, asking a banker
     * for the withdraw list. The wrapper's CRC covers the body only, so these
     * bytes stand in any session.
     */
    const WRAPPED_BANK_REQUEST = [
      0x39, 0xb7, 0xca, 0xb2, 0xba, 0x4c, 0x79, 0x6b, 0x6b, 0x6c, 0x72, 0x01, 0x6f, 0x35, 0x00, 0x39
    ]

    const bankRequest = (timestampMs: number): RecordingLine =>
      encodeChunk({
        connectionId: WORLD.id,
        direction: 'clientToServer',
        bytes: Uint8Array.from(
          frameOf(
            clientSessionBody({
              plaintext: WRAPPED_BANK_REQUEST,
              keyName: CHARACTER,
              saltSelector: 3
            })
          )
        ),
        timestampMs,
        gap: false
      })

    /** A server packet Midir does not model, such as a heartbeat. */
    const unmodelled = (sequence: number, timestampMs: number): RecordingLine =>
      encodeChunk(
        chunk(
          WORLD,
          sessionBody({
            plaintext: [0x1a, 0x00],
            keyName: CHARACTER,
            saltSelector: 3,
            sequence
          }),
          timestampMs
        )
      )

    it('records an empty bank when the request goes unanswered', async () => {
      // 0x1a is a server packet Midir does not model. Its opcode is in the
      // clear, so it is known not to be the bank list and the wait survives it.
      const { service, store } = build([
        ...loginRecording(),
        bankRequest(2300),
        unmodelled(3, 4500)
      ])
      await service.start('adapter')
      await service.flush()

      const saved = (await store.load()).characters[CHARACTER]
      expect(saved?.bank).toBeDefined()
      expect(saved?.bank?.items).toEqual([])
      await service.stop()
    })

    it('records nothing when the request is the last thing on the connection', async () => {
      // Nothing followed it, so the wait never ran out and the close came too
      // soon after. A bank Midir is unsure of stays unread.
      const { service, store } = build([...loginRecording(), bankRequest(2300)])
      await service.start('adapter')
      await service.flush()

      expect((await store.load()).characters[CHARACTER]?.bank).toBeUndefined()
      await service.stop()
    })

    it('records an empty bank when the player asks and then logs off', async () => {
      // The quit dialog is the packet that settles it. A close carries no time
      // of its own, so it can only settle a wait some earlier packet ran out.
      const { service, store } = build([
        ...loginRecording(),
        bankRequest(2300),
        encodeChunk(clientChunk(WORLD, exitBody(0), 4500)),
        { kind: 'close', id: WORLD.id, timestampMs: 4600 }
      ])
      await service.start('adapter')
      await service.flush()

      expect((await store.load()).characters[CHARACTER]?.bank?.items).toEqual([])
      await service.stop()
    })

    it('says nothing when bytes were lost after the request', async () => {
      // A missed list looks exactly like an empty bank on the wire.
      const lostChunk: RecordingChunk = { ...(unmodelled(3, 4500) as RecordingChunk), gap: true }
      const { service, store } = build([...loginRecording(), bankRequest(2300), lostChunk])
      await service.start('adapter')
      await service.flush()

      expect((await store.load()).characters[CHARACTER]?.bank).toBeUndefined()
      await service.stop()
    })
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
      expect(service.status().characters).toEqual([])
      // It named the character while the connection was open.
      expect(statuses.some((status) => status.characters.includes(CHARACTER))).toBe(true)
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

      expect(service.status().characters).toEqual([])
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

      expect(service.status()).toMatchObject({ state: 'decoding', characters: [CHARACTER] })
      await service.stop()
    })

    it('names the next character after a logoff and a fresh login', async () => {
      const { service } = build([
        ...loginRecording(),
        encodeChunk(clientChunk(WORLD, exitBody(0), 2500)),
        { kind: 'close', id: WORLD.id, timestampMs: 2600 }
      ])
      await service.start('adapter')
      expect(service.status().characters).toEqual([])
      await service.stop()

      // A second capture stands in for the next login.
      const again = build(loginRecording())
      await again.service.start('adapter')
      expect(again.service.status()).toMatchObject({ characters: [CHARACTER] })
      await again.service.stop()
    })
  })

  describe('two clients at once', () => {
    /** Two logins in one capture: each has its own redirect, world server,
     *  character name and session key. */
    function twoClientLines(): RecordingLine[] {
      return [
        { kind: 'header', version: 1, startedAtMs: 0 },
        ...loginLines(LOGIN, WORLD, CHARACTER, {
          redirect: 1500,
          loginClose: 1600,
          status: 2100,
          item: 2200
        }),
        ...loginLines(LOGIN2, WORLD2, CHARACTER2, {
          redirect: 5500,
          loginClose: 5600,
          status: 6100,
          item: 6200
        })
      ]
    }

    it('names both characters, in connection order, and records both', async () => {
      const { service, store } = build(twoClientLines())
      await service.start('adapter')
      await service.flush()

      expect(service.status()).toMatchObject({
        state: 'decoding',
        characters: [CHARACTER, CHARACTER2]
      })
      const saved = (await store.load()).characters
      expect(saved[CHARACTER]).toBeDefined()
      expect(saved[CHARACTER2]).toBeDefined()
      await service.stop()
    })

    it('keeps the other character when one connection ends', async () => {
      // A bare close with no exit packet is the crash path: the connection ends
      // but the character who stayed is untouched.
      const { service } = build([
        ...twoClientLines(),
        { kind: 'close', id: WORLD.id, timestampMs: 7000 }
      ])
      await service.start('adapter')

      expect(service.status()).toMatchObject({ state: 'decoding', characters: [CHARACTER2] })
      await service.stop()
    })

    it('returns to listening once both characters log off', async () => {
      const { service } = build([
        ...twoClientLines(),
        { kind: 'close', id: WORLD.id, timestampMs: 7000 },
        { kind: 'close', id: WORLD2.id, timestampMs: 7100 }
      ])
      await service.start('adapter')

      expect(service.status()).toMatchObject({ state: 'listening', characters: [] })
      await service.stop()
    })
  })
})
