import {
  buildMd5Source,
  decryptSession,
  decryptStartup,
  STARTUP_KEY,
  type CipherState,
  type Direction
} from './cipher'
import { decodeServerPacket, type DecodedPacket, type TransferServer } from './decode'
import { createFrameReader, type FrameReader } from './frame'
import { opcodeName, SERVER_HELLO, transformFor, type Transform } from './opcodes'

/**
 * One TCP connection between the game client and a game server.
 *
 * A session owns the cipher state for that connection and turns stream bytes
 * into decoded packets. It holds one frame reader for each direction, because
 * the two directions are separate byte streams.
 *
 * A session never sends anything. It only reads.
 *
 * The player makes three connections in turn: lobby, login, then world. Each
 * one needs its own session. `sessionFromRedirect` builds the next session
 * from the STransferServer packet that ends the previous one.
 */

/** Why a packet could not be turned into a decoded object. */
export type UnreadableReason =
  /** The connection greeting. It arrives before frame parsing is on. */
  | 'greeting'
  /** A session packet arrived before the character name was known. */
  | 'noSessionKey'
  /** The body was too short, or the trailer did not parse. */
  | 'decryptFailed'
  /** Midir has no decoder for this opcode. */
  | 'notModelled'
  /** A decoder read past the end of the body, or the body did not match. */
  | 'decodeFailed'

interface EventBase {
  direction: Direction
  opcode: number
  /** A readable opcode name for logs and the packet inspector. */
  name: string
  transform: Transform
}

/** A packet that decoded cleanly. */
export interface PacketEvent extends EventBase {
  type: 'packet'
  packet: DecodedPacket
  /** The plaintext body, opcode first. Kept for the packet inspector. */
  body: Uint8Array
}

/** A packet that arrived but could not be turned into an object. */
export interface UnreadableEvent extends EventBase {
  type: 'unreadable'
  reason: UnreadableReason
  /** The plaintext body, when decryption succeeded and only decoding failed. */
  body?: Uint8Array
  error?: string
}

export type SessionEvent = PacketEvent | UnreadableEvent

/** What a session knows about its connection. */
export interface SessionState extends CipherState {
  /**
   * The name the session key is built from, once it is known. At the lobby and
   * login hops this is a placeholder such as `socket[256]`, not a character.
   */
  keyName?: string
}

export interface ProtocolSession {
  /** Take the next run of stream bytes for one direction. */
  push(direction: Direction, chunk: Uint8Array): SessionEvent[]
  /** Give the session the character name, so session packets can decrypt. */
  setKeyName(name: string): void
  /** A read-only view of the cipher state. */
  readonly state: Readonly<SessionState>
  /** Bytes dropped so far while resynchronising, by direction. */
  droppedBytes(direction: Direction): number
  /** Forget both buffered tails. Use this when the connection closes. */
  reset(): void
}

/** How a session starts before the handshake supplies anything. */
export interface SessionOptions {
  /** The salt-table selector. Selector 0 is the client's default. */
  saltSelector?: number
  /** The startup key. The client installs the built-in key at socket creation. */
  startupKey?: Uint8Array
  /** The name the session key is built from, when it is already known. */
  keyName?: string
}

/** Create a session for one connection. */
export function createProtocolSession(options: SessionOptions = {}): ProtocolSession {
  const state: SessionState = {
    saltSelector: options.saltSelector ?? 0,
    startupKey: options.startupKey ?? STARTUP_KEY
  }
  if (options.keyName !== undefined) applyKeyName(state, options.keyName)

  const readers: Record<Direction, FrameReader> = {
    clientToServer: createFrameReader(),
    serverToClient: createFrameReader()
  }

  function handleFrame(direction: Direction, frame: Uint8Array): SessionEvent {
    const opcode = frame[0]!
    const transform = transformFor(opcode, direction)
    const base: EventBase = { direction, opcode, name: opcodeName(opcode, direction), transform }

    // The greeting is a binary frame, but the client consumes it with its
    // terminal handler before frame parsing starts. No key exists for it.
    if (direction === 'serverToClient' && opcode === SERVER_HELLO) {
      return { ...base, type: 'unreadable', reason: 'greeting' }
    }

    let body: Uint8Array
    try {
      body = plaintextOf(frame, transform, state, direction)
    } catch (error) {
      const reason: UnreadableReason =
        transform === 'session' && state.md5Source === undefined ? 'noSessionKey' : 'decryptFailed'
      return { ...base, type: 'unreadable', reason, error: messageOf(error) }
    }

    if (direction !== 'serverToClient') {
      return { ...base, type: 'unreadable', reason: 'notModelled', body }
    }

    try {
      const packet = decodeServerPacket(body)
      if (packet === null) {
        return { ...base, type: 'unreadable', reason: 'notModelled', body }
      }
      // A redirect carries the cipher state for the NEXT connection, not this
      // one. Only SVersionCheck changes the state of the connection it arrives
      // on. See sessionFromRedirect.
      if (packet.kind === 'versionCheck' && packet.keyUpdate !== undefined) {
        state.saltSelector = packet.keyUpdate.saltSelector
        if (packet.keyUpdate.startupKey.length > 0) state.startupKey = packet.keyUpdate.startupKey
      }
      return { ...base, type: 'packet', packet, body }
    } catch (error) {
      return { ...base, type: 'unreadable', reason: 'decodeFailed', body, error: messageOf(error) }
    }
  }

  return {
    push(direction: Direction, chunk: Uint8Array): SessionEvent[] {
      return readers[direction].push(chunk).map((frame) => handleFrame(direction, frame))
    },

    setKeyName(name: string): void {
      applyKeyName(state, name)
    },

    get state(): Readonly<SessionState> {
      return state
    },

    droppedBytes(direction: Direction): number {
      return readers[direction].droppedBytes
    },

    reset(): void {
      readers.clientToServer.reset()
      readers.serverToClient.reset()
    }
  }
}

function applyKeyName(state: SessionState, name: string): void {
  state.keyName = name
  state.md5Source = buildMd5Source(name)
}

function plaintextOf(
  frame: Uint8Array,
  transform: Transform,
  state: CipherState,
  direction: Direction
): Uint8Array {
  switch (transform) {
    case 'none':
      return frame
    case 'startup':
      return decryptStartup(frame, state, direction)
    default:
      return decryptSession(frame, state, direction)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Build the session for the connection a redirect points at.
 *
 * The redirect token carries the salt selector, the startup key, and the name
 * for the destination. At the login to world hop that name is the character
 * name, which is what seeds the session key.
 */
export function sessionFromRedirect(redirect: TransferServer): ProtocolSession {
  return createProtocolSession({
    ...(redirect.saltSelector !== undefined ? { saltSelector: redirect.saltSelector } : {}),
    ...(redirect.startupKey !== undefined && redirect.startupKey.length > 0
      ? { startupKey: redirect.startupKey }
      : {}),
    ...(redirect.name !== undefined && redirect.name.length > 0 ? { keyName: redirect.name } : {})
  })
}
