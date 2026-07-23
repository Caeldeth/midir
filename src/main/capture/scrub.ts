import { FRAME_HEADER_LENGTH, FRAME_MARKER, MAX_BODY_LENGTH } from '../protocol/frame'
import { ClientOpcode } from '../protocol/opcodes'

/**
 * Keep account credentials out of a session recording.
 *
 * A recording is a copy of the bytes the game client exchanged with the
 * server, so it holds every packet the player's lobby session produced. Some
 * of those packets carry a password. The key the lobby packets use is a
 * constant, and a recording carries everything needed to derive the session
 * key as well, so anybody who reads the file can recover the password. A
 * recording is a developer aid that a user is asked to send to somebody else,
 * so a credential must never reach the file at all.
 *
 * The scrubber drops the whole frame. It does not blank the password field
 * inside the frame, because that would need the connection's startup key and a
 * re-encryption step, and Midir has no encrypt path at all. Dropping the frame
 * is exact and needs no key:
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
 *   - None of them carries anything Midir needs. Login is only a second source
 *     for the character name; the first source is CTransferServer 0x10, which
 *     is raw and arrives on every connection. See session.ts.
 *
 * **This works on the client-to-server direction only.** Server opcode 0x03 is
 * STransferServer, which Midir needs.
 */

/**
 * The client packets that carry a credential.
 *
 * Sources: the document repo's docs/protocol/client, and
 * darkages-741-re/docs/network/client. The two disagree, so both were read.
 *
 * Confirmed on the wire, sent from the lobby, encrypted with the constant key:
 *
 *   0x02 CreateA         `[name][password][email]`
 *   0x03 Login           `[name][password]` and an install fingerprint
 *   0x26 ChangePassword  `[name][current password][new password]`
 *
 * Documented as password-bearing, but with no recovered wire format:
 *
 *   0x15 CheckPassword
 *   0x27 NewPassword
 *
 * The last two are only in the document repo. They are scrubbed because this
 * walk needs no wire format at all, only the opcode and the frame length, and
 * Midir decodes neither of them. Removing a packet that might hold a password
 * costs a recording nothing. Keeping one that does cannot be undone.
 *
 * Two near neighbours are deliberately absent. 0x28 CancelChangePassword
 * aborts the flow and implies no credential. 0x8F OTP is documented as Legends
 * of Darkness only and is not in the retail client Midir targets.
 *
 * A packet added to this set needs no other change.
 */
export const SECRET_BEARING_CLIENT_OPCODES: ReadonlySet<number> = new Set([
  ClientOpcode.NewUser,
  ClientOpcode.Login,
  ClientOpcode.CheckPassword,
  ClientOpcode.ChangePassword,
  ClientOpcode.NewPassword
])

/** A rewriter for one direction of one connection. */
export interface StreamScrubber {
  /**
   * Take the next run of stream bytes and return the bytes to record. The
   * result is the input with any credential-bearing frame removed. It can be
   * empty, and it can be shorter than the input for a second reason: up to
   * three bytes of a frame header are held back until the opcode after them
   * arrives.
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
 * That means a capture that starts in the middle of a login could pass a
 * credential frame through. The lobby connection opens fresh, so its first
 * byte is a frame boundary and the walk stays aligned from there.
 */
export function createSecretScrubber(): StreamScrubber {
  /** Bytes of a frame header that arrived without the opcode after them. */
  let carry = EMPTY
  /** Bytes of the current frame still to handle, header included. */
  let remaining = 0
  /** Whether those bytes are copied. It means nothing while remaining is 0. */
  let keep = true

  return {
    push(bytes: Uint8Array): Uint8Array {
      const input = concat(carry, bytes)
      carry = EMPTY

      const out = new Uint8Array(input.length)
      let written = 0
      let at = 0

      while (at < input.length) {
        // Inside a frame the disposition is already decided, and a body byte
        // is never read as a marker.
        if (remaining > 0) {
          const take = Math.min(remaining, input.length - at)
          if (keep) {
            out.set(input.subarray(at, at + take), written)
            written += take
          }
          at += take
          remaining -= take
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

        // The same bound the frame reader applies. Both walkers must agree:
        // a length this one accepts and that one rejects would step the
        // scrubber into a body while the decoder resynchronises.
        const length = (input[at + 1]! << 8) | input[at + 2]!
        if (length === 0 || length > MAX_BODY_LENGTH) {
          out[written++] = input[at]!
          at++
          continue
        }

        // The opcode decides the whole frame, header included.
        keep = !SECRET_BEARING_CLIENT_OPCODES.has(input[at + FRAME_HEADER_LENGTH]!)
        remaining = FRAME_HEADER_LENGTH + length
      }

      return out.subarray(0, written)
    },

    reset(): void {
      carry = EMPTY
      remaining = 0
    }
  }
}
