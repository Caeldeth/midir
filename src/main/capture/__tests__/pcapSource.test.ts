import type { CapturedPacket, CaptureDevice, TcpConnection } from 'da-pcap'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TcpFlag } from '../packet'
import { createPcapSource, deviceForAddress, type PcapApi } from '../pcapSource'
import type { CaptureSink, ConnectionInfo, StreamChunk } from '../source'
import { ethernetFrame } from './helpers'

const CLIENT = { address: '192.168.1.20', port: 51000 }
const LOBBY = { address: '203.0.113.7', port: 2610 }
const WORLD = { address: '203.0.113.9', port: 2612 }

const established = (
  remote: { address: string; port: number },
  localPort = CLIENT.port
): TcpConnection => ({
  localAddress: CLIENT.address,
  localPort,
  remoteAddress: remote.address,
  remotePort: remote.port,
  state: 5 // ESTABLISHED
})

/** A stand-in for the addon, so the flow logic runs with no driver. */
class FakeApi implements PcapApi {
  available = true
  devices: CaptureDevice[] = []
  pids = [4242]
  connections: TcpConnection[] = []
  batchHandler: ((packets: CapturedPacket[]) => void) | undefined
  stopped: number[] = []
  datalink = 1
  lastFilter: string | undefined
  tableReads = 0

  isAvailable(): boolean {
    return this.available
  }
  loadError(): string | null {
    return this.available ? null : 'no npcap'
  }
  listDevices(): CaptureDevice[] {
    return this.devices
  }
  startCapture(
    options: { device: string; filter?: string },
    onBatch: (packets: CapturedPacket[]) => void
  ): { id: number; datalink: number } {
    this.lastFilter = options.filter
    this.batchHandler = onBatch
    return { id: 7, datalink: this.datalink }
  }
  stopCapture(id: number): boolean {
    this.stopped.push(id)
    return true
  }
  tcpConnectionsForPid(): TcpConnection[] {
    this.tableReads++
    return this.connections
  }
  processIdsByName(): number[] {
    return this.pids
  }

  /** Deliver frames as the addon would. */
  deliver(...frames: Buffer[]): void {
    this.batchHandler?.(frames.map((bytes) => ({ timestampMs: 5000, bytes })))
  }
}

interface Recorded {
  opens: ConnectionInfo[]
  chunks: StreamChunk[]
  closes: ConnectionInfo[]
  errors: Error[]
}

function sinkOf(): { sink: CaptureSink; log: Recorded } {
  const log: Recorded = { opens: [], chunks: [], closes: [], errors: [] }
  return {
    log,
    sink: {
      onOpen: (c) => log.opens.push(c),
      onChunk: (c) => log.chunks.push(c),
      onClose: (c) => log.closes.push(c),
      onError: (e) => log.errors.push(e)
    }
  }
}

describe('createPcapSource', () => {
  let api: FakeApi

  beforeEach(() => {
    api = new FakeApi()
  })

  it('refuses to start when capture is unavailable, and says why', async () => {
    api.available = false
    const source = createPcapSource({ device: 'adapter', api })
    await expect(source.start({})).rejects.toThrow('no npcap')
  })

  it('opens a flow for each connection the client process owns', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api, now: () => 1000 })

    await source.start(sink)
    expect(log.opens).toEqual([
      {
        id: '192.168.1.20:51000->203.0.113.7:2610',
        localAddress: CLIENT.address,
        localPort: CLIENT.port,
        remoteAddress: LOBBY.address,
        remotePort: LOBBY.port,
        openedAtMs: 1000
      }
    ])
    await source.stop()
  })

  it('reads server bytes and marks their direction', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)

    api.deliver(
      ethernetFrame({
        source: LOBBY.address,
        sourcePort: LOBBY.port,
        destination: CLIENT.address,
        destinationPort: CLIENT.port,
        sequence: 100,
        payload: [0xaa, 0x00, 0x02, 0x08, 0x20]
      })
    )

    expect(log.chunks).toHaveLength(1)
    expect(log.chunks[0]).toMatchObject({
      connectionId: '192.168.1.20:51000->203.0.113.7:2610',
      direction: 'serverToClient',
      gap: false
    })
    expect([...log.chunks[0]!.bytes]).toEqual([0xaa, 0x00, 0x02, 0x08, 0x20])
    await source.stop()
  })

  it('reads client bytes and marks their direction', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)

    api.deliver(
      ethernetFrame({
        source: CLIENT.address,
        sourcePort: CLIENT.port,
        destination: LOBBY.address,
        destinationPort: LOBBY.port,
        sequence: 1,
        payload: [0xaa, 0x00, 0x01, 0x10]
      })
    )
    expect(log.chunks[0]!.direction).toBe('clientToServer')
    await source.stop()
  })

  it('ignores traffic the client process does not own', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)

    api.deliver(
      ethernetFrame({
        source: '198.51.100.5',
        sourcePort: 443,
        destination: CLIENT.address,
        destinationPort: 60000,
        payload: [1, 2, 3, 4]
      })
    )
    expect(log.chunks).toEqual([])
    await source.stop()
  })

  it('puts segments back in order', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)

    const server = {
      source: LOBBY.address,
      sourcePort: LOBBY.port,
      destination: CLIENT.address,
      destinationPort: CLIENT.port
    }
    api.deliver(ethernetFrame({ ...server, sequence: 100, payload: [1, 2] }))
    api.deliver(ethernetFrame({ ...server, sequence: 104, payload: [5, 6] })) // early
    api.deliver(ethernetFrame({ ...server, sequence: 102, payload: [3, 4] })) // fills it

    expect(log.chunks.flatMap((c) => [...c.bytes])).toEqual([1, 2, 3, 4, 5, 6])
    await source.stop()
  })

  it('keeps the two directions in separate streams', async () => {
    // The two directions have unrelated sequence numbers. Sharing one stream
    // would make each direction look like a huge gap in the other.
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)

    const fromServer = {
      source: LOBBY.address,
      sourcePort: LOBBY.port,
      destination: CLIENT.address,
      destinationPort: CLIENT.port
    }
    const fromClient = {
      source: CLIENT.address,
      sourcePort: CLIENT.port,
      destination: LOBBY.address,
      destinationPort: LOBBY.port
    }

    api.deliver(ethernetFrame({ ...fromServer, sequence: 900000, payload: [1, 2] }))
    api.deliver(ethernetFrame({ ...fromClient, sequence: 5, payload: [3, 4] }))
    api.deliver(ethernetFrame({ ...fromServer, sequence: 900002, payload: [5, 6] }))
    api.deliver(ethernetFrame({ ...fromClient, sequence: 7, payload: [7, 8] }))

    const server = log.chunks.filter((c) => c.direction === 'serverToClient')
    const client = log.chunks.filter((c) => c.direction === 'clientToServer')
    expect(server.flatMap((c) => [...c.bytes])).toEqual([1, 2, 5, 6])
    expect(client.flatMap((c) => [...c.bytes])).toEqual([3, 4, 7, 8])
    expect(log.chunks.every((c) => !c.gap)).toBe(true)
    await source.stop()
  })

  it('reads the TCP table when an unknown connection opens', async () => {
    // The next hop's SYN can beat the poll. Waiting a whole interval would
    // lose the handshake, and with it the keys for that connection.
    api.connections = []
    let clock = 0
    const { sink, log } = sinkOf()
    const source = createPcapSource({
      device: 'adapter',
      api,
      pollIntervalMs: 100000,
      now: () => clock
    })
    await source.start(sink)
    expect(log.opens).toEqual([])

    clock = 1000 // well past the throttle
    api.connections = [established(WORLD, 51001)]
    api.deliver(
      ethernetFrame({
        source: CLIENT.address,
        sourcePort: 51001,
        destination: WORLD.address,
        destinationPort: WORLD.port,
        flags: TcpFlag.Syn
      })
    )

    expect(log.opens.map((c) => c.remotePort)).toEqual([WORLD.port])
    await source.stop()
  })

  it('delays a throttled table read rather than dropping it', async () => {
    // A SYN that arrives just after a read must still be picked up. The first
    // byte of payload is one round trip behind it.
    api.connections = []
    const { sink, log } = sinkOf()
    const source = createPcapSource({
      device: 'adapter',
      api,
      pollIntervalMs: 100000,
      now: () => 5000 // frozen, so every read is inside the throttle window
    })
    await source.start(sink)

    api.connections = [established(WORLD, 51001)]
    api.deliver(
      ethernetFrame({
        source: CLIENT.address,
        sourcePort: 51001,
        destination: WORLD.address,
        destinationPort: WORLD.port,
        flags: TcpFlag.Syn
      })
    )
    expect(log.opens).toEqual([]) // throttled for now

    await vi.waitFor(() => expect(log.opens.map((c) => c.remotePort)).toEqual([WORLD.port]), {
      timeout: 500
    })
    await source.stop()
  })

  it('reads the table once for a burst of unknown connections', async () => {
    api.connections = []
    const { sink } = sinkOf()
    const source = createPcapSource({
      device: 'adapter',
      api,
      pollIntervalMs: 100000,
      now: () => 5000
    })
    await source.start(sink)
    const before = api.tableReads

    for (let port = 60000; port < 60020; port++) {
      api.deliver(
        ethernetFrame({
          source: CLIENT.address,
          sourcePort: port,
          destination: '198.51.100.9',
          destinationPort: 443,
          flags: TcpFlag.Syn
        })
      )
    }
    expect(api.tableReads).toBe(before)

    await vi.waitFor(() => expect(api.tableReads).toBe(before + 1), { timeout: 500 })
    await source.stop()
  })

  it('closes a flow as soon as a reset or a fin is seen', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api, pollIntervalMs: 100000 })
    await source.start(sink)

    api.deliver(
      ethernetFrame({
        source: LOBBY.address,
        sourcePort: LOBBY.port,
        destination: CLIENT.address,
        destinationPort: CLIENT.port,
        flags: TcpFlag.Fin | TcpFlag.Ack
      })
    )
    expect(log.closes.map((c) => c.remotePort)).toEqual([LOBBY.port])
    await source.stop()
  })

  it('closes a flow the TCP table no longer lists', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api, pollIntervalMs: 5 })
    await source.start(sink)
    expect(log.opens).toHaveLength(1)

    api.connections = []
    await vi.waitFor(() => expect(log.closes).toHaveLength(1), { timeout: 500 })
    await source.stop()
  })

  it('combines the caller filter with tcp', async () => {
    const source = createPcapSource({ device: 'adapter', api, filter: 'host 203.0.113.7' })
    await source.start({})
    expect(api.lastFilter).toBe('tcp and (host 203.0.113.7)')
    await source.stop()
  })

  it('captures tcp only when no filter is given', async () => {
    const source = createPcapSource({ device: 'adapter', api })
    await source.start({})
    expect(api.lastFilter).toBe('tcp')
    await source.stop()
  })

  it('stops the capture and closes every flow', async () => {
    api.connections = [established(LOBBY)]
    const { sink, log } = sinkOf()
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)
    await source.stop()

    expect(api.stopped).toEqual([7])
    expect(log.closes).toHaveLength(1)
  })

  it('reports a table-read failure without stopping', async () => {
    const { sink, log } = sinkOf()
    api.processIdsByName = () => {
      throw new Error('table read failed')
    }
    const source = createPcapSource({ device: 'adapter', api })
    await source.start(sink)
    expect(log.errors.map((e) => e.message)).toEqual(['table read failed'])
    await source.stop()
  })
})

describe('deviceForAddress', () => {
  const devices: CaptureDevice[] = [
    {
      name: 'a',
      description: 'Hyper-V',
      loopback: false,
      addresses: [{ address: '172.26.48.1', netmask: '255.255.240.0' }]
    },
    {
      name: 'b',
      description: 'Realtek',
      loopback: false,
      addresses: [{ address: '192.168.1.20', netmask: '255.255.255.0' }]
    }
  ]

  it('picks the adapter that owns the address', () => {
    expect(deviceForAddress(devices, '192.168.1.20')?.name).toBe('b')
  })

  it('returns nothing when no adapter owns it', () => {
    expect(deviceForAddress(devices, '10.0.0.1')).toBeUndefined()
  })
})
