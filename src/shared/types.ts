// Pure types + defaults shared between main, preload, and renderer. No runtime
// imports from electron or node so this file is safe to pull from any process.

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
}

export const DEFAULT_SETTINGS: MidirSettings = {
  theme: 'hybrasyl'
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
}
