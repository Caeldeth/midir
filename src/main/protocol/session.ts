import {
  buildMd5Source,
  decryptSession,
  decryptStartup,
  STARTUP_KEY,
  type CipherState,
  type Direction
} from './cipher'
import {
  decodeClientPacket,
  decodeServerPacket,
  looksLikeCharacterName,
  type DecodedPacket,
  type RedirectToken,
  type TransferServer
} from './decode'
import { unwrapDialogResponse } from './dialogWrapper'
import { createFrameReader, type FrameReader } from './frame'
import { isDialogWrapped, opcodeName, SERVER_HELLO, transformFor, type Transform } from './opcodes'

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

    try {
      const packet =
        direction === 'serverToClient' ? decodeServerPacket(body) : decodeClientPacket(body)
      if (packet === null) {
        return { ...base, type: 'unreadable', reason: 'notModelled', body }
      }
      // The client proves itself to each server it connects to by returning
      // the handoff token unchanged. That token is the whole cipher state for
      // THIS connection, and it is raw. It is the most reliable source Midir
      // has, because it does not depend on having captured the server's side
      // of a handshake that may have happened before capture started.
      if (packet.kind === 'clientTransfer') applyToken(state, packet)

      // The name the player submitted is what the client feeds into its own
      // key setup. It is a second source for the same value.
      if (packet.kind === 'login' && looksLikeCharacterName(packet.name)) {
        applyKeyName(state, packet.name)
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
  if (state.keyName === name) return
  state.keyName = name
  state.md5Source = buildMd5Source(name)
}

/** Install the salt selector, the startup key, and the name from a token. */
function applyToken(state: SessionState, token: RedirectToken): void {
  if (token.saltSelector !== undefined) state.saltSelector = token.saltSelector
  if (token.startupKey !== undefined && token.startupKey.length > 0) {
    state.startupKey = token.startupKey
  }
  if (token.name !== undefined && looksLikeCharacterName(token.name)) {
    applyKeyName(state, token.name)
  }
}

function plaintextOf(
  frame: Uint8Array,
  transform: Transform,
  state: CipherState,
  direction: Direction
): Uint8Array {
  const decrypted = decryptOf(frame, transform, state, direction)
  if (!isDialogWrapped(decrypted[0]!, direction)) return decrypted

  // Two client opcodes carry a second layer under the transform. Without it
  // the body decrypts cleanly and still matches no known layout.
  const plain = unwrapDialogResponse(decrypted)
  if (plain === null) {
    throw new Error('dialog wrapper CRC did not match; this connection’s key is probably wrong')
  }
  return plain
}

function decryptOf(
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
 * **The redirect token is opaque to the retail client**, which copies it into
 * its next CTransferServer without reading it. The layout Midir parses was
 * recovered from a loopback capture, so it holds for a Hybrasyl-style server
 * and may not hold for retail.
 *
 * `knownName` therefore wins when it is given. It comes from CLogin, which is
 * the value the client itself passes to its key setup. A name taken from the
 * token is used only as a fallback, and only when it could be a name at all: a
 * wrong name does not fail loudly, it silently decrypts everything after it
 * into rubbish.
 */
export function sessionFromRedirect(redirect: TransferServer, knownName?: string): ProtocolSession {
  const tokenName =
    redirect.name !== undefined && looksLikeCharacterName(redirect.name) ? redirect.name : undefined
  const keyName = knownName ?? tokenName

  return createProtocolSession({
    ...(redirect.saltSelector !== undefined ? { saltSelector: redirect.saltSelector } : {}),
    ...(redirect.startupKey !== undefined && redirect.startupKey.length > 0
      ? { startupKey: redirect.startupKey }
      : {}),
    ...(keyName !== undefined ? { keyName } : {})
  })
}
