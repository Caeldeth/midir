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
  /**
   * When the bytes were captured, in milliseconds since the epoch.
   *
   * This is capture time, not the time the event was handled. They are the
   * same during a live capture and very different during a replay, and
   * everything above this layer must run from a recording as if it were live.
   */
  timestampMs: number
  event: SessionEvent
}

export interface SessionTracker extends CaptureSink {
  /** The connections being followed now. */
  activeConnections(): ConnectionInfo[]
  /** The name the session key was built from on `connectionId`. */
  keyNameOf(connectionId: string): string | undefined
  /** The name from the most recent login, which seeds every later hop. */
  loginName(): string | undefined
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
  /**
   * The name from the most recent CLogin. The client keeps using it for every
   * later hop, so the world connection needs it even though the login happened
   * on the connection before.
   */
  let lastLoginName: string | undefined

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
    // Midir started in the middle of a session. Start from the client's own
    // defaults, but carry a name already learned from a login: on retail the
    // redirect token is opaque, so CLogin is the only reliable source.
    return createProtocolSession(lastLoginName !== undefined ? { keyName: lastLoginName } : {})
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
        // The player submitted a name. Every connection after this one is
        // keyed from it, so remember it before the redirect arrives.
        if (event.type === 'packet' && event.packet.kind === 'login') {
          lastLoginName = event.packet.name
        }
        // A redirect describes the NEXT connection. Park its cipher state
        // under the destination it names, ready for the connection to come.
        if (event.type === 'packet' && event.packet.kind === 'transferServer') {
          const { address, port } = event.packet
          pendingRedirects.set(
            destinationKey(address, port),
            sessionFromRedirect(event.packet, lastLoginName)
          )
        }
        onEvent({
          connection: tracked.info,
          keyName: tracked.session.state.keyName,
          timestampMs: chunk.timestampMs,
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

    loginName(): string | undefined {
      return lastLoginName
    },

    clear(): void {
      for (const tracked of connections.values()) tracked.session.reset()
      connections.clear()
      pendingRedirects.clear()
      lastLoginName = undefined
    }
  }
}
