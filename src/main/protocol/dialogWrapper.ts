import { crc16 } from './crc16'

/**
 * The dialog-response inner wrapper.
 *
 * Two client opcodes carry an extra protection layer *under* the ordinary
 * transform: `0x39` CMerchant and `0x3A` CPursuit. Nothing else does. The
 * client builds the wrapper first, then applies the transform the opcode
 * selects, then frames the result:
 *
 *   builder body -> inner wrapper -> session or startup transform -> frame
 *
 * So a body that decrypts cleanly and still matches no known layout is not a
 * decrypt failure. It is this layer, one level down.
 *
 * Sources: darkages-741-re/docs/network/packet-transforms.md, section
 * "Dialog-response inner wrapper"; the document repo's client/0x39 and
 * client/0x3A pages.
 *
 * The wrapper, where `payload` is the builder body after its opcode:
 *
 *   [u8 opcode][u8 random1][u8 encodedRandom2][u8 lengthHigh][u8 lengthLow]
 *   [encrypted inner][u8 0]
 *
 *   random2      = encodedRandom2 XOR ((random1 + 0xD3) & 0xFF)
 *   innerLength  = (lengthHigh XOR ((random2 + 0x72) & 0xFF)) << 8
 *                | (lengthLow  XOR ((random2 + 0x73) & 0xFF))
 *   plain inner  = [u16 big-endian crc16(payload)][payload]
 *   key          = (random2 + 0x28) & 0xFF, then + 1 for each byte, XORed over
 *                  the inner bytes
 *
 * Every input is in the packet, so the unwrap needs no key and no state.
 *
 * **The CRC is the test that this worked.** A wrong outer key gives a random
 * inner length and a CRC that does not match, which is why a failure here
 * usually means Midir never saw the connection's handshake.
 *
 * Verified against seven live retail session recordings: 102 of 105 wrapped
 * client packets unwrap with a matching CRC. The three that fail are all on
 * one connection that was already open when capture started, and plain `0x43`
 * on that same connection decrypts to rubbish as well.
 */

/** The opcode, the two random bytes, and the two length bytes. */
const WRAPPER_HEADER_LENGTH = 5

/** The big-endian CRC that leads the inner block. */
const INNER_CRC_LENGTH = 2

/**
 * Unwrap one dialog response.
 *
 * `body` is the outer-decrypted body, opcode first. The result is the builder's
 * own body, also opcode first, so the per-opcode layouts apply to it unchanged.
 *
 * Returns null when the body is too short, when the encoded length does not fit
 * inside it, or when the CRC does not match.
 *
 * The bytes after the inner block are not returned. They are the wrapper's
 * literal zero and, on `0x39`, one scratch byte after it — the copy routine
 * writes past the meaningful segment. Live captures show `00` on `0x3A` and
 * `00 39` on `0x39`. Neither is a field.
 */
export function unwrapDialogResponse(body: Uint8Array): Uint8Array | null {
  if (body.length < WRAPPER_HEADER_LENGTH + INNER_CRC_LENGTH) return null

  const random2 = body[2]! ^ ((body[1]! + 0xd3) & 0xff)
  const innerLength =
    ((body[3]! ^ ((random2 + 0x72) & 0xff)) << 8) | (body[4]! ^ ((random2 + 0x73) & 0xff))

  if (innerLength < INNER_CRC_LENGTH) return null
  if (WRAPPER_HEADER_LENGTH + innerLength > body.length) return null

  const inner = body.slice(WRAPPER_HEADER_LENGTH, WRAPPER_HEADER_LENGTH + innerLength)
  let key = (random2 + 0x28) & 0xff
  for (let i = 0; i < inner.length; i++) {
    inner[i] = inner[i]! ^ key
    key = (key + 1) & 0xff
  }

  const expected = (inner[0]! << 8) | inner[1]!
  const payload = inner.subarray(INNER_CRC_LENGTH)
  if (crc16(payload) !== expected) return null

  const plain = new Uint8Array(1 + payload.length)
  plain[0] = body[0]!
  plain.set(payload, 1)
  return plain
}
