import { describe, expect, it } from 'vitest'
import { decodeClientTransfer, isPlaceholderName, parseRedirectToken } from '../../protocol/decode'
import { ClientOpcode, ServerOpcode } from '../../protocol/opcodes'
import type { PacketEvent } from '../../protocol/session'
import type { ConnectionInfo, StreamChunk } from '../source'
import { createSessionTracker, type TrackedEvent } from '../tracker'
import { frameOf, sessionBody } from './helpers'

/**
 * How Midir gets its keys on a live retail session.
 *
 * The bytes below are the real CTransferServer the retail client sent, taken
 * from a capture of an actual login. The character name is replaced, but every
 * structural byte is as it arrived.
 *
 * The client sends this on every connection it opens. It is raw, so it needs
 * no key to read, and it carries the whole cipher state for the connection it
 * arrives on. In that capture the server's own handshake was never seen at
 * all, and this packet was still enough.
 */

/**
 * A real CTransferServer body:
 *   [0x10][selector 02][keyLen 09][9-byte key][string8 name][u32 id][0x00]
 */
const REAL_TRANSFER = [
  0x10,
  0x02, // salt selector
  0x09, // key length
  0x72,
  0x4e,
  0x3c,
  0x41,
  0x66,
  0x3c,
  0x44,
  0x54,
  0x4f, // the connection's startup key
  0x07, // name length
  0x54,
  0x61,
  0x75,
  0x72,
  0x61,
  0x65,
  0x6c, // "Taurael"
  0x00,
  0x00,
  0x10,
  0x67, // redirect id
  0x00 // terminator, appended by the client's submission layer
]

const CHARACTER = 'Taurael'
const SALT_SELECTOR = 2
const CONNECTION_KEY = [0x72, 0x4e, 0x3c, 0x41, 0x66, 0x3c, 0x44, 0x54, 0x4f]

const world: ConnectionInfo = {
  id: 'world',
  localAddress: '192.168.50.218',
  localPort: 65034,
  remoteAddress: '52.88.55.94',
  remotePort: 2611,
  openedAtMs: 1000
}

const chunk = (body: number[], direction: StreamChunk['direction']): StreamChunk => ({
  connectionId: world.id,
  direction,
  bytes: Uint8Array.from(frameOf(body)),
  timestampMs: 2000,
  gap: false
})

const packetsOf = (events: TrackedEvent[]): unknown[] =>
  events.filter((e) => e.event.type === 'packet').map((e) => (e.event as PacketEvent).packet)

describe('decodeClientTransfer', () => {
  it('reads the whole cipher state out of a real retail packet', () => {
    const packet = decodeClientTransfer(Uint8Array.from(REAL_TRANSFER))
    expect(packet.saltSelector).toBe(SALT_SELECTOR)
    expect([...packet.startupKey!]).toEqual(CONNECTION_KEY)
    expect(packet.name).toBe(CHARACTER)
    expect(packet.redirectId).toBe(0x1067)
  })

  it('keeps the token whole even when it cannot be parsed', () => {
    const packet = decodeClientTransfer(Uint8Array.from([ClientOpcode.ClientJoin, 0xff, 0xff]))
    expect(packet.saltSelector).toBeUndefined()
    expect([...packet.token]).toEqual([0xff, 0xff])
  })
})

describe('parseRedirectToken', () => {
  it('rejects a selector outside the ten tables', () => {
    // Ten salt tables exist. A larger value means these are not token bytes.
    expect(parseRedirectToken(Uint8Array.from([0x0a, 0x09, ...new Array(9).fill(0)]))).toEqual({})
  })

  it('returns nothing rather than throwing on a short token', () => {
    expect(parseRedirectToken(Uint8Array.from([0x02]))).toEqual({})
  })
})

describe('the tracker keys a connection from the client transfer', () => {
  it('reads world packets after seeing only the client side of the handshake', () => {
    // This is the live retail case. No SVersionCheck and no STransferServer
    // were captured, because they happened before capture started. The client
    // transfer alone has to be enough.
    const events: TrackedEvent[] = []
    const tracker = createSessionTracker((event) => events.push(event))

    tracker.onOpen?.(world)
    tracker.onChunk?.(chunk(REAL_TRANSFER, 'clientToServer'))
    expect(tracker.keyNameOf(world.id)).toBe(CHARACTER)

    events.length = 0
    tracker.onChunk?.(
      chunk(
        sessionBody({
          plaintext: [ServerOpcode.RemoveInventory, 7],
          keyName: CHARACTER,
          saltSelector: SALT_SELECTOR,
          sequence: 9
        }),
        'serverToClient'
      )
    )
    expect(packetsOf(events)).toEqual([{ kind: 'removeInventory', slot: 7 }])
  })

  it('takes the salt selector from the token, not the default', () => {
    // The capture used selector 2. The default is 0.
    //
    // Table 2 is table 0 complemented, and most bytes take two salt XORs, so
    // the complements cancel and the two tables agree. They differ only in the
    // block whose index equals the sequence, where exactly one salt applies.
    // The packet below is long enough to contain that block, so the wrong
    // selector is visible here even though a short packet would hide it.
    const events: TrackedEvent[] = []
    const tracker = createSessionTracker((event) => events.push(event))

    tracker.onOpen?.(world)
    tracker.onChunk?.(chunk(REAL_TRANSFER, 'clientToServer'))

    const item = [
      ServerOpcode.AddInventory,
      3,
      0x00,
      0x09,
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

    events.length = 0
    tracker.onChunk?.(
      chunk(
        sessionBody({ plaintext: item, keyName: CHARACTER, saltSelector: 0, sequence: 0 }),
        'serverToClient'
      )
    )
    expect(packetsOf(events)).not.toContainEqual(
      expect.objectContaining({ kind: 'addInventory', name: 'Stick' })
    )

    // The same packet on the selector the token named reads correctly.
    events.length = 0
    tracker.onChunk?.(
      chunk(
        sessionBody({
          plaintext: item,
          keyName: CHARACTER,
          saltSelector: SALT_SELECTOR,
          sequence: 0
        }),
        'serverToClient'
      )
    )
    expect(packetsOf(events)).toContainEqual(
      expect.objectContaining({ kind: 'addInventory', slot: 3, name: 'Stick' })
    )
  })

  it('installs the connection key, so startup packets read too', () => {
    // The token's key is the startup key the server installed for this
    // connection. Without it every startup-mode packet decodes to rubbish.
    const tracker = createSessionTracker(() => undefined)
    tracker.onOpen?.(world)
    tracker.onChunk?.(chunk(REAL_TRANSFER, 'clientToServer'))
    expect([...tracker.activeConnections()]).toHaveLength(1)
    expect(tracker.keyNameOf(world.id)).toBe(CHARACTER)
  })
})

describe('the pre-login placeholder', () => {
  it('is used as a key seed but never becomes a character', () => {
    // The lobby hop is keyed from a placeholder such as socket[295]. Midir
    // must decrypt with it and must not file a character called that.
    const lobbyTransfer = [
      ClientOpcode.ClientJoin,
      0x02,
      0x09,
      ...CONNECTION_KEY,
      0x0b,
      ...[...'socket[295]'].map((c) => c.charCodeAt(0)),
      0x00,
      0x00,
      0x10,
      0x67,
      0x00
    ]

    const packet = decodeClientTransfer(Uint8Array.from(lobbyTransfer))
    expect(packet.name).toBe('socket[295]')
    expect(isPlaceholderName(packet.name!)).toBe(true)

    // The session still takes it, because it is the real seed for this hop.
    const tracker = createSessionTracker(() => undefined)
    tracker.onOpen?.(world)
    tracker.onChunk?.(chunk(lobbyTransfer, 'clientToServer'))
    expect(tracker.keyNameOf(world.id)).toBe('socket[295]')
  })
})
