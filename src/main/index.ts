import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { copyFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { CaptureAvailability } from '../shared/types'
import { createPcapSource, loadPcapApi, type PcapApi } from './capture/pcapSource'
import { createIconService } from './icons/iconService'
import { registerIconProtocol } from './icons/protocol'
import { createRecorder, type Recorder } from './capture/recorder'
import { createCaptureService } from './captureService'
import {
  CAPTURE_STATUS_CHANNEL,
  CHARACTER_CHANGED_CHANNEL,
  LOG_APPENDED_CHANNEL,
  registerHandlers,
  type HandlerContext
} from './handlers'
import { createLogger, messageOf } from './log'
import { pruneRecordings } from './recordings'
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

// The item-icon scheme must be declared privileged before the app is ready, so
// an `<img src="midir-icon://...">` can load it. The handler is installed after
// the app is ready (see whenReady). Icons are decoration over a complete
// record; the scheme carries no data the renderer could not do without.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'midir-icon',
    privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true }
  }
])

// Startup splash: shown immediately at boot, torn down once the renderer signals
// `app:ready` (settings hydrated). A safety timeout backstops a renderer that
// never signals.
//
// These come before the logger, because the logger pushes each entry to the
// window and reads `mainWindow` to do it.
let mainWindow: BrowserWindow | null = null
let splashWindow: BrowserWindow | null = null
let mainWindowRevealed = false

/** Send a push to the renderer, if a window is there to receive it. */
function pushToRenderer(channel: string, value: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, value)
}

/** Where the log and the recordings live, beside the settings. */
const logsPath = join(settingsPath, 'logs')
/** Where a recorded session is written. */
const recordingsPath = join(settingsPath, 'recordings')

// The log opens before anything else that can fail, so the first failure of a
// launch is already written. A packaged build has no console, so this file is
// the only way a user can say why something did not work.
const log = createLogger(logsPath, {
  onEntry: (entry) => pushToRenderer(LOG_APPENDED_CHANNEL, entry)
})
log.info('app', 'Midir started.')

const settingsManager = createSettingsManager(settingsPath, log)

// The addon is loaded once and kept, because a missing Npcap must become a
// message rather than a crash.
let pcap: PcapApi | null = null
let pcapLoadError: string | null = null
try {
  pcap = loadPcapApi()
} catch (error) {
  pcapLoadError = error instanceof Error ? error.message : String(error)
  log.error('capture', `Packet capture is unavailable: ${pcapLoadError}`)
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
  log.error('characters', `${failure.stage}: ${failure.path} — ${failure.message}`)
})

/**
 * Start a recording, but only when the user asked for one. The setting is read
 * fresh at every start, so turning it on takes effect on the next capture.
 *
 * The oldest recordings go once the new one is open, so a user who leaves
 * recording on cannot fill the disk. The new file is passed to the prune, so
 * the recording that is starting is never the one deleted.
 */
async function startRecordingIfWanted(startedAtMs: number): Promise<Recorder | null> {
  try {
    const settings = await settingsManager.load()
    if (!settings.recordSessions) return null
    const stamp = new Date(startedAtMs).toISOString().replace(/[:.]/g, '-')
    const recorder = await createRecorder(join(recordingsPath, `session-${stamp}.ndjson`), {
      startedAtMs,
      note: `Midir ${app.getVersion()}`
    })
    log.info('capture', `Recording this session to ${recorder.path}.`)

    const removed = await pruneRecordings(recordingsPath, settings.recordingCapMb, recorder.path)
    if (removed.length > 0) {
      log.info(
        'recordings',
        `Deleted ${removed.length} old recordings to stay under ${settings.recordingCapMb} MB: ${removed.join(', ')}`
      )
    }
    return recorder
  } catch (error) {
    // A recording is a developer aid. Failing to write one must never stop
    // the capture the user actually asked for.
    log.error('capture', `Could not start a recording: ${messageOf(error)}`)
    return null
  }
}

const captureService = createCaptureService({
  store: characterStore,
  createSource: (device) => {
    if (pcap === null) throw new Error(pcapLoadError ?? 'Packet capture is unavailable.')
    return createPcapSource({ device, api: pcap })
  },
  createRecorder: startRecordingIfWanted,
  onStatus: (status) => pushToRenderer(CAPTURE_STATUS_CHANNEL, status),
  onCharacter: (record) => pushToRenderer(CHARACTER_CHANGED_CHANNEL, record)
})

// The Dark Ages folder the icon service reads. It is kept live here: loaded
// once at startup and updated on every settings save, so a folder chosen in
// Settings takes effect without a restart. The service opens legend.dat lazily,
// on the first icon request, so an unset or wrong path costs nothing until then.
let darkAgesPath: string | undefined
void settingsManager
  .load()
  .then((settings) => {
    darkAgesPath = settings.darkAgesPath
  })
  .catch(() => {
    /* the settings manager already logged; icons simply stay off */
  })

const iconService = createIconService({ getDarkAgesPath: () => darkAgesPath, log })

const ctx: HandlerContext = {
  settingsPath,
  settingsManager,
  appGetVersion: () => app.getVersion(),
  captureAvailability,
  captureService,
  characterStore,
  log,
  logsPath,
  recordingsPath,
  onSettingsSaved: (settings) => {
    darkAgesPath = settings.darkAgesPath
  },
  updateDarkAgesPath: (path) => {
    darkAgesPath = path
  }
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
      log.error('window', `Could not load the renderer: ${messageOf(err)}`)
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

  // Install the item-icon handler now the app is ready. The scheme was declared
  // privileged before this (see registerSchemesAsPrivileged above).
  registerIconProtocol(protocol, iconService, log)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Splash first so the user sees branded feedback instantly, then the (hidden)
  // main window loads behind it. The splash is torn down on `app:ready`.
  splashWindow = createSplashWindow(log)
  createWindow()

  // Safety backstop: if the renderer errors before signalling `app:ready`, force
  // the window visible so the app can never be left permanently invisible.
  setTimeout(revealMainWindow, 15000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindowRevealed = false
      splashWindow = createSplashWindow(log)
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

registerHandlers({ ipcMain, BrowserWindow, shell, dialog }, ctx)
