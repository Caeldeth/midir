import { PacketReader } from '../reader'

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
