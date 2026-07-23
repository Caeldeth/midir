import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FRAME_MARKER } from '../../protocol/frame'
import { ClientOpcode, ServerOpcode } from '../../protocol/opcodes'
import { createRecorder } from '../recorder'
import { decodeChunk, parseRecording, type RecordingChunk } from '../recording'
import { createSecretScrubber, SECRET_BEARING_CLIENT_OPCODES } from '../scrub'
import type { ConnectionInfo, StreamChunk } from '../source'
import { frameOf, startupBody, str8 } from './helpers'

const CHARACTER = 'Sabrael'
const PASSWORD = 'notMyRealOne'
const NEW_PASSWORD = 'norIsThisOne'

const LOGIN: ConnectionInfo = {
  id: '192.168.1.20:51000->203.0.113.8:2611',
  localAddress: '192.168.1.20',
  localPort: 51000,
  remoteAddress: '203.0.113.8',
  remotePort: 2611,
  openedAtMs: 1000
}

/** The plaintext Login the player's submission produces. */
const LOGIN_PLAINTEXT = [
  ClientOpcode.Login,
  ...str8(CHARACTER),
  ...str8(PASSWORD),
  // The client record that follows the two strings.
  0x00,
  0x01,
  0x02,
  0x03
]

/** A Login frame as it appears on the wire. */
const loginFrame = (): number[] => frameOf(startupBody({ plaintext: LOGIN_PLAINTEXT }))

/** A client frame that carries no credential. Its body holds a marker byte. */
const otherFrame = (): number[] => frameOf([ClientOpcode.ClientJoin, 0xaa, 0xaa, 0x01])

const push = (scrubber: { push: (b: Uint8Array) => Uint8Array }, bytes: number[]): number[] => [
  ...scrubber.push(Uint8Array.from(bytes))
]

describe('the set of packets to scrub', () => {
  // Sources: the document repo's docs/protocol/client, and
  // darkages-741-re/docs/network/client. Only the first documents 0x15 and
  // 0x27, so a set built from the second alone would leak them.
  it.each([
    ['0x02 CreateA', ClientOpcode.NewUser],
    ['0x03 Login', ClientOpcode.Login],
    ['0x15 CheckPassword', ClientOpcode.CheckPassword],
    ['0x26 ChangePassword', ClientOpcode.ChangePassword],
    ['0x27 NewPassword', ClientOpcode.NewPassword],
    ['0x8F Otp', ClientOpcode.Otp]
  ])('holds %s', (_name, opcode) => {
    expect(SECRET_BEARING_CLIENT_OPCODES.has(opcode)).toBe(true)
  })

  it('leaves a packet that carries no credential alone', () => {
    // 0x28 only closes the change-password pane, and sends nothing.
    for (const opcode of [ClientOpcode.ClientJoin, ClientOpcode.Version, 0x28]) {
      expect(SECRET_BEARING_CLIENT_OPCODES.has(opcode)).toBe(false)
    }
  })
})

describe('the credential scrubber', () => {
  it.each([
    ['0x02 CreateA', ClientOpcode.NewUser],
    ['0x15 CheckPassword', ClientOpcode.CheckPassword],
    ['0x26 ChangePassword', ClientOpcode.ChangePassword],
    ['0x27 NewPassword', ClientOpcode.NewPassword],
    ['0x8F Otp', ClientOpcode.Otp]
  ])('removes %s as well as the login', (_name, opcode) => {
    const secret = frameOf(
      startupBody({
        plaintext: [opcode, ...str8(CHARACTER), ...str8(PASSWORD), ...str8(NEW_PASSWORD)]
      })
    )
    const scrubber = createSecretScrubber()
    expect(push(scrubber, [...secret, ...otherFrame()])).toEqual(otherFrame())
  })

  it('removes a CLogin frame and keeps everything else', () => {
    const scrubber = createSecretScrubber()
    const before = otherFrame()
    const after = frameOf([ClientOpcode.Version, 0x07, 0x41])
    expect(push(scrubber, [...before, ...loginFrame(), ...after])).toEqual([...before, ...after])
  })

  it('removes a CLogin frame that arrives one byte at a time', () => {
    const scrubber = createSecretScrubber()
    const kept: number[] = []
    for (const byte of [...loginFrame(), ...otherFrame()]) kept.push(...push(scrubber, [byte]))
    expect(kept).toEqual(otherFrame())
  })

  it('does not read a body byte as a frame marker', () => {
    // The body of otherFrame holds 0xAA twice. A walk that lost its place
    // there would treat the next bytes as a header and could drop good data.
    const scrubber = createSecretScrubber()
    expect(push(scrubber, otherFrame())).toEqual(otherFrame())
  })

  it('passes bytes through when it is not on a frame boundary', () => {
    const scrubber = createSecretScrubber()
    const noise = [0x01, 0x02, 0x03]
    expect(push(scrubber, [...noise, ...otherFrame()])).toEqual([...noise, ...otherFrame()])
  })

  it('holds a header back until the opcode after it arrives', () => {
    const scrubber = createSecretScrubber()
    const frame = loginFrame()
    // The marker and the two length bytes alone do not say what the frame is.
    expect(push(scrubber, frame.slice(0, 3))).toEqual([])
    expect(push(scrubber, frame.slice(3))).toEqual([])
  })

  it('does not treat a zero length as a header', () => {
    const scrubber = createSecretScrubber()
    const bytes = [0xaa, 0x00, 0x00, ClientOpcode.Login]
    expect(push(scrubber, bytes)).toEqual(bytes)
  })

  it('writes nothing more once the stream has a gap', () => {
    const scrubber = createSecretScrubber()
    push(scrubber, otherFrame())
    scrubber.onGap()
    expect(push(scrubber, otherFrame())).toEqual([])
    expect(push(scrubber, otherFrame())).toEqual([])
  })

  it('does not write the rest of a credential frame that a gap cut in half', () => {
    // The bytes after a hole are the rest of that frame's payload. The walk
    // has lost the count that would have discarded them, so passing them on
    // would write recoverable password material.
    const scrubber = createSecretScrubber()
    const frame = loginFrame()
    expect(push(scrubber, frame.slice(0, 6))).toEqual([])
    scrubber.onGap()
    expect(push(scrubber, frame.slice(14))).toEqual([])
  })

  it('does not let a stray marker after a gap carry a credential frame through', () => {
    // Encrypted payload bytes are near-uniform, so 0xAA turns up about every
    // 256 bytes. Read as a header it can claim up to 65535 bytes, which the
    // walk would once have copied without looking at them.
    const scrubber = createSecretScrubber()
    scrubber.onGap()
    const falseHeader = [0x00, FRAME_MARKER, 0x01, 0x00]
    expect(push(scrubber, [...falseHeader, ...loginFrame()])).toEqual([])
  })
})

describe('a recording', () => {
  let directory: string

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'midir-scrub-'))
  })

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  const chunksOf = async (path: string): Promise<StreamChunk[]> =>
    parseRecording(await readFile(path, 'utf8'))
      .filter((line): line is RecordingChunk => line.kind === 'chunk')
      .map(decodeChunk)

  it('never holds the account password', async () => {
    const path = join(directory, 'login.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 1 })
    recorder.onOpen?.(LOGIN)
    recorder.onChunk?.({
      connectionId: LOGIN.id,
      direction: 'clientToServer',
      bytes: Uint8Array.from(loginFrame()),
      timestampMs: 1200,
      gap: false
    })
    await recorder.close()

    // The whole frame is gone, so no key can recover anything from it.
    const written = (await chunksOf(path)).flatMap((chunk) => [...chunk.bytes])
    expect(written).toEqual([])

    // The file cannot hold the password in any form, encrypted or not.
    const text = await readFile(path, 'utf8')
    expect(text).not.toContain(PASSWORD)
    expect(text).not.toContain(Buffer.from(PASSWORD, 'latin1').toString('base64'))
  })

  it('holds no password when a gap cuts the login packet in half', async () => {
    // The reachable leak this guards: TCP reassembly gives up mid-frame, and
    // the tail of the login packet arrives as if it were fresh stream.
    const path = join(directory, 'gap.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 1 })
    const frame = loginFrame()
    const send = (bytes: number[], gap: boolean): void =>
      recorder.onChunk?.({
        connectionId: LOGIN.id,
        direction: 'clientToServer',
        bytes: Uint8Array.from(bytes),
        timestampMs: 1200,
        gap
      })

    send(frame.slice(0, 6), false)
    send(frame.slice(14), true)
    await recorder.close()

    expect((await chunksOf(path)).flatMap((chunk) => [...chunk.bytes])).toEqual([])
  })

  it('leaves the server direction alone', async () => {
    // Server opcode 0x03 is STransferServer, which Midir needs to read.
    const path = join(directory, 'redirect.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 1 })
    const bytes = frameOf([ServerOpcode.TransferServer, 0x01, 0x02])
    recorder.onChunk?.({
      connectionId: LOGIN.id,
      direction: 'serverToClient',
      bytes: Uint8Array.from(bytes),
      timestampMs: 1200,
      gap: false
    })
    await recorder.close()

    expect((await chunksOf(path)).flatMap((chunk) => [...chunk.bytes])).toEqual(bytes)
  })

  it('keeps every other client packet', async () => {
    const path = join(directory, 'client.ndjson')
    const recorder = await createRecorder(path, { startedAtMs: 0, now: () => 1 })
    const bytes = [...otherFrame(), ...loginFrame(), ...otherFrame()]
    recorder.onChunk?.({
      connectionId: LOGIN.id,
      direction: 'clientToServer',
      bytes: Uint8Array.from(bytes),
      timestampMs: 1200,
      gap: false
    })
    await recorder.close()

    expect((await chunksOf(path)).flatMap((chunk) => [...chunk.bytes])).toEqual([
      ...otherFrame(),
      ...otherFrame()
    ])
  })
})
