import { PacketReader } from '../reader'
import { parseRedirectToken, type RedirectToken } from './handshake'

/**
 * The client-to-server packets Midir reads.
 *
 * Midir only listens. It decodes these because one of them carries the
 * character name, and the name is what seeds the session key.
 */

/**
 * CLogin 0x03. The name and password the player submitted.
 *
 * This is the name the client stores and later passes to its key setup, so it
 * is the authoritative seed for the session key. The packet uses the startup
 * key, which is a constant, so Midir reads it without knowing anything else
 * about the session.
 *
 * The password is deliberately not decoded. Midir has no use for it, and a
 * value that is never read cannot be logged, saved, or leaked.
 */
export interface ClientLogin {
  kind: 'login'
  name: string
}

/**
 * Decode CLogin 0x03.
 *
 * Body: `[u8 opcode][string8 name][string8 password][client record]`.
 */
export function decodeLogin(body: Uint8Array): ClientLogin {
  return { kind: 'login', name: new PacketReader(body, 1).string8() }
}

/**
 * CTransferServer 0x10. The client proving who it is to a server it has just
 * connected to.
 *
 * **This is where Midir gets its keys.** The packet is raw, so it needs
 * nothing to read it, and the client sends it on every connection it makes:
 * the lobby, the login server, and the world server. It returns the handoff
 * token unchanged, and that token holds the salt selector, the startup key,
 * and the character name for the connection it arrives on.
 *
 * That makes it strictly better than watching for the server's redirect. The
 * redirect describes a connection that has not opened yet, and it is easy to
 * miss: a live retail capture that began after the redirect still carried this
 * packet on all three connections, and its key decrypted every one of them.
 */
export interface ClientTransfer extends RedirectToken {
  kind: 'clientTransfer'
  /** The token as sent, kept whether or not it parsed. */
  token: Uint8Array
}

/**
 * Decode CTransferServer 0x10.
 *
 * Body: `[u8 opcode][token][u8 terminator]`. The terminator is appended by the
 * client's submission layer. The token parser reads a fixed set of fields and
 * stops, so the trailing byte needs no special handling.
 */
export function decodeClientTransfer(body: Uint8Array): ClientTransfer {
  const token = body.slice(1)
  return { kind: 'clientTransfer', token, ...parseRedirectToken(token) }
}

/**
 * True when `name` could be a character name.
 *
 * A name recovered from a source Midir is not certain of, such as the opaque
 * redirect token, must be checked before it is used. A wrong name does not
 * fail loudly: it silently decrypts every later packet into rubbish.
 */
export function looksLikeCharacterName(name: string): boolean {
  if (name.length === 0 || name.length > 32) return false
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i)
    // Printable ASCII only. Retail character names are letters.
    if (code < 0x20 || code > 0x7e) return false
  }
  return true
}
