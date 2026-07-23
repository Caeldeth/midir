import { PacketReader } from '../reader'

/**
 * The two plaintext packets that carry every cipher input.
 *
 * Both use transform None, so Midir reads them without a key. Together they
 * give the salt selector, the startup key, and the character name that seeds
 * the session key. This is why a passive sniffer can decrypt, and why it must
 * be running before the player logs in.
 */

/** The cipher state an SVersionCheck subtype 0 installs on this connection. */
export interface KeyUpdate {
  /** The server's configuration CRC. The client compares it to its own table. */
  configurationCrc: number
  /** The salt-table selector, 0 through 9. */
  saltSelector: number
  /** The replacement startup key. Nine bytes in practice. */
  startupKey: Uint8Array
}

/** SVersionCheck 0x00. Subtype 0 is the one the client calls the CryptoKey reply. */
export interface VersionCheck {
  kind: 'versionCheck'
  /** 0 is the key update, 1 is a lobby notice, 2 is a patch directive. */
  subtype: number
  /** Present for subtype 0 only. */
  keyUpdate?: KeyUpdate
}

/**
 * Decode SVersionCheck 0x00.
 *
 * Subtype 0 is the key update. Subtype 1 is a lobby notice and subtype 2 is a
 * patch directive; neither carries cipher state, so Midir records the subtype
 * and stops.
 */
export function decodeVersionCheck(body: Uint8Array): VersionCheck {
  const reader = new PacketReader(body, 1) // step over the opcode
  const subtype = reader.u8()
  if (subtype !== 0) return { kind: 'versionCheck', subtype }

  const configurationCrc = reader.u32()
  const saltSelector = reader.u8()
  const keyLength = reader.u8()
  return {
    kind: 'versionCheck',
    subtype: 0,
    keyUpdate: { configurationCrc, saltSelector, startupKey: reader.bytes(keyLength) }
  }
}

/** STransferServer 0x03. The server tells the client where to reconnect. */
export interface TransferServer {
  kind: 'transferServer'
  /** The destination address, as dotted decimal. */
  address: string
  port: number
  /**
   * The salt selector for the destination connection, when the token parses.
   * The retail client treats the token as opaque and copies it into its
   * CClientJoin. Midir parses it, because it holds the cipher state.
   */
  saltSelector?: number
  /** The startup key for the destination connection. */
  startupKey?: Uint8Array
  /**
   * The name the destination connection uses. At lobby to login this is a
   * placeholder such as `socket[256]`. At login to world it is the chosen
   * character name, and that name seeds the session key.
   */
  name?: string
  /** A token the destination server checks against its own manifest. */
  redirectId?: number
  /** The unparsed token, always kept. */
  token: Uint8Array
}

/**
 * Decode STransferServer 0x03.
 *
 * Body: `[u8 opcode][u32 address][u16 port][u8 tokenLength][token]`.
 *
 * The address integer goes into the socket state without a byte swap, so the
 * four bytes read in order are the four octets reversed. The observed
 * `01 00 00 7F` is 127.0.0.1.
 *
 * The token is `[u8 saltSelector][u8 keyLength][key][string8 name][u32 id]`.
 * A token that does not fit that shape is kept whole and left unparsed, so a
 * change in the token never stops the address and port from being read.
 */
export function decodeTransferServer(body: Uint8Array): TransferServer {
  const reader = new PacketReader(body, 1)
  const octets = reader.bytes(4)
  const address = [...octets].reverse().join('.')
  const port = reader.u16()
  const token = reader.bytes(reader.u8())

  const parsed = parseRedirectToken(token)
  return { kind: 'transferServer', address, port, token, ...parsed }
}

function parseRedirectToken(
  token: Uint8Array
): Pick<TransferServer, 'saltSelector' | 'startupKey' | 'name' | 'redirectId'> {
  try {
    const reader = new PacketReader(token)
    const saltSelector = reader.u8()
    const startupKey = reader.bytes(reader.u8())
    const name = reader.string8()
    const redirectId = reader.u32()
    return { saltSelector, startupKey, name, redirectId }
  } catch {
    return {}
  }
}
