import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { MidirApi, MidirSettings } from '../shared/types'

const api: MidirApi = {
  // Window controls (frameless window — chrome lives in the renderer)
  minimizeWindow: () => ipcRenderer.send('minimize-window'),
  maximizeWindow: () => ipcRenderer.send('maximize-window'),
  closeWindow: () => ipcRenderer.send('close-window'),

  // App
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  // Signals the main process that the renderer has hydrated (settings loaded),
  // so it can reveal the main window and dismiss the startup splash.
  appReady: (): void => ipcRenderer.send('app:ready'),

  settings: {
    // Settings persist as a human-readable JSON file at
    // %LOCALAPPDATA%/Erisco/Midir/settings.json (with .bak.json + .tmp.json
    // siblings for crash-safe writes). Save validates with Zod in main.
    load: (): Promise<MidirSettings> => ipcRenderer.invoke('settings:load'),
    save: (settings: MidirSettings): Promise<void> => ipcRenderer.invoke('settings:save', settings)
  }
}

// We always run with contextIsolation: true (the BrowserWindow default),
// so the non-isolated fallback some scaffolds ship with is dead code here.
contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('api', api)
