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
 *   - None of them carries anything Midir decodes for a character record.
 *
 * Login is a source for the character name, and the name seeds the session
 * key. CTransferServer 0x10 is the other source: it is raw and arrives on
 * every connection, and in a live retail capture its name decrypted all three
 * connections. That is why the name survives this scrub. It is not free of
 * risk. `sessionFromRedirect` in session.ts warns that the token layout was
 * recovered from a loopback capture and may not hold for every server, so a
 * recording whose 0x10 token does not parse cannot be replayed.
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
 *   0x02 CreateA         `[name][password][account text]`
 *   0x03 Login           `[name][password]`, then a 15-byte install fingerprint
 *   0x26 ChangePassword  `[name][current password][new password]`, and outside
 *                        distribution modes 1 and 15 a `u32` birthdate
 *
 * The sources disagree about CreateA's third string. The document repo
 * binary-verifies it as a transmitted email address. darkages-741-re says the
 * USA build fills it with the literal text `none` and shows no email control.
 * The field is scrubbed either way, so the disagreement does not matter here.
 *
 * Documented as password-bearing, but with no recovered wire format:
 *
 *   0x15 CheckPassword
 *   0x27 NewPassword
 *   0x8F Otp
 *
 * These three are only in the document repo, which marks all of them as not
 * observed in production. They are scrubbed anyway, because this walk needs no
 * wire format at all, only the opcode and the frame length, and Midir decodes
 * none of them. Removing a packet that might hold a credential costs a
 * recording nothing. Keeping one that does cannot be undone.
 *
 * 0x28 CancelChangePassword is deliberately absent. The retail change-password
 * flow gives its Cancel control one job, which is to close the pane, and that
 * flow sends no packet for it.
 *
 * A packet added to this set needs no other change.
 */
export const SECRET_BEARING_CLIENT_OPCODES: ReadonlySet<number> = new Set([
  ClientOpcode.NewUser,
  ClientOpcode.Login,
  ClientOpcode.CheckPassword,
  ClientOpcode.ChangePassword,
  ClientOpcode.NewPassword,
  ClientOpcode.Otp
])

/** A rewriter for one direction of one connection. */
export interface StreamScrubber {
  /**
   * Take the next run of stream bytes and return the bytes to record.
   *
   * The result is the input with any credential-bearing frame removed. It can
   * be shorter for two more reasons. Up to three bytes of a frame header are
   * held back until the opcode after them arrives, and those bytes are lost if
   * the stream ends first. After a gap the result is always empty.
   */
  push(bytes: Uint8Array): Uint8Array
  /**
   * Report that bytes went missing from the stream.
   *
   * **The scrubber then records nothing more for this direction.** It does not
   * resynchronise, because it cannot do so safely. Two failures follow from
   * trying:
   *
   *   - A hole can land inside a credential frame. The bytes after it are the
   *     rest of that frame's payload, and the walk has lost the count that
   *     would have discarded them. Passing them on writes a password to the
   *     file in a form the recording's own key material recovers.
   *   - Once the walk is lost, the first 0xAA in an encrypted payload reads as
   *     a frame header. Any length up to 65535 is accepted, and the walk then
   *     copies that many bytes without looking at them. A credential frame
   *     inside that range is copied whole.
   *
   * Stopping costs little. The frame reader that replays a recording discards
   * unaligned bytes anyway, so most of what is dropped could not have been
   * decoded. The connection's key material arrives in the first packets of the
   * connection, far before TCP reassembly gives up on anything. The server
   * direction is untouched, and it carries everything Midir decodes.
   */
  onGap(): void
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
 * through unchanged, so a recording keeps data the walk cannot classify.
 *
 * The walk therefore needs its place in the stream. It has that place from the
 * connection's first byte, because the lobby connection opens fresh and the
 * client's first byte is a frame boundary. It loses the place only on a gap,
 * and `onGap` stops the scrubber for good rather than guess.
 *
 * Two limits are worth stating. A capture adopted mid-connection is not known
 * to start on a boundary, and could pass a credential frame through. And the
 * client has a second, printable framing mode with no 0xAA header at all,
 * selected by `ESC S`; under it the walk finds no frames and passes everything
 * through. That mode is compiled but not observed on retail, whose server
 * selects `ESC C`.
 */
export function createSecretScrubber(): StreamScrubber {
  /** Bytes of a frame header that arrived without the opcode after them. */
  let carry = EMPTY
  /** Bytes of the current frame still to handle, header included. */
  let remaining = 0
  /** Whether those bytes are copied. It means nothing while remaining is 0. */
  let keep = true
  /** False once a gap has been reported. The walk never restarts. */
  let aligned = true

  return {
    push(bytes: Uint8Array): Uint8Array {
      // The walk only knows a frame from a payload while it holds its place.
      // Once it does not, no byte can be shown to be safe. See onGap.
      if (!aligned) return EMPTY

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

    onGap(): void {
      aligned = false
      carry = EMPTY
      remaining = 0
    }
  }
}
