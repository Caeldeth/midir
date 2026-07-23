import {
  createProtocolSession,
  sessionFromRedirect,
  type ProtocolSession,
  type SessionEvent
} from '../protocol/session'
import type { CaptureSink, ConnectionInfo, StreamChunk } from './source'

/**
 * Follow the player through the three connections a login makes.
 *
 * The client connects to the lobby, then to the login server, then to the
 * world server. Each hop ends with an STransferServer redirect that carries
 * the salt selector, the startup key, and the name for the next connection.
 * The tracker remembers each redirect and hands its cipher state to the
 * connection that follows.
 *
 * This is what lets a passive sniffer read the world session. The character
 * name in the login-to-world redirect is what seeds the session key, and it
 * travels in the clear.
 */

/** A decoded packet, with the connection it arrived on. */
export interface TrackedEvent {
  connection: ConnectionInfo
  /** The name the session key was built from, when it is known. */
  keyName: string | undefined
  event: SessionEvent
}

export interface SessionTracker extends CaptureSink {
  /** The connections being followed now. */
  activeConnections(): ConnectionInfo[]
  /** The name the session key was built from on `connectionId`. */
  keyNameOf(connectionId: string): string | undefined
  /** Forget every connection and every waiting redirect. */
  clear(): void
}

interface TrackedConnection {
  info: ConnectionInfo
  session: ProtocolSession
}

/**
 * Create a tracker.
 *
 * `onEvent` runs for every packet, readable or not. An unreadable packet is
 * still worth reporting: the packet inspector shows it, and a run of them says
 * that Midir started after the player logged in.
 */
export function createSessionTracker(onEvent: (event: TrackedEvent) => void): SessionTracker {
  const connections = new Map<string, TrackedConnection>()
  /** Redirects seen but not yet claimed, keyed by `address:port`. */
  const pendingRedirects = new Map<string, ProtocolSession>()

  function destinationKey(address: string, port: number): string {
    return `${address}:${port}`
  }

  function sessionFor(info: ConnectionInfo): ProtocolSession {
    const key = destinationKey(info.remoteAddress, info.remotePort)
    const waiting = pendingRedirects.get(key)
    if (waiting !== undefined) {
      pendingRedirects.delete(key)
      return waiting
    }
    // No redirect pointed here. This is the first connection of a login, or
    // Midir started in the middle of a session. Either way, start from the
    // client's own defaults and wait for the handshake.
    return createProtocolSession()
  }

  function open(info: ConnectionInfo): TrackedConnection {
    const tracked = { info, session: sessionFor(info) }
    connections.set(info.id, tracked)
    return tracked
  }

  return {
    onOpen(info: ConnectionInfo): void {
      if (!connections.has(info.id)) open(info)
    },

    onChunk(chunk: StreamChunk): void {
      const tracked = connections.get(chunk.connectionId)
      if (tracked === undefined) return

      // Bytes were lost. The frame reader cannot detect that on its own, and
      // it would read the next frames against a stale length.
      if (chunk.gap) tracked.session.reset()

      for (const event of tracked.session.push(chunk.direction, chunk.bytes)) {
        // A redirect describes the NEXT connection. Park its cipher state
        // under the destination it names, ready for the connection to come.
        if (event.type === 'packet' && event.packet.kind === 'transferServer') {
          const { address, port } = event.packet
          pendingRedirects.set(destinationKey(address, port), sessionFromRedirect(event.packet))
        }
        onEvent({
          connection: tracked.info,
          keyName: tracked.session.state.keyName,
          event
        })
      }
    },

    onClose(info: ConnectionInfo): void {
      const tracked = connections.get(info.id)
      if (tracked === undefined) return
      tracked.session.reset()
      connections.delete(info.id)
    },

    activeConnections(): ConnectionInfo[] {
      return [...connections.values()].map((tracked) => tracked.info)
    },

    keyNameOf(connectionId: string): string | undefined {
      return connections.get(connectionId)?.session.state.keyName
    },

    clear(): void {
      for (const tracked of connections.values()) tracked.session.reset()
      connections.clear()
      pendingRedirects.clear()
    }
  }
}
