import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CaptureAvailability,
  CaptureStatus,
  CharacterRecord,
  MidirApi,
  MidirSettings
} from '../shared/types'

/** Subscribe to a main-to-renderer push. The result unsubscribes. */
function subscribe<T>(channel: string, handler: (value: T) => void): () => void {
  const listener = (_event: unknown, value: T): void => handler(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: MidirApi = {
  // Window controls. The window is frameless, so its chrome is in the renderer.
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  // Tell the main process the renderer has hydrated, so it can reveal the main
  // window and close the splash.
  appReady: (): void => ipcRenderer.send('app:ready'),

  settings: {
    // Settings are a readable JSON file at
    // %LOCALAPPDATA%/Erisco/Midir/settings.json, with .bak.json and .tmp.json
    // beside it for crash-safe writes. Main validates a save with Zod.
    load: (): Promise<MidirSettings> => ipcRenderer.invoke('settings:load'),
    save: (settings: MidirSettings): Promise<void> => ipcRenderer.invoke('settings:save', settings)
  },

  capture: {
    availability: (): Promise<CaptureAvailability> => ipcRenderer.invoke('capture:availability'),
    start: (device: string): Promise<CaptureStatus> => ipcRenderer.invoke('capture:start', device),
    stop: (): Promise<CaptureStatus> => ipcRenderer.invoke('capture:stop'),
    status: (): Promise<CaptureStatus> => ipcRenderer.invoke('capture:status'),
    onStatus: (handler: (status: CaptureStatus) => void): (() => void) =>
      subscribe('capture:status-changed', handler)
  },

  characters: {
    list: (): Promise<CharacterRecord[]> => ipcRenderer.invoke('characters:list'),
    get: (name: string): Promise<CharacterRecord | null> =>
      ipcRenderer.invoke('characters:get', name),
    remove: (name: string): Promise<void> => ipcRenderer.invoke('characters:remove', name),
    onChanged: (handler: (record: CharacterRecord) => void): (() => void) =>
      subscribe('characters:changed', handler)
  }
}

// Midir always runs with contextIsolation on, which is the BrowserWindow
// default, so the non-isolated fallback some scaffolds ship with is dead code.
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
