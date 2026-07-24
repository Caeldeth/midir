// Pure types + defaults shared between main, preload, and renderer. No runtime
// imports from electron or node so this file is safe to pull from any process.

import type { CharacterRecord } from './character'
import type { LogEntry, LogFileInfo, RecordingInfo } from './log'

export * from './character'
export * from './items'
export * from './log'

export type ThemeName = 'hybrasyl' | 'chadul' | 'danaan' | 'grinneal' | 'mundanes' | 'dubhaimid'

export const THEME_NAMES: ThemeName[] = [
  'hybrasyl',
  'chadul',
  'danaan',
  'grinneal',
  'mundanes',
  'dubhaimid'
]

/**
 * The "corporate/plain" themes. Chrome that's stylized for the four fantasy
 * themes (skull window glyphs, #000 keyline/drop shadows) drops to flat MUI
 * icons and no shadows for these — see TitleBar.
 */
export const PLAIN_CHROME_THEMES: ThemeName[] = ['mundanes', 'dubhaimid']

export interface MidirSettings {
  theme: ThemeName
  /** The capture adapter to use. Empty means "ask the user to choose one". */
  captureDevice: string
  /** Start capturing as soon as Midir opens. */
  autoStartCapture: boolean
  /** Write every captured session to a file. This is a developer aid. */
  recordSessions: boolean
  /**
   * Delete the oldest recordings when the folder holds more than this many
   * megabytes. Zero means no limit. The recording being written is never
   * deleted.
   */
  recordingCapMb: number
  /** Show the Diagnostics tab in the navigation bar. */
  showDiagnostics: boolean
  /**
   * The Dark Ages install folder, the one that holds `legend.dat`. Midir reads
   * it only to draw item icons. It is optional: when it is unset, or holds no
   * `legend.dat`, icons stay off and every view renders exactly as it does with
   * no game installed.
   */
  darkAgesPath?: string
}

/** The largest cap the settings accept, in megabytes. */
export const MAX_RECORDING_CAP_MB = 102_400

export const DEFAULT_SETTINGS: MidirSettings = {
  theme: 'hybrasyl',
  captureDevice: '',
  autoStartCapture: false,
  recordSessions: false,
  recordingCapMb: 1024,
  showDiagnostics: true
}

/** One adapter Midir can capture from. */
export interface CaptureDeviceInfo {
  name: string
  description: string
  loopback: boolean
  addresses: string[]
}

/** Whether Midir can capture at all, and why not when it cannot. */
export interface CaptureAvailability {
  available: boolean
  /** The reason capture is unavailable, ready to show to the user. */
  reason?: string
  devices: CaptureDeviceInfo[]
}

/** What capture is doing now. */
export interface CaptureStatus {
  running: boolean
  /**
   * `stopped` — not listening.
   * `listening` — listening, but no character decoded yet.
   * `decoding` — at least one character is being decoded.
   *
   * Derived from `characters`: never set it apart from the list.
   */
  state: 'stopped' | 'listening' | 'decoding'
  /** The adapter in use. */
  device?: string
  /**
   * Every character being decoded now, in the order the connections opened.
   * Always present; empty is the ordinary "listening" case. One entry is one
   * client, and two entries are two clients open at once.
   */
  characters: string[]
  /** The file this session is being recorded to, when recording is on. */
  recordingPath?: string
  /** How many of the game client's connections are being followed. */
  connections: number
  /** How many packets have been decoded since capture started. */
  decodedCount: number
  /** How many packets arrived that could not be turned into an object. */
  unreadableCount: number
  /**
   * True once a packet arrived that needed a session key Midir never saw.
   * This means Midir started after the player logged in. The user must be
   * told, because the fix is to start Midir first.
   */
  missedHandshake: boolean
  /** The last problem worth showing. */
  error?: string
}

export const STOPPED_STATUS: CaptureStatus = {
  running: false,
  state: 'stopped',
  characters: [],
  connections: 0,
  decodedCount: 0,
  unreadableCount: 0,
  missedHandshake: false
}

/**
 * The preload bridge contract. Implemented in src/preload/index.ts and exposed
 * to the renderer as `window.api` (see src/renderer/src/env.d.ts).
 */
export interface MidirApi {
  // Window controls (frameless window — chrome lives in the renderer)
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void

  // App
  getAppVersion: () => Promise<string>
  /** Signals main that the renderer has hydrated so it can reveal the window
   *  and dismiss the startup splash. */
  appReady: () => void

  settings: {
    load: () => Promise<MidirSettings>
    save: (settings: MidirSettings) => Promise<void>
  }

  /**
   * Item icons, drawn from the game's own `legend.dat`. The pixels arrive over
   * the `midir-icon://` protocol, not through this bridge; these two calls only
   * pick the folder and report whether icons are on.
   */
  icons: {
    /** Open a folder picker for the Dark Ages install. Returns the path, or null. */
    chooseFolder: () => Promise<string | null>
    /** Whether `legend.dat` is present in `path`. Drives the Settings on/off note. */
    probe: (path: string) => Promise<{ legendFound: boolean }>
  }

  capture: {
    /** Whether capture is possible, and the adapters to choose from. */
    availability: () => Promise<CaptureAvailability>
    /** Begin capturing on `device`. Rejects with a message to show the user. */
    start: (device: string) => Promise<CaptureStatus>
    stop: () => Promise<CaptureStatus>
    status: () => Promise<CaptureStatus>
    /** Watch the status. Call the returned function to stop watching. */
    onStatus: (handler: (status: CaptureStatus) => void) => () => void
  }

  characters: {
    /** Every character Midir has recorded, newest first. */
    list: () => Promise<CharacterRecord[]>
    get: (name: string) => Promise<CharacterRecord | null>
    /** Forget one character. */
    remove: (name: string) => Promise<void>
    /** Watch for a character that changed. Call the result to stop watching. */
    onChanged: (handler: (record: CharacterRecord) => void) => () => void
  }

  /**
   * Every file Midir writes for diagnosis: the log and the session recordings.
   *
   * A recording still holds the character name and that session's encryption
   * keys after the credential scrub. Treat one as private data.
   */
  diagnostics: {
    /** Every log file, newest first. */
    listLogs: () => Promise<LogFileInfo[]>
    /** Read one log file. The newest entries are returned, up to a limit. */
    readLog: (name: string) => Promise<LogEntry[]>
    openLogsFolder: () => Promise<void>
    /** Send a renderer error to the same log the main process writes. */
    report: (error: { source: string; message: string; stack?: string }) => Promise<void>
    /** Watch the log as it is written. Call the result to stop watching. */
    onLogEntry: (handler: (entry: LogEntry) => void) => () => void

    /** Every session recording, newest first. */
    listRecordings: () => Promise<RecordingInfo[]>
    deleteRecording: (name: string) => Promise<void>
    /** Delete every recording except the one being written. Returns how many went. */
    deleteAllRecordings: () => Promise<number>
    openRecordingsFolder: () => Promise<void>
  }
}
