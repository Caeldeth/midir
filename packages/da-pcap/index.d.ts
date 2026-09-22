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

/** One top-level window that belongs to a process. */
export interface GameWindow {
  /** The window handle (`HWND`), for `postMessageToWindow` and the others. */
  handle: number
  /** The window title, which the picker shows to the user. */
  title: string
}

/**
 * The visible, titled top-level windows that belong to one process.
 *
 * The action layer resolves the game window from the client's process id. A
 * window with no title is a helper window, so it is left out.
 */
export declare function windowsForPid(pid: number): GameWindow[]

/**
 * Post one message to a window's own input queue.
 *
 * This is how a key press or a click reaches the client without stealing the
 * user's focus. The message goes to `handle` and nowhere else. The call reads
 * no memory and injects no code. Returns false when the post fails, for example
 * when the window is gone.
 */
export declare function postMessageToWindow(
  handle: number,
  message: number,
  wParam: number,
  lParam: number
): boolean

/** Where the real pointer is, relative to a window's client area. */
export interface PointerState {
  /** Client-area coordinates. Negative or past the size when outside. */
  x: number
  y: number
  /** True while the pointer is over the client area. */
  inside: boolean
  /** True while the left button is held down. */
  leftDown: boolean
  /** True while the right button is held down. */
  rightDown: boolean
  /** The client area's size, for scaling to the game's own 640 x 480 coordinates. */
  width: number
  height: number
}

/** The size of a window's client area, and whether the window is DPI-aware. */
export interface ClientSize {
  width: number
  height: number
  /**
   * False when Windows stretches the window on a scaled display. Such a
   * window believes it is its own unscaled size, and a posted message must
   * carry its unscaled coordinates. True means the client area is what it
   * says, and a game coordinate is scaled to it.
   */
  dpiAware: boolean
}

/**
 * The size of a window's client area, or null when the handle is not a live
 * window. The game draws its 640 x 480 world at whatever size the window is,
 * so a position in the game's own coordinates is scaled by this before it is
 * posted, unless Windows is doing the stretching (`dpiAware` false).
 */
export declare function clientSize(handle: number): ClientSize | null

/**
 * The real pointer's position in a window's client area, and the left button.
 *
 * This reads the operating system's input state, never the client's memory. A
 * posted click moves nothing here, so a watcher on this sees only the user's
 * own clicks. Returns null when the handle is not a live window.
 */
export declare function pointerIn(handle: number): PointerState | null

/** Bring a window to the foreground once, so the user sees the target. */
export declare function setForegroundWindow(handle: number): boolean

/** The handle of the window that has focus now. Zero when there is none. */
export declare function foregroundWindow(): number

/** True while `handle` names a live window. Used to stop when the game closes. */
export declare function isWindow(handle: number): boolean
