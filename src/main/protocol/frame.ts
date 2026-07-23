/**
 * The binary frame reader.
 *
 * A frame is:
 *   u8   marker, 0xAA
 *   u16  body length, big-endian
 *   u8[] body, opcode first
 *
 * TCP delivers a byte stream, not messages. One read can hold several frames,
 * half a frame, or the tail of one frame and the head of the next. This reader
 * takes whatever arrives and returns only the frames that are complete.
 *
 * The client itself consumes the marker byte without checking its value. Midir
 * checks it, because a sniffer can start in the middle of a stream. When the
 * marker is wrong the reader searches forward for the next one and counts the
 * bytes it dropped, so the caller can report the loss instead of returning
 * nonsense.
 *
 * **A hole in the middle of a frame cannot be detected here.** A frame whose
 * body never fully arrives looks exactly like a longer frame, so the reader
 * waits for the byte count the header declared and swallows the frames that
 * follow. The byte stream holds no evidence that would separate the two cases.
 *
 * The capture layer does hold that evidence: TCP reassembly knows when a
 * sequence range is missing. **It must call `reset()` on a hole.** Everything
 * buffered is then discarded and the reader resynchronises on the next marker.
 */

/** The frame marker the client writes. */
export const FRAME_MARKER = 0xaa

/** The marker plus the two length bytes. */
export const FRAME_HEADER_LENGTH = 3

/**
 * The largest body the reader accepts. The length field allows 65535. The
 * client refills its connection ring in 0x18000-byte reads, so a real frame is
 * far smaller. A length above this bound means the reader is not on a frame
 * boundary.
 */
export const MAX_BODY_LENGTH = 0xffff

export interface FrameReader {
  /**
   * Take the next run of stream bytes and return every frame body that is now
   * complete. Each body starts with its opcode.
   */
  push(chunk: Uint8Array): Uint8Array[]
  /** The number of bytes dropped so far while searching for a marker. */
  readonly droppedBytes: number
  /** The number of bytes held back, waiting for the rest of a frame. */
  readonly pendingBytes: number
  /** Forget the buffered tail. Use this when a connection closes. */
  reset(): void
}

/** Create a frame reader for one direction of one connection. */
export function createFrameReader(): FrameReader {
  let buffer = new Uint8Array(0)
  let dropped = 0

  function append(chunk: Uint8Array): void {
    if (buffer.length === 0) {
      buffer = Uint8Array.from(chunk)
      return
    }
    const merged = new Uint8Array(buffer.length + chunk.length)
    merged.set(buffer, 0)
    merged.set(chunk, buffer.length)
    buffer = merged
  }

  /**
   * Move to the next marker. Returns false when no marker is in the buffer, in
   * which case everything held is dropped.
   */
  function seekMarker(): boolean {
    if (buffer.length === 0 || buffer[0] === FRAME_MARKER) return buffer.length > 0
    const at = buffer.indexOf(FRAME_MARKER)
    if (at < 0) {
      dropped += buffer.length
      buffer = new Uint8Array(0)
      return false
    }
    dropped += at
    buffer = buffer.subarray(at)
    return true
  }

  return {
    push(chunk: Uint8Array): Uint8Array[] {
      append(chunk)
      const frames: Uint8Array[] = []

      for (;;) {
        if (!seekMarker()) break
        if (buffer.length < FRAME_HEADER_LENGTH) break

        const length = (buffer[1]! << 8) | buffer[2]!
        if (length === 0 || length > MAX_BODY_LENGTH) {
          // Not a real header. Step past this marker and look for the next one.
          dropped += 1
          buffer = buffer.subarray(1)
          continue
        }

        const total = FRAME_HEADER_LENGTH + length
        if (buffer.length < total) break

        frames.push(buffer.slice(FRAME_HEADER_LENGTH, total))
        buffer = buffer.subarray(total)
      }

      // Keep the tail in its own allocation so the parent chunk can be freed.
      if (buffer.length > 0 && buffer.byteOffset !== 0) buffer = Uint8Array.from(buffer)
      return frames
    },

    get droppedBytes(): number {
      return dropped
    },

    get pendingBytes(): number {
      return buffer.length
    },

    reset(): void {
      buffer = new Uint8Array(0)
    }
  }
}
