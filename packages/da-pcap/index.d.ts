/** One address bound to a capture adapter. */
export interface DeviceAddress {
  address: string
  netmask: string
}

/** One adapter Npcap can capture from. */
export interface CaptureDevice {
  /** The adapter's Npcap name. Pass this to `startCapture`. */
  name: string
  /** The adapter's readable description, which may be empty. */
  description: string
  loopback: boolean
  addresses: DeviceAddress[]
}

/** One captured link-layer frame. */
export interface CapturedPacket {
  /** The capture timestamp, in milliseconds since the Unix epoch. */
  timestampMs: number
  /** The frame as captured, link header first. */
  bytes: Buffer
}

export interface StartCaptureOptions {
  /** The adapter name from `listDevices`. */
  device: string
  /** An optional BPF filter, for example `tcp and host 1.2.3.4`. */
  filter?: string
}

export interface CaptureHandle {
  /** Pass this to `stopCapture`. */
  id: number
  /** The link-layer type of this adapter. See `DataLink`. */
  datalink: number
}

/** One TCP connection the operating system reports. */
export interface TcpConnection {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  /** A `TcpState` value. */
  state: number
}

/** TCP states, as GetExtendedTcpTable reports them. */
export declare const TcpState: {
  readonly CLOSED: 1
  readonly LISTEN: 2
  readonly SYN_SENT: 3
  readonly SYN_RCVD: 4
  readonly ESTABLISHED: 5
  readonly FIN_WAIT1: 6
  readonly FIN_WAIT2: 7
  readonly CLOSE_WAIT: 8
  readonly CLOSING: 9
  readonly LAST_ACK: 10
  readonly TIME_WAIT: 11
  readonly DELETE_TCB: 12
}

/** Link-layer types, as pcap_datalink reports them. */
export declare const DataLink: {
  /** BSD loopback. A four-byte address-family header. */
  readonly NULL: 0
  /** Ethernet. A fourteen-byte header. Npcap reports this for Wi-Fi too. */
  readonly EN10MB: 1
  /** Raw IP, with no link header at all. */
  readonly RAW: 101
}

/** The message the stub reports on a platform that is not Windows. */
export declare const NOT_SUPPORTED: string

/** The message to show when wpcap.dll is missing. */
export declare const NO_NPCAP: string

/** True while wpcap.dll is loaded and every needed export was found. */
export declare function isAvailable(): boolean

/** Why capture is unavailable, or null when it is available. */
export declare function loadError(): string | null

/** List the adapters Npcap can capture from. */
export declare function listDevices(): CaptureDevice[]

/**
 * Start capturing on one adapter.
 *
 * `onBatch` runs on the main JavaScript thread. A batch arrives when 64 packets
 * have been gathered or when the adapter read times out, whichever is first.
 */
export declare function startCapture(
  options: StartCaptureOptions,
  onBatch: (packets: CapturedPacket[]) => void
): CaptureHandle

/** Stop a capture. Returns false when the id is not a running capture. */
export declare function stopCapture(id: number): boolean

/** The TCP connections that belong to one process. */
export declare function tcpConnectionsForPid(pid: number): TcpConnection[]

/** The process ids whose executable name matches, compared without case. */
export declare function processIdsByName(name: string): number[]
