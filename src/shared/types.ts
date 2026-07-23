// Pure types + defaults shared between main, preload, and renderer. No runtime
// imports from electron or node so this file is safe to pull from any process.

import type { CharacterRecord } from './character'

export * from './character'

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
}

export const DEFAULT_SETTINGS: MidirSettings = {
  theme: 'hybrasyl',
  captureDevice: '',
  autoStartCapture: false,
  recordSessions: false
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
   * `decoding` — reading a named character's packets.
   */
  state: 'stopped' | 'listening' | 'decoding'
  /** The adapter in use. */
  device?: string
  /** The character being decoded now. */
  characterName?: string
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
}
