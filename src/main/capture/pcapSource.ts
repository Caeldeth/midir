import { createRequire } from 'node:module'
import type { CaptureDevice, CapturedPacket, TcpConnection } from 'da-pcap'
import type { Direction } from '../protocol/cipher'
import { isFinOrReset, isSyn, isSynAck, parseFrame, type TcpSegment } from './packet'
import { connectionIdOf, type CaptureSink, type ConnectionInfo, type PacketSource } from './source'
import { createTcpStream, type TcpStream } from './tcpStream'

/**
 * The live source: watch the game client's own TCP connections.
 *
 * Midir does not guess which traffic belongs to the game. It asks the
 * operating system which connections the client process owns, and reads only
 * those. Everything else on the adapter is discarded.
 *
 * Capture is read-only. The source never sends a packet and never touches the
 * client.
 */

/** The part of the addon this file uses. Injecting it keeps the logic testable. */
export interface PcapApi {
  isAvailable(): boolean
  loadError(): string | null
  listDevices(): CaptureDevice[]
  startCapture(
    options: { device: string; filter?: string },
    onBatch: (packets: CapturedPacket[]) => void
  ): { id: number; datalink: number }
  stopCapture(id: number): boolean
  tcpConnectionsForPid(pid: number): TcpConnection[]
  processIdsByName(name: string): number[]
}

/** Load the real addon. Throws off Windows, and when Npcap is missing. */
export function loadPcapApi(): PcapApi {
  const require = createRequire(import.meta.url)
  return require('da-pcap') as PcapApi
}

/** The default client process to follow. */
export const DEFAULT_PROCESS_NAME = 'Darkages.exe'

/** How often to re-read the operating system's TCP table. */
export const DEFAULT_POLL_INTERVAL_MS = 250

/**
 * The shortest wait between two table reads triggered by a connection opening.
 *
 * A read walks the process list, so a burst of unknown segments must not cause
 * a burst of reads. A read that is too soon is delayed, never dropped: the
 * client's next hop must be picked up before its first byte of payload, which
 * is one round trip after the SYN.
 */
const REFRESH_THROTTLE_MS = 50

/**
 * TCP states worth following. A connection that is closing has nothing left to
 * say, and its bytes have already been read.
 */
const LIVE_STATES = new Set([3 /* SYN_SENT */, 4 /* SYN_RCVD */, 5 /* ESTABLISHED */])

export interface PcapSourceOptions {
  /** The adapter name from `listDevices`. */
  device: string
  /** The client process to follow. */
  processName?: string
  /** How often to re-read the TCP table, in milliseconds. */
  pollIntervalMs?: number
  /**
   * An extra BPF filter, combined with `tcp`. Leave it unset unless the
   * adapter is busy: Midir already discards everything the client does not own.
   */
  filter?: string
  /** The addon. Injected by tests. */
  api?: PcapApi
  /** The clock. Injected by tests. */
  now?: () => number
}

interface Flow {
  info: ConnectionInfo
  streams: Record<Direction, TcpStream>
}

/** Create the live source. */
export function createPcapSource(options: PcapSourceOptions): PacketSource {
  const api = options.api ?? loadPcapApi()
  const processName = options.processName ?? DEFAULT_PROCESS_NAME
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const now = options.now ?? Date.now

  /** Flows by their connection id. */
  const flows = new Map<string, Flow>()
  /** Both ordered endpoint pairs of every flow, so either direction resolves. */
  const byEndpoints = new Map<string, Flow>()

  let captureId: number | undefined
  let datalink = 0
  let poll: NodeJS.Timeout | undefined
  let deferredRefresh: NodeJS.Timeout | undefined
  let lastRefreshMs = Number.NEGATIVE_INFINITY
  let sink: CaptureSink = {}

  const endpointKey = (a: string, aPort: number, b: string, bPort: number): string =>
    `${a}:${aPort}|${b}:${bPort}`

  function openFlow(connection: TcpConnection): void {
    const id = connectionIdOf(
      connection.localAddress,
      connection.localPort,
      connection.remoteAddress,
      connection.remotePort
    )
    if (flows.has(id)) return

    const info: ConnectionInfo = {
      id,
      localAddress: connection.localAddress,
      localPort: connection.localPort,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      openedAtMs: now()
    }
    const flow: Flow = {
      info,
      streams: { clientToServer: createTcpStream(), serverToClient: createTcpStream() }
    }
    flows.set(id, flow)
    byEndpoints.set(
      endpointKey(info.localAddress, info.localPort, info.remoteAddress, info.remotePort),
      flow
    )
    byEndpoints.set(
      endpointKey(info.remoteAddress, info.remotePort, info.localAddress, info.localPort),
      flow
    )
    sink.onOpen?.(info)
  }

  function closeFlow(flow: Flow): void {
    const { info } = flow
    flows.delete(info.id)
    byEndpoints.delete(
      endpointKey(info.localAddress, info.localPort, info.remoteAddress, info.remotePort)
    )
    byEndpoints.delete(
      endpointKey(info.remoteAddress, info.remotePort, info.localAddress, info.localPort)
    )
    sink.onClose?.(info)
  }

  /**
   * Read the TCP table now if enough time has passed, and otherwise as soon as
   * it has. A new connection is never left waiting for the next poll.
   */
  function refreshSoon(): void {
    const waited = now() - lastRefreshMs
    if (waited >= REFRESH_THROTTLE_MS) {
      refreshFlows()
      return
    }
    if (deferredRefresh !== undefined) return
    deferredRefresh = setTimeout(() => {
      deferredRefresh = undefined
      refreshFlows()
    }, REFRESH_THROTTLE_MS - waited)
  }

  /** Re-read the operating system's TCP table and match it to what is tracked. */
  function refreshFlows(): void {
    lastRefreshMs = now()
    let live: TcpConnection[]
    try {
      live = api
        .processIdsByName(processName)
        .flatMap((pid) => api.tcpConnectionsForPid(pid))
        .filter((connection) => LIVE_STATES.has(connection.state))
    } catch (error) {
      sink.onError?.(asError(error))
      return
    }

    const seen = new Set<string>()
    for (const connection of live) {
      seen.add(
        connectionIdOf(
          connection.localAddress,
          connection.localPort,
          connection.remoteAddress,
          connection.remotePort
        )
      )
      openFlow(connection)
    }

    for (const flow of [...flows.values()]) {
      if (!seen.has(flow.info.id)) closeFlow(flow)
    }
  }

  function handleSegment(segment: TcpSegment, timestampMs: number): void {
    const flow = byEndpoints.get(
      endpointKey(
        segment.sourceAddress,
        segment.sourcePort,
        segment.destinationAddress,
        segment.destinationPort
      )
    )

    if (flow === undefined) {
      // A connection Midir does not track. It may be the game opening its next
      // hop, which the table read has not caught up with yet, so read the
      // table rather than waiting for the next poll.
      if (isSyn(segment) || isSynAck(segment)) refreshSoon()
      return
    }

    const direction: Direction =
      segment.sourceAddress === flow.info.remoteAddress &&
      segment.sourcePort === flow.info.remotePort
        ? 'serverToClient'
        : 'clientToServer'

    if (segment.payload.length > 0) {
      const { bytes, gap } = flow.streams[direction].push(segment.sequence, segment.payload)
      if (bytes.length > 0 || gap) {
        sink.onChunk?.({ connectionId: flow.info.id, direction, bytes, timestampMs, gap })
      }
    }

    // A FIN or a reset ends the connection. Report it now: the table read that
    // would notice is up to a poll interval away.
    if (isFinOrReset(segment)) closeFlow(flow)
  }

  function handleBatch(packets: CapturedPacket[]): void {
    for (const packet of packets) {
      let segment: TcpSegment | null
      try {
        segment = parseFrame(new Uint8Array(packet.bytes), datalink)
      } catch (error) {
        sink.onError?.(asError(error))
        continue
      }
      if (segment !== null) handleSegment(segment, packet.timestampMs)
    }
  }

  return {
    async start(next: CaptureSink): Promise<void> {
      sink = next
      if (!api.isAvailable()) throw new Error(api.loadError() ?? 'Packet capture is unavailable.')

      const filter = options.filter === undefined ? 'tcp' : `tcp and (${options.filter})`
      const handle = api.startCapture({ device: options.device, filter }, handleBatch)
      captureId = handle.id
      datalink = handle.datalink

      refreshFlows()
      poll = setInterval(refreshFlows, pollIntervalMs)
    },

    async stop(): Promise<void> {
      if (poll !== undefined) {
        clearInterval(poll)
        poll = undefined
      }
      if (deferredRefresh !== undefined) {
        clearTimeout(deferredRefresh)
        deferredRefresh = undefined
      }
      if (captureId !== undefined) {
        api.stopCapture(captureId)
        captureId = undefined
      }
      for (const flow of [...flows.values()]) closeFlow(flow)
      sink = {}
    }
  }
}

/**
 * Choose the adapter that owns `localAddress`.
 *
 * The client's own connections name that address, so this is exact. It beats
 * guessing from adapter descriptions.
 */
export function deviceForAddress(
  devices: CaptureDevice[],
  localAddress: string
): CaptureDevice | undefined {
  return devices.find((device) =>
    device.addresses.some((address) => address.address === localAddress)
  )
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value))
}
