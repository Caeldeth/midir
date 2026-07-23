import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CaptureAvailability } from '../shared/types'
import { createPcapSource, loadPcapApi, type PcapApi } from './capture/pcapSource'
import { createCaptureService } from './captureService'
import {
  CAPTURE_STATUS_CHANNEL,
  CHARACTER_CHANGED_CHANNEL,
  registerHandlers,
  type HandlerContext
} from './handlers'
import { createSettingsManager } from './settingsManager'
import { createSplashWindow } from './splash'
import { createCharacterStore } from './store/characterStore'

// Settings + cache both under %LOCALAPPDATA%/Erisco/Midir (local). On Windows,
// Electron's appData path is the ROAMING dir, so we resolve %LOCALAPPDATA%
// ourselves. macOS/Linux have no roaming concept; appData is local.
const localAppData =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'))
    : app.getPath('appData')
const settingsPath = join(localAppData, 'Erisco', 'Midir')
app.setPath('userData', settingsPath)

// One-time roaming → local settings migration (Windows). Best-effort: if a
// returning user has settings under %APPDATA%/Erisco/Midir, carry them over.
function migrateSettingsFromRoaming(): void {
  try {
    const oldDir = join(app.getPath('appData'), 'Erisco', 'Midir')
    if (oldDir === settingsPath) return // same location (non-Windows) — nothing to do
    const newPrimary = join(settingsPath, 'settings.json')
    if (existsSync(newPrimary)) return // already migrated or fresh local settings exist
    const oldPrimary = join(oldDir, 'settings.json')
    if (!existsSync(oldPrimary)) return // nothing to migrate
    mkdirSync(settingsPath, { recursive: true })
    copyFileSync(oldPrimary, newPrimary)
    const oldBackup = join(oldDir, 'settings.bak.json')
    if (existsSync(oldBackup)) copyFileSync(oldBackup, join(settingsPath, 'settings.bak.json'))
  } catch {
    /* best effort — settings manager falls back to defaults */
  }
}
migrateSettingsFromRoaming()

const settingsManager = createSettingsManager(settingsPath)

// Startup splash: shown immediately at boot, torn down once the renderer signals
// `app:ready` (settings hydrated). A safety timeout backstops a renderer that
// never signals.
let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let mainWindowRevealed = false

/** Send a push to the renderer, if a window is there to receive it. */
function pushToRenderer(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

// The addon is loaded once and kept, because a missing Npcap must become a
// message rather than a crash.
let pcap: PcapApi | null = null
let pcapLoadError: string | null = null
try {
  pcap = loadPcapApi()
} catch (error) {
  pcapLoadError = error instanceof Error ? error.message : String(error)
}

function captureAvailability(): CaptureAvailability {
  if (pcap === null) {
    return {
      available: false,
      reason: pcapLoadError ?? 'Packet capture is unavailable.',
      devices: []
    }
  }
  if (!pcap.isAvailable()) {
    return {
      available: false,
      reason: pcap.loadError() ?? 'Packet capture is unavailable.',
      devices: []
    }
  }
  try {
    return {
      available: true,
      devices: pcap.listDevices().map((device) => ({
        name: device.name,
        description: device.description,
        loopback: device.loopback,
        addresses: device.addresses.map((address) => address.address)
      }))
    }
  } catch (error) {
    return {
      available: false,
      reason: error instanceof Error ? error.message : String(error),
      devices: []
    }
  }
}

const characterStore = createCharacterStore(settingsPath, (failure) => {
  console.error(`[characters] ${failure.stage}: ${failure.path} — ${failure.message}`)
})

const captureService = createCaptureService({
  store: characterStore,
  createSource: (device) => {
    if (pcap === null) throw new Error(pcapLoadError ?? 'Packet capture is unavailable.')
    return createPcapSource({ device, api: pcap })
  },
  onStatus: (status) => pushToRenderer(CAPTURE_STATUS_CHANNEL, status),
  onCharacter: (record) => pushToRenderer(CHARACTER_CHANGED_CHANNEL, record)
})

const ctx: HandlerContext = {
  settingsPath,
  settingsManager,
  appGetVersion: () => app.getVersion(),
  captureAvailability,
  captureService,
  characterStore
}

function revealMainWindow(): void {
  if (mainWindowRevealed) return
  mainWindowRevealed = true
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
  if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy()
  splashWindow = null
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    icon: join(__dirname, '../../resources/midir.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow = win

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html')).catch((err) => {
      console.error('Failed to load file:', err)
    })
  }
}

// Reveal the main window (and dismiss the splash) once the renderer reports it
// has hydrated its settings — see the `app:ready` IPC handler in handlers.ts.
ctx.onAppReady = revealMainWindow

app.whenReady().then(() => {
  // Must match electron-builder's `appId` — the NSIS installer registers the
  // shortcut under that id, so a mismatched AUMID leaves the running window
  // unassociated with the installed app (generic taskbar icon + "Electron" name).
  // This id must stay equal to `appId` in electron-builder.yml. If the two
  // differ, Windows cannot match the window to the installed shortcut and it
  // shows the generic Electron icon and name in the taskbar.
  electronApp.setAppUserModelId('co.eris.midir')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Splash first so the user sees branded feedback instantly, then the (hidden)
  // main window loads behind it. The splash is torn down on `app:ready`.
  splashWindow = createSplashWindow()
  createWindow()

  // Safety backstop: if the renderer errors before signalling `app:ready`, force
  // the window visible so the app can never be left permanently invisible.
  setTimeout(revealMainWindow, 15000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowRevealed = false
      splashWindow = createSplashWindow()
      createWindow()
      setTimeout(revealMainWindow, 15000)
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// Stop the capture and write anything still pending before the process ends.
// A character seen this session must survive the app closing.
app.on('before-quit', (event) => {
  if (!captureService.status().running) return
  event.preventDefault()
  void captureService.stop().finally(() => app.quit())
})

registerHandlers({ ipcMain, BrowserWindow }, ctx)
