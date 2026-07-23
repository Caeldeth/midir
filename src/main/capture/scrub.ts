import { FRAME_HEADER_LENGTH, FRAME_MARKER } from '../protocol/frame'
import { ClientOpcode } from '../protocol/opcodes'

/**
 * Keep the account password out of a session recording.
 *
 * A recording is a copy of the bytes the game client exchanged with the
 * server, so it holds the CLogin 0x03 packet. That packet carries the account
 * password, and the key it is encrypted with is a constant. Anybody who reads
 * the file can recover the password. A recording is a developer aid that a
 * user is asked to send to somebody else, so the password must never reach the
 * file at all.
 *
 * The scrubber drops the whole CLogin frame. It does not blank the password
 * field inside the frame, because that would need the connection's startup key
 * and a re-encryption step. Dropping the frame is exact and needs no key:
 *
 *   - The frame header states the frame's length, so the frame's extent is
 *     known from three bytes.
 *   - The opcode is the first body byte and the cipher leaves it in the clear,
 *     so the frame is identified without decrypting anything.
 *
 * Dropping a whole packet is safe for everything downstream:
 *
 *   - Decryption is stateless for each packet, so no later packet depends on
 *     this one. See cipher.ts.
 *   - CLogin is only a second source for the character name. The first source
 *     is CTransferServer 0x10, which is raw and arrives on every connection.
 *     See session.ts.
 *
 * **This works on the client-to-server direction only.** Server opcode 0x03 is
 * STransferServer, which Midir needs.
 */

/** A rewriter for one direction of one connection. */
export interface StreamScrubber {
  /**
   * Take the next run of stream bytes and return the bytes to record. The
   * result is the input with any CLogin frame removed. It can be empty, and it
   * can be shorter than the input for a second reason: up to three bytes of a
   * frame header are held back until the opcode after them arrives.
   */
  push(bytes: Uint8Array): Uint8Array
  /**
   * Forget the position in the stream. Call this on a gap, because the bytes
   * that were counted off no longer describe what arrives next.
   */
  reset(): void
}

const EMPTY = new Uint8Array(0)

/** The marker, the two length bytes, and the opcode after them. */
const DECISION_LENGTH = FRAME_HEADER_LENGTH + 1

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  if (head.length === 0) return tail
  const merged = new Uint8Array(head.length + tail.length)
  merged.set(head, 0)
  merged.set(tail, head.length)
  return merged
}

/**
 * Create a scrubber for the client-to-server direction of one connection.
 *
 * The scrubber walks frames. Bytes that are not on a frame boundary pass
 * through unchanged: a recording must not lose data that cannot be classified.
 * That means a capture that starts in the middle of a login could pass a CLogin
 * frame through. The login server connection opens fresh, so its first byte is
 * a frame boundary and the walk stays aligned from there.
 */
export function createLoginScrubber(): StreamScrubber {
  /** Bytes of a frame header that arrived without the opcode after them. */
  let carry = EMPTY
  /** Body bytes still to copy. They are never read as a marker. */
  let passRemaining = 0
  /** Bytes of a CLogin frame still to discard. */
  let dropRemaining = 0

  return {
    push(bytes: Uint8Array): Uint8Array {
      const input = concat(carry, bytes)
      carry = EMPTY

      const out = new Uint8Array(input.length)
      let written = 0
      let at = 0

      while (at < input.length) {
        if (dropRemaining > 0) {
          const take = Math.min(dropRemaining, input.length - at)
          at += take
          dropRemaining -= take
          continue
        }

        if (passRemaining > 0) {
          const take = Math.min(passRemaining, input.length - at)
          out.set(input.subarray(at, at + take), written)
          written += take
          at += take
          passRemaining -= take
          continue
        }

        if (input[at] !== FRAME_MARKER) {
          // Not a frame boundary. Keep the byte and look at the next one.
          out[written++] = input[at]!
          at++
          continue
        }

        if (input.length - at < DECISION_LENGTH) {
          // The opcode decides whether this frame is kept. Wait for it.
          carry = input.slice(at)
          break
        }

        // Two bytes can only state 0 through 65535, and 65535 is the largest
        // body the frame reader accepts. Only a zero length is impossible.
        const length = (input[at + 1]! << 8) | input[at + 2]!
        if (length === 0) {
          out[written++] = input[at]!
          at++
          continue
        }

        if (input[at + FRAME_HEADER_LENGTH] === ClientOpcode.Login) {
          dropRemaining = FRAME_HEADER_LENGTH + length
          continue
        }

        out.set(input.subarray(at, at + FRAME_HEADER_LENGTH), written)
        written += FRAME_HEADER_LENGTH
        at += FRAME_HEADER_LENGTH
        passRemaining = length
      }

      return out.subarray(0, written)
    },

    reset(): void {
      carry = EMPTY
      passRemaining = 0
      dropRemaining = 0
    }
  }
}
