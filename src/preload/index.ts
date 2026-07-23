import { electronAPI } from '@electron-toolkit/preload'
import { contextBridge, ipcRenderer } from 'electron'
import type {
  CaptureAvailability,
  CaptureStatus,
  CharacterRecord,
  LogEntry,
  LogFileInfo,
  MidirApi,
  MidirSettings,
  RecordingInfo
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

  icons: {
    chooseFolder: (): Promise<string | null> => ipcRenderer.invoke('icons:chooseFolder'),
    probe: (path: string): Promise<{ legendFound: boolean }> =>
      ipcRenderer.invoke('icons:probe', path)
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
  },

  diagnostics: {
    // The log lives at %LOCALAPPDATA%/Erisco/Midir/logs, one file for each
    // launch. The recordings live beside it. Main owns both folders, so the
    // renderer sends a file name and never a path.
    listLogs: (): Promise<LogFileInfo[]> => ipcRenderer.invoke('logs:list'),
    readLog: (name: string): Promise<LogEntry[]> => ipcRenderer.invoke('logs:read', name),
    openLogsFolder: (): Promise<void> => ipcRenderer.invoke('logs:openFolder'),
    report: (error: { source: string; message: string; stack?: string }): Promise<void> =>
      ipcRenderer.invoke('logs:report', error),
    onLogEntry: (handler: (entry: LogEntry) => void): (() => void) =>
      subscribe('logs:appended', handler),

    listRecordings: (): Promise<RecordingInfo[]> => ipcRenderer.invoke('recordings:list'),
    deleteRecording: (name: string): Promise<void> => ipcRenderer.invoke('recordings:delete', name),
    deleteAllRecordings: (): Promise<number> => ipcRenderer.invoke('recordings:deleteAll'),
    openRecordingsFolder: (): Promise<void> => ipcRenderer.invoke('recordings:openFolder')
  }
}

// Midir always runs with contextIsolation on, which is the BrowserWindow
// default, so the non-isolated fallback some scaffolds ship with is dead code.
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
