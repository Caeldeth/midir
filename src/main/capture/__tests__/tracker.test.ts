import { describe, expect, it } from 'vitest'
import { ServerOpcode } from '../../protocol/opcodes'
import type { PacketEvent, UnreadableEvent } from '../../protocol/session'
import type { ConnectionInfo } from '../source'
import { createSessionTracker, type TrackedEvent } from '../tracker'
import { frameOf, redirectBody, sessionBody, u32 } from './helpers'

const CHARACTER = 'Sabrael'

const connection = (id: string, remoteAddress: string, remotePort: number): ConnectionInfo => ({
  id,
  localAddress: '192.168.1.20',
  localPort: 50000 + remotePort,
  remoteAddress,
  remotePort,
  openedAtMs: 1000
})

const LOBBY = connection('lobby', '203.0.113.7', 2610)
const LOGIN = connection('login', '203.0.113.8', 2611)
const WORLD = connection('world', '203.0.113.9', 2612)

function collect(): { tracker: ReturnType<typeof createSessionTracker>; events: TrackedEvent[] } {
  const events: TrackedEvent[] = []
  return { tracker: createSessionTracker((event) => events.push(event)), events }
}

const chunkOf = (
  connectionId: string,
  body: number[]
): Parameters<NonNullable<ReturnType<typeof createSessionTracker>['onChunk']>>[0] => ({
  connectionId,
  direction: 'serverToClient' as const,
  bytes: Uint8Array.from(frameOf(body)),
  timestampMs: 2000,
  gap: false
})

const decoded = (events: TrackedEvent[]): unknown[] =>
  events.filter((e) => e.event.type === 'packet').map((e) => (e.event as PacketEvent).packet)

describe('createSessionTracker', () => {
  it('reads a raw packet on a connection it just opened', () => {
    const { tracker, events } = collect()
    tracker.onOpen?.(LOBBY)
    tracker.onChunk?.(chunkOf('lobby', [ServerOpcode.VersionCheck, 0x00, ...u32(0), 0x02, 0x00]))
    expect(decoded(events)).toEqual([
      {
        kind: 'versionCheck',
        subtype: 0,
        keyUpdate: { configurationCrc: 0, saltSelector: 2, startupKey: new Uint8Array(0) }
      }
    ])
  })

  it('ignores bytes for a connection it is not following', () => {
    const { tracker, events } = collect()
    tracker.onChunk?.(chunkOf('unknown', [ServerOpcode.RemoveInventory, 1]))
    expect(events).toEqual([])
  })

  it('carries the character name from the login redirect to the world connection', () => {
    // This is the whole reason a passive sniffer can read the world session.
    const { tracker, events } = collect()

    tracker.onOpen?.(LOGIN)
    tracker.onChunk?.(
      chunkOf(
        'login',
        redirectBody({
          address: WORLD.remoteAddress,
          port: WORLD.remotePort,
          name: CHARACTER,
          saltSelector: 6
        })
      )
    )
    expect(decoded(events)).toContainEqual(expect.objectContaining({ kind: 'transferServer' }))

    // The world connection opens next, and it must already hold the key.
    tracker.onOpen?.(WORLD)
    expect(tracker.keyNameOf('world')).toBe(CHARACTER)

    events.length = 0
    tracker.onChunk?.(
      chunkOf(
        'world',
        sessionBody({
          plaintext: [
            ServerOpcode.AddInventory,
            3,
            0x01,
            0x00,
            0x00,
            5,
            83,
            116,
            105,
            99,
            107,
            0,
            0,
            0,
            1,
            0,
            0,
            0,
            0,
            50,
            0,
            0,
            0,
            50
          ],
          keyName: CHARACTER,
          saltSelector: 6,
          sequence: 4
        })
      )
    )
    expect(decoded(events)).toEqual([
      expect.objectContaining({ kind: 'addInventory', slot: 3, name: 'Stick' })
    ])
  })

  it('does not give the redirect to a connection to somewhere else', () => {
    const { tracker } = collect()
    tracker.onOpen?.(LOGIN)
    tracker.onChunk?.(
      chunkOf(
        'login',
        redirectBody({ address: WORLD.remoteAddress, port: WORLD.remotePort, name: CHARACTER })
      )
    )
    tracker.onOpen?.(connection('other', '198.51.100.1', 443))
    expect(tracker.keyNameOf('other')).toBeUndefined()
  })

  it('cannot read a session packet on a connection no redirect pointed at', () => {
    // This is what Midir starting after login looks like. It must report the
    // packets it cannot read, not fail silently.
    const { tracker, events } = collect()
    tracker.onOpen?.(WORLD)
    tracker.onChunk?.(
      chunkOf(
        'world',
        sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 1], keyName: CHARACTER })
      )
    )
    expect(decoded(events)).toEqual([])
    expect((events[0]!.event as UnreadableEvent).reason).toBe('noSessionKey')
  })

  it('resets the frame reader when reassembly reports a gap', () => {
    const { tracker, events } = collect()
    tracker.onOpen?.(WORLD)

    // A frame cut short leaves the reader waiting for bytes that never come.
    const whole = frameOf(
      sessionBody({ plaintext: [ServerOpcode.RemoveInventory, 1], keyName: CHARACTER })
    )
    tracker.onChunk?.({ ...chunkOf('world', []), bytes: Uint8Array.from(whole.slice(0, 4)) })

    // The gap flag tells the tracker to throw that partial frame away.
    const good = frameOf(
      sessionBody({ plaintext: [ServerOpcode.RemoveEquip, 2], keyName: CHARACTER, sequence: 1 })
    )
    tracker.onChunk?.({
      ...chunkOf('world', []),
      bytes: Uint8Array.from(good),
      gap: true
    })

    // Without the reset the partial frame would have swallowed this one.
    expect(events.some((e) => e.event.type === 'packet')).toBe(false)
    expect(tracker.keyNameOf('world')).toBeUndefined()
  })

  it('forgets a connection when it closes', () => {
    const { tracker } = collect()
    tracker.onOpen?.(LOBBY)
    expect(tracker.activeConnections().map((c) => c.id)).toEqual(['lobby'])
    tracker.onClose?.(LOBBY)
    expect(tracker.activeConnections()).toEqual([])
  })

  it('keeps a waiting redirect after the connection that carried it closes', () => {
    // The login connection always ends before the world connection opens.
    const { tracker } = collect()
    tracker.onOpen?.(LOGIN)
    tracker.onChunk?.(
      chunkOf(
        'login',
        redirectBody({ address: WORLD.remoteAddress, port: WORLD.remotePort, name: CHARACTER })
      )
    )
    tracker.onClose?.(LOGIN)

    tracker.onOpen?.(WORLD)
    expect(tracker.keyNameOf('world')).toBe(CHARACTER)
  })

  it('clears everything on demand', () => {
    const { tracker } = collect()
    tracker.onOpen?.(LOGIN)
    tracker.onChunk?.(
      chunkOf(
        'login',
        redirectBody({ address: WORLD.remoteAddress, port: WORLD.remotePort, name: CHARACTER })
      )
    )
    tracker.clear()

    tracker.onOpen?.(WORLD)
    expect(tracker.keyNameOf('world')).toBeUndefined()
    expect(tracker.activeConnections().map((c) => c.id)).toEqual(['world'])
  })
})
