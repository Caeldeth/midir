import type { Direction } from '../protocol/cipher'

/**
 * The seam between "where the bytes came from" and everything above it.
 *
 * A live adapter and a recorded file both produce the same events, so the
 * tracker, the reducer, and the whole user interface can be driven with no
 * adapter, no driver, and no game running.
 */

/** One TCP connection between the game client and a game server. */
export interface ConnectionInfo {
  /** `local:port->remote:port`. Stable for the life of the connection. */
  id: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  /** When the connection was first seen, in milliseconds since the epoch. */
  openedAtMs: number
}

/** An ordered run of bytes for one direction of one connection. */
export interface StreamChunk {
  connectionId: string
  direction: Direction
  bytes: Uint8Array
  timestampMs: number
  /**
   * True when TCP reassembly gave up on missing bytes to reach these ones.
   * Anything buffered above must be discarded before these bytes are read.
   */
  gap: boolean
}

/** What a source reports. Every method is optional to implement. */
export interface CaptureSink {
  onOpen?(connection: ConnectionInfo): void
  onChunk?(chunk: StreamChunk): void
  onClose?(connection: ConnectionInfo): void
  /** A problem worth telling the user about. The source keeps running. */
  onError?(error: Error): void
}

/** Anything that can produce connection bytes. */
export interface PacketSource {
  /** Begin producing events. Rejects when the source cannot start at all. */
  start(sink: CaptureSink): Promise<void>
  /** Stop producing events and release everything the source holds. */
  stop(): Promise<void>
}

/** Build the stable identifier for one connection. */
export function connectionIdOf(
  localAddress: string,
  localPort: number,
  remoteAddress: string,
  remotePort: number
): string {
  return `${localAddress}:${localPort}->${remoteAddress}:${remotePort}`
}
