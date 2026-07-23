// The `midir-icon://` protocol. The renderer draws an item icon with
// `<img src="midir-icon://item/<sprite>/<color>" />`, which keeps every icon out
// of the IPC path and out of any store: the network layer fetches the bytes and
// the browser caches them.
//
// The sprite id and colour go in the PATH, behind a fixed `item` host. A numeric
// host is not safe: the scheme is registered `standard`, so a numeric host is
// read as a 32-bit IPv4 address and rewritten (sprite 32774 became
// `0.0.128.6`), which no longer parses back to the id.
//
// The request parsing is a pure function so a test can prove a hit, a miss, and
// a malformed request without Electron. The registration wraps it for the main
// process.

import type { Protocol } from 'electron'
import type { Logger } from '../log'
import type { IconService } from './iconService'

/** What one icon request resolves to. A 404 body is empty. */
export interface IconResponse {
  status: 200 | 404
  body?: Uint8Array
}

/**
 * Read the sprite id and colour from a `midir-icon://item/<sprite>/<color>` URL.
 *
 * Both values come from the path, so the standard scheme cannot mangle them. A
 * URL that does not parse to two non-negative integers is refused, and the
 * caller answers 404. That is the same "no icon" outcome as a missing frame, so
 * a stray request never throws.
 */
export function parseIconUrl(rawUrl: string): { sprite: number; color: number } | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  const segments = url.pathname.split('/').filter((s) => s.length > 0)
  if (segments.length === 0) return null
  const sprite = Number(segments[0])
  const color = segments.length > 1 ? Number(segments[1]) : 0
  if (!Number.isInteger(sprite) || sprite < 0) return null
  if (!Number.isInteger(color) || color < 0) return null
  return { sprite, color }
}

/**
 * Resolve one icon request to a status and, on a hit, the PNG bytes. Every
 * miss is a 404, so nothing here rejects.
 */
export async function handleIconRequest(
  service: IconService,
  rawUrl: string
): Promise<IconResponse> {
  const parsed = parseIconUrl(rawUrl)
  if (parsed === null) return { status: 404 }
  const png = await service.render(parsed.sprite, parsed.color)
  if (png === null || png.length === 0) return { status: 404 }
  return { status: 200, body: png }
}

/**
 * Install the `midir-icon://` handler on the main process. The scheme must be
 * registered as privileged before `app.whenReady` — see registerIconScheme.
 */
export function registerIconProtocol(protocol: Protocol, service: IconService, log: Logger): void {
  protocol.handle('midir-icon', async (request) => {
    try {
      const response = await handleIconRequest(service, request.url)
      if (response.status === 200 && response.body !== undefined) {
        // A Buffer is a Uint8Array the response layer always accepts as a body.
        return new Response(Buffer.from(response.body), {
          status: 200,
          headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' }
        })
      }
    } catch (error) {
      // The service already swallows its own failures, so reaching here is a
      // surprise worth one line. It is still answered as "no icon".
      log.error('icons', `An icon request threw: ${String(error)}`)
    }
    return new Response(null, { status: 404 })
  })
}
