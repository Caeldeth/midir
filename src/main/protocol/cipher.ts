import { createHash } from 'node:crypto'

/**
 * The Dark Ages packet cipher.
 *
 * Midir only decrypts. It never encrypts, because it never sends a packet.
 *
 * Sources, which agree with each other:
 *   - darkages-741-re/docs/network/packet-transforms.md
 *   - darkages-741-re/legacy/docs/client/packet-crypto-and-crc.md
 *   - the document repo's docs/protocol/PROTOCOL.md
 *
 * Three transform modes exist. The opcode selects the mode, and the two
 * directions have different opcode lists (see opcodes.ts).
 *
 *   None    — the body is on the wire as written.
 *   Startup — a fixed key. The server can replace it in SVersionCheck 0x00.
 *   Session — a nine-byte key built for each packet from the character name.
 *
 * Decryption is stateless for each packet. Every encrypted packet carries its
 * own sequence byte and its own seed bytes, so a dropped packet does not stop
 * the next packet from decoding.
 */

/** The key length, and the block size of the salt stage. */
export const KEY_LENGTH = 9

/**
 * The key the client installs before the handshake supplies a real one.
 *
 * The constructor builds it from the readable text `UrkcnItnI`, then replaces
 * bytes 3 and 7. Reading the source text alone is therefore misleading.
 */
export const STARTUP_KEY = new Uint8Array([0x55, 0x72, 0x6b, 0xe5, 0x6e, 0x49, 0x74, 0xa3, 0x49])

/** The number of salt-table selectors the client accepts. */
export const SALT_TABLE_COUNT = 10

/** The length of the character-name MD5 expansion, in ASCII bytes. */
export const MD5_SOURCE_LENGTH = 1024

/**
 * Build one of the ten salt tables.
 *
 * The client generates 256 byte values from a formula. It does not load ten
 * literal arrays. `selector` comes from SVersionCheck 0x00 or from the
 * STransferServer 0x03 redirect. Selector 0 is the default, and it is the
 * identity table.
 *
 * @throws if `selector` is outside 0 through 9.
 */
export function buildSaltTable(selector: number): Uint8Array {
  if (!Number.isInteger(selector) || selector < 0 || selector >= SALT_TABLE_COUNT) {
    throw new RangeError(`salt table selector must be 0 through 9, got ${selector}`)
  }
  const table = new Uint8Array(256)
  for (let i = 0; i < 256; i++) table[i] = saltValue(selector, i) & 0xff
  return table
}

function saltValue(selector: number, i: number): number {
  switch (selector) {
    case 0:
      return i
    case 1:
      return 0x80 + (i % 2 === 0 ? Math.ceil(i / 2) : -Math.ceil(i / 2))
    case 2:
      return 0xff - i
    case 3:
      return i % 2 === 0 ? 0xff - i / 2 : (i + 1) / 2
    case 4:
      return Math.trunc(i / 16) ** 2
    case 5:
      return 2 * i
    case 6:
      return 0xff - ((2 * i) & 0xff)
    case 7:
      return i <= 0x7f ? 0xff - 2 * i : 2 * i - 0x100
    case 8:
      return i <= 0x7f ? 2 * i : 0x1ff - 2 * i
    default:
      // Signed division that truncates toward zero, then squared.
      return 0xff - ((Math.trunc((i - 0x80) / 8) ** 2) & 0xff)
  }
}

/** All ten salt tables, built once. */
const SALT_TABLES: Uint8Array[] = Array.from({ length: SALT_TABLE_COUNT }, (_, s) =>
  buildSaltTable(s)
)

/** Return the cached salt table for `selector`. */
export function saltTable(selector: number): Uint8Array {
  const table = SALT_TABLES[selector]
  if (table === undefined) {
    throw new RangeError(`salt table selector must be 0 through 9, got ${selector}`)
  }
  return table
}

function md5Hex(input: string): string {
  return createHash('md5').update(input, 'latin1').digest('hex')
}

/**
 * Build the 1024-byte source that the session key is selected from.
 *
 * The input is the character name. The result is 1024 lowercase ASCII
 * hexadecimal characters, not 512 decoded bytes.
 *
 *   table = md5Hex(md5Hex(name))
 *   repeat 31 times: table = table + md5Hex(table)
 */
export function buildMd5Source(characterName: string): Uint8Array {
  let table = md5Hex(md5Hex(characterName))
  for (let i = 0; i < 31; i++) table += md5Hex(table)

  const source = new Uint8Array(MD5_SOURCE_LENGTH)
  for (let i = 0; i < MD5_SOURCE_LENGTH; i++) source[i] = table.charCodeAt(i) & 0xff
  return source
}

/**
 * Select the nine-byte session key for one packet.
 *
 * `seed16` and `seed8` are random values that the sender chose for this packet
 * and wrote into the packet's own trailer.
 */
export function selectSessionKey(md5Source: Uint8Array, seed16: number, seed8: number): Uint8Array {
  const key = new Uint8Array(KEY_LENGTH)
  for (let i = 0; i < KEY_LENGTH; i++) {
    key[i] = md5Source[(seed16 + (seed8 * seed8 + 9 * i) * i) & 0x3ff]!
  }
  return key
}

/**
 * Apply the common XOR transform to `payload`, in place.
 *
 * The transform is its own inverse, so this both encrypts and decrypts.
 *
 * For every payload byte, where `b` is the index of its nine-byte block:
 *   1. XOR with the repeating key.
 *   2. XOR with `salt[b]`.
 *   3. XOR with `salt[sequence]`, except when `b` equals `sequence`.
 *
 * The exception in step 3 is necessary. When `b` equals `sequence`, the two
 * salt values are the same byte, so applying both would cancel them. Exactly
 * one salt XOR must survive.
 *
 * The client's own description states the same rule the other way round: skip
 * step 2 when `b` equals `sequence`, then apply step 3 to every byte. Both
 * forms produce the same output.
 */
export function applyXorTransform(
  payload: Uint8Array,
  key: Uint8Array,
  salt: Uint8Array,
  sequence: number
): void {
  const keyLength = key.length
  for (let i = 0; i < payload.length; i++) {
    const block = Math.trunc(i / keyLength) % salt.length
    let value = payload[i]! ^ key[i % keyLength]! ^ salt[block]!
    if (block !== sequence) value ^= salt[sequence]!
    payload[i] = value
  }
}

/** The per-packet seeds recovered from an encrypted body's trailer. */
export interface PacketSeeds {
  seed16: number
  seed8: number
}

/**
 * The trailer mask constants differ by direction. The client applies one set
 * when it sends and expects the other set when it receives.
 */
const TRAILER_MASKS = {
  /** Client to server: low ^ 0x70, seed8 ^ 0x23, high ^ 0x74. */
  clientToServer: { low: 0x70, seed8: 0x23, high: 0x74 },
  /** Server to client: low ^ 0x74, seed8 ^ 0x24, high ^ 0x64. */
  serverToClient: { low: 0x74, seed8: 0x24, high: 0x64 }
} as const

export type Direction = keyof typeof TRAILER_MASKS

/** The number of trailer bytes that carry the seeds. */
export const SEED_TRAILER_LENGTH = 3

/**
 * The number of integrity bytes that follow the payload in the client
 * direction. They are four selected MD5 digest bytes, not a CRC. The client's
 * own receive path does not verify them, and Midir does not either.
 */
export const CLIENT_INTEGRITY_LENGTH = 4

/** Read the two seeds out of the last three bytes of an encrypted body. */
export function readSeeds(body: Uint8Array, direction: Direction): PacketSeeds {
  if (body.length < SEED_TRAILER_LENGTH) {
    throw new RangeError(`body of ${body.length} bytes is too short to carry a seed trailer`)
  }
  const mask = TRAILER_MASKS[direction]
  const at = body.length - SEED_TRAILER_LENGTH
  const low = body[at]! ^ mask.low
  const seed8 = body[at + 1]! ^ mask.seed8
  const high = body[at + 2]! ^ mask.high
  return { seed16: (high << 8) | low, seed8 }
}

/** What a decryption attempt needs to know about the connection. */
export interface CipherState {
  /** The salt-table selector for this connection, 0 through 9. */
  saltSelector: number
  /** The startup key for this connection. */
  startupKey: Uint8Array
  /**
   * The character-name expansion, once the character name is known. Session
   * packets cannot be decrypted before it exists.
   */
  md5Source?: Uint8Array
}

/**
 * Decrypt one startup-key body.
 *
 * `body` is the framed body, opcode first. The result is the plaintext body,
 * also opcode first.
 */
export function decryptStartup(
  body: Uint8Array,
  state: CipherState,
  direction: Direction
): Uint8Array {
  return decrypt(body, state.startupKey, state, direction)
}

/**
 * Decrypt one session-key body.
 *
 * @throws if the character name is not known yet.
 */
export function decryptSession(
  body: Uint8Array,
  state: CipherState,
  direction: Direction
): Uint8Array {
  if (state.md5Source === undefined) {
    throw new Error('cannot decrypt a session packet before the character name is known')
  }
  const seeds = readSeeds(body, direction)
  const key = selectSessionKey(state.md5Source, seeds.seed16, seeds.seed8)
  return decrypt(body, key, state, direction)
}

/**
 * The shared body layout of both encrypted modes.
 *
 *   [opcode][sequence][encrypted payload][integrity, client direction only][seeds]
 */
function decrypt(
  body: Uint8Array,
  key: Uint8Array,
  state: CipherState,
  direction: Direction
): Uint8Array {
  const trailer =
    SEED_TRAILER_LENGTH + (direction === 'clientToServer' ? CLIENT_INTEGRITY_LENGTH : 0)
  const headerLength = 2 // opcode + sequence
  if (body.length < headerLength + trailer) {
    throw new RangeError(`encrypted body of ${body.length} bytes is too short to decrypt`)
  }

  const opcode = body[0]!
  const sequence = body[1]!
  const payload = body.slice(headerLength, body.length - trailer)
  applyXorTransform(payload, key, saltTable(state.saltSelector), sequence)

  const plain = new Uint8Array(1 + payload.length)
  plain[0] = opcode
  plain.set(payload, 1)
  return plain
}
