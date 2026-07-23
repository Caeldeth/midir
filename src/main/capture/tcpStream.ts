/**
 * Put one direction of one TCP connection back in order.
 *
 * A capture sees the wire, not the socket. Segments can arrive out of order,
 * can repeat, can overlap, and can go missing when the driver's buffer fills.
 * This file turns that into an ordered byte run, and says plainly when a hole
 * was skipped.
 *
 * The hole report matters more than it looks. A frame reader cannot tell a
 * truncated frame from a longer one, so it must be reset when bytes are lost.
 * See src/main/protocol/frame.ts.
 *
 * This file is pure. Sequence numbers are compared with modular arithmetic,
 * because they wrap at 2^32.
 */

const SEQUENCE_SPACE = 0x100000000

/** How many out-of-order segments to hold before declaring a hole. */
export const MAX_PENDING_SEGMENTS = 64

/** How many out-of-order bytes to hold before declaring a hole. */
export const MAX_PENDING_BYTES = 262144

/** What one segment produced. */
export interface StreamOutput {
  /** The bytes that are now in order. Empty when nothing could be delivered. */
  bytes: Uint8Array
  /**
   * True when bytes were skipped to get here. Everything buffered above the
   * stream must be discarded before `bytes` is used.
   */
  gap: boolean
}

export interface TcpStream {
  /** Take one segment. Returns the bytes that are now in order. */
  push(sequence: number, payload: Uint8Array): StreamOutput
  /** The number of segments waiting for an earlier one. */
  readonly pendingSegments: number
  /** How many holes have been skipped so far. */
  readonly gapCount: number
  /** Start again from the next segment, whatever its sequence number. */
  reset(): void
}

/** True while `a` is at or after `b`, allowing for the 2^32 wrap. */
function atOrAfter(a: number, b: number): boolean {
  return (a - b + SEQUENCE_SPACE) % SEQUENCE_SPACE < SEQUENCE_SPACE / 2
}

/** The distance from `b` up to `a`, allowing for the wrap. */
function distance(a: number, b: number): number {
  return (a - b + SEQUENCE_SPACE) % SEQUENCE_SPACE
}

function concat(parts: Uint8Array[]): Uint8Array {
  if (parts.length === 0) return new Uint8Array(0)
  if (parts.length === 1) return parts[0]!
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const part of parts) {
    out.set(part, at)
    at += part.length
  }
  return out
}

/** Create a reassembler for one direction of one connection. */
export function createTcpStream(): TcpStream {
  /** The sequence number of the next byte to deliver, once known. */
  let next: number | null = null
  /** Segments that arrived early, keyed by their sequence number. */
  const pending = new Map<number, Uint8Array>()
  let pendingBytes = 0
  let gaps = 0

  function forget(): void {
    pending.clear()
    pendingBytes = 0
  }

  /** Deliver every buffered segment that now follows on directly. */
  function drain(parts: Uint8Array[]): void {
    for (;;) {
      const segment = pending.get(next!)
      if (segment === undefined) break
      pending.delete(next!)
      pendingBytes -= segment.length
      parts.push(segment)
      next = (next! + segment.length) % SEQUENCE_SPACE
    }
  }

  /**
   * Give up on the missing bytes and continue from the earliest segment held.
   * Anything before it is lost for good.
   */
  function skipToEarliestPending(parts: Uint8Array[]): void {
    let earliest: number | null = null
    for (const sequence of pending.keys()) {
      if (earliest === null || !atOrAfter(sequence, earliest)) earliest = sequence
    }
    if (earliest === null) return
    next = earliest
    drain(parts)
  }

  return {
    push(sequence: number, payload: Uint8Array): StreamOutput {
      if (payload.length === 0) return { bytes: new Uint8Array(0), gap: false }

      // The first segment defines where the stream starts.
      if (next === null) {
        next = (sequence + payload.length) % SEQUENCE_SPACE
        return { bytes: payload, gap: false }
      }

      if (sequence === next) {
        const parts = [payload]
        next = (next + payload.length) % SEQUENCE_SPACE
        drain(parts)
        return { bytes: concat(parts), gap: false }
      }

      // Already delivered, in whole or in part. A retransmission looks like
      // this, and so does an overlapping segment.
      if (!atOrAfter(sequence, next)) {
        const alreadyHave = distance(next, sequence)
        if (alreadyHave >= payload.length) return { bytes: new Uint8Array(0), gap: false }
        const fresh = payload.subarray(alreadyHave)
        const parts = [fresh]
        next = (next + fresh.length) % SEQUENCE_SPACE
        drain(parts)
        return { bytes: concat(parts), gap: false }
      }

      // Early. Hold it and wait for what comes before it.
      if (!pending.has(sequence)) {
        pending.set(sequence, payload)
        pendingBytes += payload.length
      }

      if (pending.size <= MAX_PENDING_SEGMENTS && pendingBytes <= MAX_PENDING_BYTES) {
        return { bytes: new Uint8Array(0), gap: false }
      }

      // Too much is waiting. The missing bytes are not coming.
      gaps++
      const parts: Uint8Array[] = []
      skipToEarliestPending(parts)
      forget()
      return { bytes: concat(parts), gap: true }
    },

    get pendingSegments(): number {
      return pending.size
    },

    get gapCount(): number {
      return gaps
    },

    reset(): void {
      next = null
      forget()
    }
  }
}
