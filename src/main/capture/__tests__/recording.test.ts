import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ServerOpcode } from '../../protocol/opcodes'
import type { PacketEvent } from '../../protocol/session'
import { createRecorder, teeSink } from '../recorder'
import {
  decodeChunk,
  encodeChunk,
  parseRecording,
  RECORDING_VERSION,
  type RecordingChunk
} from '../recording'
import { createReplaySource, createReplaySourceFromFile } from '../replaySource'
import type { CaptureSink, ConnectionInfo, StreamChunk } from '../source'
import { createSessionTracker, type TrackedEvent } from '../tracker'
import { frameOf, redirectBody, sessionBody } from './helpers'

const CHARACTER = 'Sabrael'

const LOGIN: ConnectionInfo = {
  id: '192.168.1.20:51000->203.0.113.8:2611',
  localAddress: '192.168.1.20',
  localPort: 51000,
  remoteAddress: '203.0.113.8',
  remotePort: 2611,
  openedAtMs: 1000
}

const WORLD: ConnectionInfo = {
  id: '192.168.1.20:51001->203.0.113.9:2612',
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

/** The item packet the world server sends for slot 3. */
const STICK = [
  ServerOpcode.AddInventory,
  3,
  0x01,
  0x00,
  0x00,
  5,
  ...[...'Stick'].map((c) => c.charCodeAt(0)),
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  50,
  0,
  0,
  0,
  50
]

describe('the recording format', () => {
  it('round-trips a chunk through base64', () => {
    const original = chunk(WORLD, [0x08, 0x10], 4242)
    const restored = decodeChunk(encodeChunk(original))
    expect(restored.connectionId).toBe(original.connectionId)
    expect(restored.direction).toBe(original.direction)
    expect(restored.timestampMs).toBe(original.timestampMs)
    expect([...restored.bytes]).toEqual([...original.bytes])
  })

  it('keeps a gap flag', () => {
    const withGap: StreamChunk = { ...chunk(WORLD, [1], 1), gap: true }
    expect(decodeChunk(encodeChunk(withGap)).gap).toBe(true)
  })

  it('skips a blank line', () => {
    expect(parseRecording('\n\n  \n')).toEqual([])
  })

  it('skips a line cut short by a crash and keeps the rest', () => {
    const text = ['{"kind":"header","version":1,"startedAtMs":1}', '{"kind":"open"', ''].join('\n')
    expect(parseRecording(text)).toEqual([{ kind: 'header', version: 1, startedAtMs: 1 }])
  })

  it('skips a line whose kind this version does not know', () => {
    const text = '{"kind":"someFutureThing"}\n{"kind":"close","id":"a","timestampMs":2}'
    expect(parseRecording(text)).toEqual([{ kind: 'close', id: 'a', timestampMs: 2 }])
  })
})

describe('record then replay', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-recording-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  it('writes a header first', async () => {
    const path = join(directory, 'session.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 111, note: 'client 7.41' })
    await recorder.close()

    const [header] = parseRecording(await readFile(path, 'utf8'))
    expect(header).toEqual({
      kind: 'header',
      version: RECORDING_VERSION,
      startedAtMs: 111,
      note: 'client 7.41'
    })
  })

  it('creates the parent directory', async () => {
    const path = join(directory, 'deep', 'deeper', 'session.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 1 })
    await recorder.close()
    expect((await readFile(path, 'utf8')).length).toBeGreaterThan(0)
  })

  it('replays a recorded login and produces the same decoded packets', async () => {
    // This is the test the whole capture layer exists to make possible: a
    // session that happened once drives the decoder forever, with no adapter,
    // no driver, and no game.
    const path = join(directory, 'login.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 9000 })

    const liveEvents: TrackedEvent[] = []
    const tracker = createSessionTracker((event) => liveEvents.push(event))
    const sink: CaptureSink = teeSink(recorder, tracker)

    // The login server hands the client to the world server.
    sink.onOpen?.(LOGIN)
    sink.onChunk?.(
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
    )
    sink.onClose?.(LOGIN)

    // The world server then sends the character's first item.
    sink.onOpen?.(WORLD)
    sink.onChunk?.(
      chunk(
        WORLD,
        sessionBody({ plaintext: STICK, keyName: CHARACTER, saltSelector: 3, sequence: 1 }),
        2500
      )
    )
    await recorder.close()

    // Replay the file through a fresh tracker.
    const replayedEvents: TrackedEvent[] = []
    const replayTracker = createSessionTracker((event) => replayedEvents.push(event))
    const source = await createReplaySourceFromFile(path)
    await source.start(replayTracker)

    const packetsOf = (events: TrackedEvent[]): unknown[] =>
      events.filter((e) => e.event.type === 'packet').map((e) => (e.event as PacketEvent).packet)

    expect(packetsOf(replayedEvents)).toEqual(packetsOf(liveEvents))
    expect(packetsOf(replayedEvents)).toEqual([
      expect.objectContaining({ kind: 'transferServer', name: CHARACTER }),
      expect.objectContaining({ kind: 'addInventory', slot: 3, name: 'Stick', durability: 50 })
    ])
    expect(replayTracker.keyNameOf(WORLD.id)).toBe(CHARACTER)
  })

  it('reports open and close in the order they were recorded', async () => {
    const path = join(directory, 'lifecycle.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 3000 })
    recorder.onOpen?.(LOGIN)
    recorder.onClose?.(LOGIN)
    recorder.onOpen?.(WORLD)
    await recorder.close()

    const seen: string[] = []
    const source = await createReplaySourceFromFile(path)
    await source.start({
      onOpen: (c) => seen.push(`open ${c.id}`),
      onClose: (c) => seen.push(`close ${c.id}`)
    })
    expect(seen).toEqual([`open ${LOGIN.id}`, `close ${LOGIN.id}`, `open ${WORLD.id}`])
  })

  it('stops part-way through when asked', async () => {
    const lines = parseRecording(
      [
        '{"kind":"header","version":1,"startedAtMs":0}',
        '{"kind":"open","id":"a","localAddress":"1.1.1.1","localPort":1,"remoteAddress":"2.2.2.2","remotePort":2,"openedAtMs":0}',
        '{"kind":"open","id":"b","localAddress":"1.1.1.1","localPort":3,"remoteAddress":"2.2.2.2","remotePort":4,"openedAtMs":10}'
      ].join('\n')
    )

    const seen: string[] = []
    const source = createReplaySource(lines, { realTime: true })
    const started = source.start({
      onOpen: (c) => {
        seen.push(c.id)
        void source.stop()
      }
    })
    await started
    expect(seen).toEqual(['a'])
  })
})

describe('teeSink', () => {
  it('sends every event to every sink', () => {
    const first: string[] = []
    const second: string[] = []
    const sink = teeSink(
      { onOpen: () => first.push('open'), onChunk: () => first.push('chunk') },
      {
        onOpen: () => second.push('open'),
        onChunk: () => second.push('chunk'),
        onClose: () => second.push('close'),
        onError: () => second.push('error')
      }
    )

    sink.onOpen?.(LOGIN)
    sink.onChunk?.(chunk(LOGIN, [1], 1))
    sink.onClose?.(LOGIN)
    sink.onError?.(new Error('x'))

    expect(first).toEqual(['open', 'chunk'])
    expect(second).toEqual(['open', 'chunk', 'close', 'error'])
  })
})

describe('encodeChunk', () => {
  it('produces a line that survives JSON', () => {
    const line: RecordingChunk = encodeChunk(chunk(WORLD, [0xaa, 0x00, 0xff], 1))
    expect(JSON.parse(JSON.stringify(line))).toEqual(line)
  })
})
