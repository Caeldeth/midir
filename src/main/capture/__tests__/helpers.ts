import {
  applyXorTransform,
  buildMd5Source,
  CLIENT_INTEGRITY_LENGTH,
  saltTable,
  selectSessionKey,
  SEED_TRAILER_LENGTH,
  STARTUP_KEY
} from '../../protocol/cipher'
import { FRAME_MARKER } from '../../protocol/frame'
import { ServerOpcode } from '../../protocol/opcodes'
import { DataLink, TcpFlag } from '../packet'

/** Test helpers shared by the capture tests. */

export const u16 = (value: number): number[] => [(value >> 8) & 0xff, value & 0xff]

export const u32 = (value: number): number[] => [
  (value >>> 24) & 0xff,
  (value >>> 16) & 0xff,
  (value >>> 8) & 0xff,
  value & 0xff
]

export const str8 = (text: string): number[] => [
  text.length,
  ...[...text].map((c) => c.charCodeAt(0))
]

/** Wrap a plaintext body in the binary frame the protocol uses. */
export function frameOf(body: number[]): number[] {
  return [FRAME_MARKER, ...u16(body.length), ...body]
}

/** Build a server-direction session-key body. */
export function sessionBody(options: {
  plaintext: number[]
  keyName: string
  saltSelector?: number
  sequence?: number
  seed16?: number
  seed8?: number
}): number[] {
  const saltSelector = options.saltSelector ?? 0
  const sequence = options.sequence ?? 0
  const seed16 = options.seed16 ?? 0x0100
  const seed8 = options.seed8 ?? 0x64
  const key = selectSessionKey(buildMd5Source(options.keyName), seed16, seed8)

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
  return [...body]
}

/**
 * Build a client-direction startup-key body.
 *
 * The client direction carries four integrity bytes between the payload and
 * the seed trailer. Startup decryption uses the connection's startup key, so
 * neither the integrity bytes nor the seeds are read. They are left as zeros.
 */
export function startupBody(options: {
  plaintext: number[]
  saltSelector?: number
  sequence?: number
  startupKey?: Uint8Array
}): number[] {
  const sequence = options.sequence ?? 0
  const key = options.startupKey ?? STARTUP_KEY

  const payload = Uint8Array.from(options.plaintext.slice(1))
  applyXorTransform(payload, key, saltTable(options.saltSelector ?? 0), sequence)

  const body = new Uint8Array(2 + payload.length + CLIENT_INTEGRITY_LENGTH + SEED_TRAILER_LENGTH)
  body[0] = options.plaintext[0]!
  body[1] = sequence
  body.set(payload, 2)
  return [...body]
}

/** The plaintext body of an STransferServer that points at a destination. */
export function redirectBody(options: {
  address: string
  port: number
  name: string
  saltSelector?: number
  startupKey?: number[]
}): number[] {
  const key = options.startupKey ?? [...STARTUP_KEY]
  const token = [
    options.saltSelector ?? 0,
    key.length,
    ...key,
    ...str8(options.name),
    ...u32(0x1234)
  ]
  return [
    ServerOpcode.TransferServer,
    ...options.address.split('.').map(Number).reverse(),
    ...u16(options.port),
    token.length,
    ...token
  ]
}

export interface SegmentOptions {
  source: string
  sourcePort: number
  destination: string
  destinationPort: number
  sequence?: number
  flags?: number
  payload?: number[]
}

/** Build a captured Ethernet frame carrying one TCP segment. */
export function ethernetFrame(options: SegmentOptions): Buffer {
  const payload = options.payload ?? []
  const tcp = [
    ...u16(options.sourcePort),
    ...u16(options.destinationPort),
    ...u32(options.sequence ?? 1),
    ...u32(0),
    0x50, // twenty-byte header
    options.flags ?? TcpFlag.Psh | TcpFlag.Ack,
    ...u16(65535),
    ...u16(0),
    ...u16(0)
  ]
  const ipv4 = [
    0x45,
    0x00,
    ...u16(20 + tcp.length + payload.length),
    ...u16(0),
    0x40,
    0x00,
    64,
    6,
    ...u16(0),
    ...options.source.split('.').map(Number),
    ...options.destination.split('.').map(Number),
    ...tcp,
    ...payload
  ]
  return Buffer.from([
    ...new Array<number>(6).fill(0x11),
    ...new Array<number>(6).fill(0x22),
    0x08,
    0x00,
    ...ipv4
  ])
}

export const ETHERNET = DataLink.Ethernet
