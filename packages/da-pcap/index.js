// da-pcap — passive Npcap capture and Windows TCP-table lookup.
//
// Capture is Windows-only. On any other platform this module exports a stub
// that reports "not supported", so the test suite and the type checker run
// everywhere.

const NOT_SUPPORTED = 'Packet capture is supported on Windows only.'

const NO_NPCAP =
  'Npcap is not installed, or it was not installed in WinPcap API-compatible mode. ' +
  'Install it from https://npcap.com and enable that option.'

/** TCP states, as GetExtendedTcpTable reports them. */
const TcpState = {
  CLOSED: 1,
  LISTEN: 2,
  SYN_SENT: 3,
  SYN_RCVD: 4,
  ESTABLISHED: 5,
  FIN_WAIT1: 6,
  FIN_WAIT2: 7,
  CLOSE_WAIT: 8,
  CLOSING: 9,
  LAST_ACK: 10,
  TIME_WAIT: 11,
  DELETE_TCB: 12
}

/** Link-layer types, as pcap_datalink reports them. */
const DataLink = {
  /** BSD loopback. A four-byte address-family header. */
  NULL: 0,
  /** Ethernet. A fourteen-byte header. This is what Npcap reports for Wi-Fi too. */
  EN10MB: 1,
  /** Raw IP, with no link header at all. */
  RAW: 101
}

function stub() {
  throw new Error(NOT_SUPPORTED)
}

const unsupported = {
  isAvailable: () => false,
  loadError: () => NOT_SUPPORTED,
  listDevices: stub,
  startCapture: stub,
  stopCapture: stub,
  tcpConnectionsForPid: stub,
  processIdsByName: stub
}

let addon = unsupported

if (process.platform === 'win32') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  addon = require('./build/Release/da_pcap.node')
}

module.exports = {
  ...addon,
  TcpState,
  DataLink,
  NOT_SUPPORTED,
  NO_NPCAP
}
