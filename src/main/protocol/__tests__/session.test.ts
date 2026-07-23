import { describe, expect, it } from 'vitest'
import {
  applyXorTransform,
  buildMd5Source,
  saltTable,
  selectSessionKey,
  SEED_TRAILER_LENGTH,
  STARTUP_KEY,
  type Direction
} from '../cipher'
import { FRAME_MARKER } from '../frame'
import { ServerOpcode } from '../opcodes'
import {
  createProtocolSession,
  sessionFromRedirect,
  type PacketEvent,
  type SessionEvent,
  type UnreadableEvent
} from '../session'
import { decodeTransferServer } from '../decode'

const CHARACTER = 'Sabrael'

const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]
const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff
]
const str8 = (text: string): number[] => [text.length, ...[...text].map((c) => c.charCodeAt(0))]

/** Wrap a body in the binary frame. */
function frame(body: number[] | Uint8Array): Uint8Array {
  const bytes = [...body]
  return Uint8Array.from([FRAME_MARKER, ...u16(bytes.length), ...bytes])
}

/** Build a server-direction session-key body the way the server would. */
function sessionBody(options: {
  plaintext: number[]
  keyName?: string
  saltSelector?: number
  sequence?: number
  seed16?: number
  seed8?: number
}): Uint8Array {
  const saltSelector = options.saltSelector ?? 0
  const sequence = options.sequence ?? 0
  const seed16 = options.seed16 ?? 0x0100
  const seed8 = options.seed8 ?? 0x64
  const key = selectSessionKey(buildMd5Source(options.keyName ?? CHARACTER), seed16, seed8)

  const payload = Uint8Array.from(options.plaintext.slice(1))
  applyXorTransform(payload, key, saltTable(saltSelector), sequence)

  const body = new Uint8Array(2 + payload.length + SEED_TRAILER_LENGTH)
  body[0] = options.plaintext[0]!
  body[1] = sequence
  body.set(payload, 2)
  const at = body.length - SEED_TRAILER_LENGTH
  body[at] = (seed16 & 0xff) ^ 0x74
  body[at + 1] = seed8 ^ 0x24
  body[at + 2] = ((seed16 >> 8) & 0xff) ^ 0x64
  return body
}

/** Build a server-direction startup-key body. */
function startupBody(plaintext: number[], sequence = 0, key = STARTUP_KEY): Uint8Array {
  const payload = Uint8Array.from(plaintext.slice(1))
  applyXorTransform(payload, key, saltTable(0), sequence)
  const body = new Uint8Array(2 + payload.length + SEED_TRAILER_LENGTH)
  body[0] = plaintext[0]!
  body[1] = sequence
  body.set(payload, 2)
  const at = body.length - SEED_TRAILER_LENGTH
  body[at] = 0x00 ^ 0x74
  body[at + 1] = 0x64 ^ 0x24
  body[at + 2] = 0x01 ^ 0x64
  return body
}

/**
 * Build a client-direction session-key body.
 *
 * The client direction adds four integrity bytes before the seed trailer. The
 * client's own receive path does not check them and Midir does not either, so
 * a test can leave them zero.
 */
function clientSessionBody(options: {
  plaintext: number[] | Uint8Array
  keyName?: string
  sequence?: number
  seed16?: number
  seed8?: number
}): Uint8Array {
  const sequence = options.sequence ?? 0
  const seed16 = options.seed16 ?? 0x0100
  const seed8 = options.seed8 ?? 0x64
  const key = selectSessionKey(buildMd5Source(options.keyName ?? CHARACTER), seed16, seed8)

  const plaintext = [...options.plaintext]
  const payload = Uint8Array.from(plaintext.slice(1))
  applyXorTransform(payload, key, saltTable(0), sequence)

  const body = new Uint8Array(2 + payload.length + 4 + SEED_TRAILER_LENGTH)
  body[0] = plaintext[0]!
  body[1] = sequence
  body.set(payload, 2)
  const at = body.length - SEED_TRAILER_LENGTH
  body[at] = (seed16 & 0xff) ^ 0x70
  body[at + 1] = seed8 ^ 0x23
  body[at + 2] = ((seed16 >> 8) & 0xff) ^ 0x74
  return body
}

/**
 * A live CMerchant 0x39 after the session transform came off and before the
 * dialog wrapper did. It asks a banker for the withdraw list.
 */
const WRAPPED_BANK_REQUEST = Uint8Array.from([
  0x39, 0xb7, 0xca, 0xb2, 0xba, 0x4c, 0x79, 0x6b, 0x6b, 0x6c, 0x72, 0x01, 0x6f, 0x35, 0x00, 0x39
])

const REMOVE_INVENTORY = [ServerOpcode.RemoveInventory, 7]

const packets = (events: SessionEvent[]): PacketEvent[] =>
  events.filter((e): e is PacketEvent => e.type === 'packet')
const unreadable = (events: SessionEvent[]): UnreadableEvent[] =>
  events.filter((e): e is UnreadableEvent => e.type === 'unreadable')

const S2C: Direction = 'serverToClient'
const C2S: Direction = 'clientToServer'

describe('createProtocolSession', () => {
  it('reads a raw packet without a key', () => {
    const session = createProtocolSession()
    const body = [
      ServerOpcode.VersionCheck,
      0x00,
      ...u32(0),
      0x03,
      0x09,
      ...new Array(9).fill(0x41)
    ]
    const events = session.push(S2C, frame(body))
    expect(packets(events)).toHaveLength(1)
    expect(packets(events)[0]!.packet).toMatchObject({
      kind: 'versionCheck',
      keyUpdate: { saltSelector: 3 }
    })
  })

  it('takes the salt selector and startup key from SVersionCheck', () => {
    const session = createProtocolSession()
    expect(session.state.saltSelector).toBe(0)

    const newKey = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]
    session.push(
      S2C,
      frame([ServerOpcode.VersionCheck, 0x00, ...u32(0xabcd), 0x07, newKey.length, ...newKey])
    )

    expect(session.state.saltSelector).toBe(7)
    expect([...session.state.startupKey]).toEqual(newKey)
  })

  it('decrypts a startup-key packet with the key the handshake installed', () => {
    const session = createProtocolSession()
    const newKey = Uint8Array.from([9, 8, 7, 6, 5, 4, 3, 2, 1])
    session.push(
      S2C,
      frame([ServerOpcode.VersionCheck, 0x00, ...u32(0), 0x00, newKey.length, ...newKey])
    )

    // 0x0A is a startup-key server opcode. Midir has no decoder for it, so it
    // must report notModelled — which proves decryption itself succeeded.
    const message = [0x0a, 0x03, ...[...'hi!'].map((c) => c.charCodeAt(0))]
    const events = session.push(S2C, frame(startupBody(message, 0, newKey)))
    const [event] = unreadable(events)
    expect(event!.reason).toBe('notModelled')
    expect([...event!.body!]).toEqual(message)
  })

  it('cannot read a session packet before the character name is known', () => {
    const session = createProtocolSession()
    const events = session.push(S2C, frame(sessionBody({ plaintext: REMOVE_INVENTORY })))
    expect(packets(events)).toHaveLength(0)
    expect(unreadable(events)[0]!.reason).toBe('noSessionKey')
  })

  it('reads session packets once the character name is set', () => {
    const session = createProtocolSession()
    session.setKeyName(CHARACTER)
    const events = session.push(S2C, frame(sessionBody({ plaintext: REMOVE_INVENTORY })))
    expect(packets(events)[0]!.packet).toEqual({ kind: 'removeInventory', slot: 7 })
  })

  it('starts from the salt selector and name it was given', () => {
    const session = createProtocolSession({ saltSelector: 6, keyName: CHARACTER })
    const events = session.push(
      S2C,
      frame(sessionBody({ plaintext: REMOVE_INVENTORY, saltSelector: 6, sequence: 42 }))
    )
    expect(packets(events)[0]!.packet).toEqual({ kind: 'removeInventory', slot: 7 })
  })

  it('reads several packets that arrive in one chunk', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const chunk = new Uint8Array([
      ...frame(sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 1], sequence: 1 })),
      ...frame(sessionBody({ plaintext: [ServerOpcode.RemoveEquip, 2], sequence: 2 })),
      ...frame(sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 3], sequence: 3 }))
    ])
    expect(packets(session.push(S2C, chunk)).map((e) => e.packet)).toEqual([
      { kind: 'removeInventory', slot: 1 },
      { kind: 'removeEquip', slot: 2 },
      { kind: 'removeInventory', slot: 3 }
    ])
  })

  it('joins a packet split across two chunks', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const whole = frame(sessionBody({ plaintext: REMOVE_INVENTORY }))
    expect(session.push(S2C, whole.slice(0, 5))).toEqual([])
    expect(packets(session.push(S2C, whole.slice(5)))[0]!.packet).toEqual({
      kind: 'removeInventory',
      slot: 7
    })
  })

  it('reads a stream it joined late, at any sequence and any seeds', () => {
    // A packet carries its own sequence and its own seeds, so decoding it does
    // not need the packets before it. A session that starts in the middle of a
    // connection reads the next packet, as long as it has the character name.
    const session = createProtocolSession({ keyName: CHARACTER, saltSelector: 9 })
    const events = session.push(
      S2C,
      frame(
        sessionBody({
          plaintext: [ServerOpcode.RemoveInventory, 2],
          saltSelector: 9,
          sequence: 217,
          seed16: 0x3f4f,
          seed8: 0x88
        })
      )
    )
    expect(packets(events).map((e) => e.packet)).toEqual([{ kind: 'removeInventory', slot: 2 }])
  })

  it('resynchronises after leading rubbish', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const good = frame(sessionBody({ plaintext: REMOVE_INVENTORY }))
    const events = session.push(S2C, new Uint8Array([0x01, 0x02, 0x03, ...good]))
    expect(packets(events)[0]!.packet).toEqual({ kind: 'removeInventory', slot: 7 })
    expect(session.droppedBytes(S2C)).toBe(3)
  })

  it('desynchronises when a frame is cut short mid-stream, until it is reset', () => {
    // A truncated frame header is indistinguishable from a longer frame: the
    // reader waits for the byte count the header declared, and swallows the
    // frames that follow. Nothing in the byte stream can tell the two apart.
    //
    // This is why the capture layer must call reset() when TCP reassembly sees
    // a hole. The stream reader cannot detect a hole on its own.
    const session = createProtocolSession({ keyName: CHARACTER })
    const cutShort = frame(sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 1] }))
    const next = frame(sessionBody({ plaintext: [ServerOpcode.RemoveEquip, 2], sequence: 1 }))

    const confused = session.push(S2C, new Uint8Array([...cutShort.slice(0, 4), ...next]))
    expect(confused.map((e) => e.type === 'packet' && e.packet)).not.toEqual([
      { kind: 'removeEquip', slot: 2 }
    ])

    // After a reset the very next whole frame reads correctly again.
    session.reset()
    const recovered = session.push(
      S2C,
      frame(sessionBody({ plaintext: [ServerOpcode.RemoveEquip, 2], sequence: 1 }))
    )
    expect(packets(recovered)[0]!.packet).toEqual({ kind: 'removeEquip', slot: 2 })
  })

  it('marks the greeting as unreadable and does not try to decrypt it', () => {
    const session = createProtocolSession()
    const greeting = [ServerOpcode.Hello, 0x1b, 0x43, 0x48, 0x69]
    const [event] = unreadable(session.push(S2C, frame(greeting)))
    expect(event!.reason).toBe('greeting')
    expect(event!.name).toBe('Hello')
  })

  it('takes the dialog wrapper off a client menu answer', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const body = clientSessionBody({ plaintext: WRAPPED_BANK_REQUEST })
    const [event] = packets(session.push(C2S, frame(body)))
    expect(event!.packet).toMatchObject({
      kind: 'merchantResponse',
      objectId: 0x1f6f,
      pursuit: 0x45
    })
    // The body kept for the inspector is the plaintext, wrapper and all off.
    expect([...event!.body]).toEqual([0x39, 0x01, 0x00, 0x00, 0x1f, 0x6f, 0x00, 0x45])
  })

  it('reports a wrapped packet it cannot unwrap as a decryption failure', () => {
    // The wrong key gives a clean decrypt and a wrapper that does not verify.
    // That is what a connection Midir joined late looks like.
    const session = createProtocolSession({ keyName: 'Somebody Else' })
    const body = clientSessionBody({ plaintext: WRAPPED_BANK_REQUEST, keyName: CHARACTER })
    const [event] = unreadable(session.push(C2S, frame(body)))
    expect(event!.reason).toBe('decryptFailed')
    expect(event!.error).toMatch(/wrapper/)
  })

  it('reports a decode failure without stopping the next packet', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    // An SAddInventory body that stops in the middle of its fields.
    const broken = sessionBody({ plaintext: [ServerOpcode.AddInventory, 1, 0x00], sequence: 1 })
    const good = sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 4], sequence: 2 })

    const events = session.push(S2C, new Uint8Array([...frame(broken), ...frame(good)]))
    expect(unreadable(events)[0]!.reason).toBe('decodeFailed')
    expect(unreadable(events)[0]!.error).toMatch(/too short/)
    expect(packets(events)[0]!.packet).toEqual({ kind: 'removeInventory', slot: 4 })
  })

  it('reports an opcode it does not model, and keeps the plaintext', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const body = sessionBody({ plaintext: [0x0c, 0x01, 0x02, 0x03] })
    const [event] = unreadable(session.push(S2C, frame(body)))
    expect(event!.reason).toBe('notModelled')
    expect(event!.name).toBe('0x0c')
    expect([...event!.body!]).toEqual([0x0c, 0x01, 0x02, 0x03])
  })

  it('keeps the two directions apart', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    // 0x10 is raw from the client and a session packet from the server. The
    // same bytes must be read differently in each direction.
    const clientJoin = [0x10, 0x01, 0x02]
    const [clientEvent] = session.push(C2S, frame(clientJoin))
    expect(clientEvent!.transform).toBe('none')

    const [serverEvent] = session.push(
      S2C,
      frame(sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 1] }))
    )
    expect(serverEvent!.transform).toBe('session')
  })

  it('buffers each direction separately', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const server = frame(sessionBody({ plaintext: REMOVE_INVENTORY }))
    session.push(S2C, server.slice(0, 4))
    session.push(C2S, frame([0x10, 0xff]))
    expect(packets(session.push(S2C, server.slice(4)))[0]!.packet).toEqual({
      kind: 'removeInventory',
      slot: 7
    })
  })

  it('forgets buffered tails on reset', () => {
    const session = createProtocolSession({ keyName: CHARACTER })
    const whole = frame(sessionBody({ plaintext: REMOVE_INVENTORY }))
    session.push(S2C, whole.slice(0, 5))
    session.reset()
    expect(session.push(S2C, whole.slice(5))).toEqual([])
  })
})

describe('sessionFromRedirect', () => {
  /** The redirect the login server sends to hand the client to the world server. */
  function worldRedirect(name: string, saltSelector = 4): Uint8Array {
    const key = [0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29]
    const token = [saltSelector, key.length, ...key, ...str8(name), ...u32(0x1234)]
    return Uint8Array.from([
      ServerOpcode.TransferServer,
      10,
      0,
      0,
      127,
      ...u16(2612),
      token.length,
      ...token
    ])
  }

  it('carries the character name forward, so the world session decrypts', () => {
    const redirect = decodeTransferServer(worldRedirect(CHARACTER))
    expect(redirect.name).toBe(CHARACTER)

    const world = sessionFromRedirect(redirect)
    expect(world.state.keyName).toBe(CHARACTER)
    expect(world.state.saltSelector).toBe(4)

    const events = world.push(
      S2C,
      frame(sessionBody({ plaintext: REMOVE_INVENTORY, saltSelector: 4, sequence: 3 }))
    )
    expect(packets(events)[0]!.packet).toEqual({ kind: 'removeInventory', slot: 7 })
  })

  it('falls back to the defaults when the token did not parse', () => {
    const session = sessionFromRedirect({
      kind: 'transferServer',
      address: '127.0.0.1',
      port: 2611,
      token: new Uint8Array(0)
    })
    expect(session.state.saltSelector).toBe(0)
    expect([...session.state.startupKey]).toEqual([...STARTUP_KEY])
    expect(session.state.md5Source).toBeUndefined()
  })

  it('does not change the session the redirect arrived on', () => {
    // A redirect describes the NEXT connection. Applying it to the current one
    // would break every packet still in flight on it.
    const login = createProtocolSession({ saltSelector: 1, keyName: 'socket[256]' })
    login.push(S2C, frame(worldRedirect(CHARACTER, 4)))
    expect(login.state.saltSelector).toBe(1)
    expect(login.state.keyName).toBe('socket[256]')
  })
})
