// Pure types + defaults shared between main, preload, and renderer. No runtime
// imports from electron or node so this file is safe to pull from any process.

import type {
  BoardPollOutcome,
  BoardPollRequest,
  BoardPollState,
  BoardRecord,
  BoardSummary
} from './boards'
import type { CharacterRecord } from './character'
import type { LogEntry, LogFileInfo, RecordingInfo } from './log'
import type {
  AssistState,
  AssistWindow,
  Errand,
  ErrandOutcome,
  ErrandRequest,
  LaborerState,
  SpeakerConfig,
  SpeakerState,
  WalkerDestination,
  WalkerState,
  WalkOutcome,
  WalkRequest
} from './actionLayer'

export * from './character'
export * from './items'
export * from './log'
export * from './actionLayer'
export * from './boards'
export * from './map'
import type { MapPosition, MapSummary, MapViewResult, WarpEdit } from './map'

/** How **Open GitHub issue** ended. The copy to the clipboard happened in both cases. */
export type OpenIssueResult = { ok: true; truncated: boolean } | { ok: false; reason: 'unsafe-url' }

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
  /**
   * The global hotkey that stops every driving assistant. It works from any
   * window, so a runaway driver can always be stopped. An Electron accelerator
   * string, for example `CommandOrControl+Alt+.`.
   */
  assistStopHotkey: string
  /**
   * The global hotkey that starts or stops the Speaker on the selected window.
   * An Electron accelerator string. Empty means no hotkey.
   */
  speakerToggleHotkey: string
  /** Also stop a driver when the game window it drives loses focus. */
  assistStopOnFocusLoss: boolean
  /** The lines the Speaker sends, in order. */
  speakerLines: string[]
  /** The floor between the Speaker's lines, in milliseconds. */
  speakerIntervalMs: number
  /** Rotate the list forever. When false, the Speaker sends each line once. */
  speakerRepeat: boolean
  /** The Walker destinations the user pinned, each a place name or a map id. */
  walkerPinnedDestinations: string[]
  /**
   * Walk by right-click: the walker hands a stretch of up to eight tiles to
   * the client's own pathfinder with one right-click on empty ground, and
   * confirms every tile off the wire as it does with the keys (WP35). Off by
   * default, like every driving feature; the arrow keys are the shipped walk.
   */
  walkerRightClick: boolean
  /**
   * Hide a character not seen for this many days (WP25). 0 is off. The days
   * count back from the newest sighting in the record, capture time, not from
   * the wall clock. Hiding is a view: the record stays in the file, and only
   * Forget removes one.
   */
  hideUnseenDays: number
}

/** The largest cap the settings accept, in megabytes. */
export const MAX_RECORDING_CAP_MB = 102_400

export const DEFAULT_SETTINGS: MidirSettings = {
  theme: 'hybrasyl',
  captureDevice: '',
  autoStartCapture: false,
  recordSessions: false,
  recordingCapMb: 1024,
  showDiagnostics: true,
  assistStopHotkey: 'CommandOrControl+Alt+.',
  speakerToggleHotkey: 'CommandOrControl+Alt+;',
  assistStopOnFocusLoss: false,
  speakerLines: [],
  speakerIntervalMs: 5000,
  speakerRepeat: true,
  walkerPinnedDestinations: [],
  walkerRightClick: false,
  hideUnseenDays: 0
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

  /**
   * The action layer that drives a game window, and the one stop that always
   * works. Every driving assistant runs through it.
   */
  assist: {
    /** The open game windows the user can pick to drive. */
    windows: () => Promise<AssistWindow[]>
    /** Stop every driving assistant now. */
    stopAll: () => Promise<void>
    /** Clear a stop so an assistant can start again. */
    clearStop: () => Promise<void>
    /** Whether a stop is in force now. */
    state: () => Promise<AssistState>
    /** Watch the stop state. Call the result to stop watching. */
    onState: (handler: (state: AssistState) => void) => () => void
  }

  /** The Speaker: type a rotating list of lines into one selected window. */
  speaker: {
    /** Start speaking on the bound connection. Rejects with a message to show. */
    start: (config: SpeakerConfig) => Promise<void>
    /** Stop the Speaker on one connection. */
    stop: (connectionId: string) => Promise<void>
    /** Every Speaker running now. */
    state: () => Promise<SpeakerState[]>
    /** Watch a Speaker as it changes. Call the result to stop watching. */
    onState: (handler: (state: SpeakerState) => void) => () => void
    /** The global hotkey asked to toggle the Speaker. Call the result to stop. */
    onToggle: (handler: () => void) => () => void
  }

  /** The Walker: name a place, and the character walks there across maps. */
  walker: {
    /** Every place the walker can be sent to, for the destination picker. */
    destinations: () => Promise<WalkerDestination[]>
    /** Walk the bound character to a place. Resolves with how the walk ended. */
    go: (request: WalkRequest) => Promise<WalkOutcome>
    /** Stop the Walker on one connection. */
    stop: (connectionId: string) => Promise<void>
    /** Every Walker running now. */
    state: () => Promise<WalkerState[]>
    /** Watch a Walker as it changes. Call the result to stop watching. */
    onState: (handler: (state: WalkerState) => void) => () => void
  }

  laborer: {
    /** Every built-in errand, for the picker. */
    list: () => Promise<Errand[]>
    /** Run one built-in errand. Resolves with how it ended. */
    run: (request: ErrandRequest) => Promise<ErrandOutcome>
    /** Stop the Laborer on one connection. */
    stop: (connectionId: string) => Promise<void>
    /** Every Laborer running now. */
    state: () => Promise<LaborerState[]>
    /** Watch a Laborer as it changes. Call the result to stop watching. */
    onState: (handler: (state: LaborerState) => void) => () => void
  }

  boards: {
    /** Every board and mailbox the archive knows, most recently seen first (WP36). */
    list: () => Promise<BoardSummary[]>
    /** One board with every post it holds. */
    get: (key: string) => Promise<BoardRecord | null>
    /** Export one board to a file the user picks. Resolves with the path, or null when cancelled. */
    exportJson: (key: string) => Promise<string | null>
    /** Watch for the archive changing. Call the result to stop watching. */
    onChanged: (handler: () => void) => () => void
    /** Read every board and the mailbox on one window (WP36 PR2). Resolves with how it ended. */
    poll: (request: BoardPollRequest) => Promise<BoardPollOutcome>
    /** Stop the poll on one window. */
    stopPoll: (connectionId: string) => Promise<void>
    /** Every poll running now. */
    pollState: () => Promise<BoardPollState[]>
    /** Watch a poll as it changes. Call the result to stop watching. */
    onPollState: (handler: (state: BoardPollState) => void) => () => void
  }
  map: {
    /** Every map the graph or the wire knows, by id (WP30). */
    list: () => Promise<MapSummary[]>
    /** One map's passability and warps, or why it cannot be drawn. */
    view: (mapId: number) => Promise<MapViewResult>
    /** Where every live character stands now. */
    positions: () => Promise<MapPosition[]>
    /** Accept, reject, restore, or nudge a warp; answers with the map as it now stands. */
    editWarp: (edit: WarpEdit) => Promise<MapViewResult>
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
    /**
     * Report an issue (the house module): the scrubbed diagnostics block, for
     * the dialog to show EDITABLE. Main assembles it from its own version and
     * its own log, so the bundle the user reviews is one main built.
     */
    buildReport: () => Promise<string>
    /**
     * Copy the full report to the clipboard, then open a prefilled issue on
     * `hybrasyl/cernunnos` in the system browser. The copy always happens
     * first: a URL trimmed to fit is completed by paste.
     */
    openIssue: (title: string, body: string) => Promise<OpenIssueResult>
    /** The clipboard alone. No account, no browser, no budget. */
    copyReport: (body: string) => Promise<{ ok: true }>

    /** Every session recording, newest first. */
    listRecordings: () => Promise<RecordingInfo[]>
    deleteRecording: (name: string) => Promise<void>
    /** Delete every recording except the one being written. Returns how many went. */
    deleteAllRecordings: () => Promise<number>
    openRecordingsFolder: () => Promise<void>
  }
}
