import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  session,
  shell
} from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'
import type { CaptureAvailability } from '../shared/types'
import { createPcapSource, loadPcapApi, type PcapApi } from './capture/pcapSource'
import { parseRecording } from './capture/recording'
import { createReplaySource } from './capture/replaySource'
import { createActionLayer, type HotkeyRegistrar, type WindowApi } from './actionLayer'
import { createSpeaker } from './speaker'
import { createWalker } from './walker'
import { createLaborer } from './laborer'
import { createBoardPoll } from './boardPoll'
import { builtinErrands } from './laborer/errands'
import { createPaneWatcher } from './paneWatcher'
import { createMapSource } from './route/mapSource'
import { worldGraph } from './route/graph'
import { seededGates, type Passport } from './route/access'
import { createIconService } from './icons/iconService'
import { registerIconProtocol } from './icons/protocol'
import { createRecorder, type Recorder } from './capture/recorder'
import { createCaptureService } from './captureService'
import {
  ASSIST_STATE_CHANNEL,
  CAPTURE_STATUS_CHANNEL,
  BOARDS_CHANGED_CHANNEL,
  BOARD_POLL_STATE_CHANNEL,
  CHARACTER_CHANGED_CHANNEL,
  LOG_APPENDED_CHANNEL,
  LABORER_STATE_CHANNEL,
  SPEAKER_STATE_CHANNEL,
  SPEAKER_TOGGLE_CHANNEL,
  WALKER_STATE_CHANNEL,
  registerHandlers,
  type HandlerContext
} from './handlers'
import { createLogger, messageOf } from './log'
import { pruneRecordings } from './recordings'
import { createSettingsManager } from './settingsManager'
import { createSplashWindow, type SplashController } from './splash'
import { installGlobalErrorHandlers } from './errorHandlers'
import { formatErrorLine } from '../shared/diagnostics'
import { REMOTE_SESSION_CSS, shouldDisableHardwareAcceleration } from './remoteSession'
import {
  cspForEnvironment,
  guardIpc,
  hardenWindow,
  initWindowSecurity,
  installContentSecurityPolicy,
  registerTrustedWindow
} from './windowSecurity'
import { createCharacterStore } from './store/characterStore'
import { createBoardStore, readPostIds } from './store/boardStore'

// Settings + cache both under %LOCALAPPDATA%/Erisco/Midir (local). On Windows,
// Electron's appData path is the ROAMING dir, so we resolve %LOCALAPPDATA%
// ourselves. macOS/Linux have no roaming concept; appData is local.
const localAppData =
  process.platform === 'win32'
    ? (process.env.LOCALAPPDATA ?? join(app.getPath('home'), 'AppData', 'Local'))
    : app.getPath('appData')
const settingsPath = join(localAppData, 'Erisco', 'Midir')
app.setPath('userData', settingsPath)

// A Remote Desktop session has no GPU, so Chromium rasterises in software while
// still paying for GPU compositing and RDP re-encodes every repaint, and a
// frameless window drags through Chromium's app-region hit testing, which is
// the expensive path under exactly those conditions. HTOO-325;
// `remoteSession.ts` carries the reasoning, the MIDIR_DISABLE_GPU override,
// and what this deliberately does not detect (a reconnected console session).
//
// It sits HERE, beside the `setPath` above, because both must run before the
// `ready` event and this one fails SILENTLY afterwards rather than throwing.
// That ordering is the one thing about this fix no unit test could otherwise
// see, so `bootOrder.test.ts` reads this file and asserts the position. Read
// ONCE and kept, because `createWindow` needs the same answer later.
const isRemoteSession = shouldDisableHardwareAcceleration(process.platform, process.env)
if (isRemoteSession) app.disableHardwareAcceleration()

// Single instance (HTOO-351, WP28). Two copies of Midir write the same
// characters.json, boards.json, settings, and recordings under userData, and
// the crash-safe tmp-then-rename write coordinates one process, not two: the
// second to flush wins and the first's record is gone. So the lock guards the
// store, not only the taskbar, and a second launch surfaces the window we
// already have. The lock is keyed on the userData dir, so it is requested
// after the setPath above, and after the GPU call, which cannot move down.
//
// `app.exit(0)`, not `app.quit()`: `quit()` is async, so a losing instance
// would run every module-scope side effect below (the roaming migration, the
// logger's rotation of the session logs, the stores) against the owner's files
// before the event loop tore it down. `exit()` stops here.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.exit(0)

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

// The renderer entry point, named once so `loadFile` and the trusted-location
// allowlist cannot drift apart. A mismatch here is a lockout, not a weakness:
// every IPC would be rejected and the app would boot to a dead window.
const PROD_INDEX_HTML = join(__dirname, '../renderer/index.html')

// Must run before any window loads AND before registerHandlers below, because
// the guard fails closed: with no trusted locations recorded, every IPC is
// rejected.
initWindowSecurity(process.env['ELECTRON_RENDERER_URL'], PROD_INDEX_HTML)

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
let splashWindow: SplashController | null = null
let mainWindowRevealed = false

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

// Registered before whenReady: the losing instance signals as soon as it fails
// the lock, which can land before this instance has finished booting.
app.on('second-instance', focusMainWindow)

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

// The main process's own error nets, into the same log (the house Report Issue
// module). An uncaught exception or a rejection nobody caught is the line a bug
// report most needs, and without this it went to a console a packaged build
// does not have.
installGlobalErrorHandlers((entry) => log.error(entry.source ?? 'error', formatErrorLine(entry)))

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
// The board archive (WP36): every post and mail seen on the wire.
const boardStore = createBoardStore(settingsPath, (failure) => {
  log.error('boards', `${failure.stage}: ${failure.path} — ${failure.message}`)
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

/**
 * `MIDIR_REPLAY=<path to a .ndjson recording>` replaces the adapter with that
 * recording for the whole launch (WP21). Start capture as usual, on any
 * device name, and the recording plays through the same service the live
 * source feeds, so every view fills without Npcap, an adapter, or a game.
 * It is the e2e suite's source, and a way to look at an old session again.
 * The file is read once here so a missing one fails at launch, in the log,
 * and not at the first start.
 */
const replayPath = process.env['MIDIR_REPLAY']
const replayLines =
  replayPath === undefined ? null : parseRecording(readFileSync(replayPath, 'utf8'))
if (replayPath !== undefined) {
  log.info(
    'capture',
    `Replaying ${replayPath} in place of an adapter (${replayLines?.length} lines).`
  )
}

const captureService = createCaptureService({
  store: characterStore,
  boardStore,
  onBoards: () => pushToRenderer(BOARDS_CHANGED_CHANNEL, undefined),
  createSource: (device) => {
    if (replayLines !== null) return createReplaySource(replayLines)
    if (pcap === null) throw new Error(pcapLoadError ?? 'Packet capture is unavailable.')
    return createPcapSource({ device, api: pcap })
  },
  createRecorder: startRecordingIfWanted,
  onStatus: (status) => pushToRenderer(CAPTURE_STATUS_CHANNEL, status),
  onCharacter: (record) => pushToRenderer(CHARACTER_CHANGED_CHANNEL, record)
})

// The action layer drives a game window and holds the one stop that always
// works. The window helpers do not need Npcap, so they work even when capture
// is unavailable; a missing addon leaves an empty window API rather than a crash.
const windowApi: WindowApi = pcap ?? {
  processIdsByName: () => [],
  tcpConnectionsForPid: () => [],
  windowsForPid: () => [],
  postMessageToWindow: () => false,
  setForegroundWindow: () => false,
  foregroundWindow: () => 0,
  isWindow: () => false,
  pointerIn: () => null,
  clientSize: () => null
}

// globalShortcut is only usable after the app is ready, so registration and
// release happen in whenReady and will-quit; the try/catch guards a combination
// the operating system already holds.
const hotkeys: HotkeyRegistrar = {
  register: (accelerator, callback) => {
    try {
      return globalShortcut.register(accelerator, callback)
    } catch {
      return false
    }
  },
  unregisterAll: () => globalShortcut.unregisterAll()
}

const actionLayer = createActionLayer({
  windows: windowApi,
  hotkeys,
  liveConnections: () => captureService.liveCharacterEntries(),
  log,
  onState: (state) => pushToRenderer(ASSIST_STATE_CHANNEL, state),
  // The renderer owns the selected window, so the toggle hotkey acts through it.
  onSpeakerToggle: () => pushToRenderer(SPEAKER_TOGGLE_CHANNEL, undefined)
})

const speaker = createSpeaker({
  actionLayer,
  liveConnections: () => captureService.liveCharacterEntries(),
  log,
  onState: (state) => pushToRenderer(SPEAKER_STATE_CHANNEL, state)
})

// The Dark Ages folder the icon service reads. It is kept live here: loaded
// once at startup and updated on every settings save, so a folder chosen in
// Settings takes effect without a restart. The service opens legend.dat lazily,
// on the first icon request, so an unset or wrong path costs nothing until then.
let darkAgesPath: string | undefined
/** Walk by right-click, from the settings (WP35). Off until the settings load. */
let walkerRightClick = false
void settingsManager
  .load()
  .then((settings) => {
    darkAgesPath = settings.darkAgesPath
  })
  .catch(() => {
    /* the settings manager already logged; icons simply stay off */
  })

const iconService = createIconService({ getDarkAgesPath: () => darkAgesPath, log })

// The Walker reads the map passability from the same Dark Ages folder the icon
// service uses: the on-disk tile cache and sotp.dat, never memory. The map
// source resolves the folder per request, so a folder chosen in Settings takes
// effect without a restart.
const mapSource = createMapSource({ gameFolder: () => darkAgesPath, log })
// Registration and citizenship as the record knows them, for the walker's
// gates and the Laborer's pre-checks (WP32). Null while no character is
// identified on the connection; unknown fields bar nothing.
const passportFor = (connectionId: string): Passport | null => {
  const record = captureService.recordFor(connectionId)
  return record === null ? null : { registered: record.registered, citizenship: record.citizenship }
}

const walker = createWalker({
  actionLayer,
  liveConnections: () => captureService.liveCharacterEntries(),
  positionFor: (connectionId) => captureService.positionFor(connectionId),
  fieldMapFor: (connectionId) => captureService.fieldMapFor(connectionId),
  // A popup mid-walk is cleared, not counted as a stall (WP34).
  dialogFor: (connectionId) => captureService.dialogFor(connectionId),
  exchangeFor: (connectionId) => captureService.exchangeFor(connectionId),
  // A gate's refusal, and what the character carries to a gate (WP32).
  noticeFor: (connectionId) => captureService.noticeFor(connectionId),
  passportFor,
  gates: seededGates(),
  // What stands on the map, so a right-click never aims at a taken tile (WP35).
  entitiesFor: (connectionId) => captureService.entitiesFor(connectionId),
  doorsFor: (connectionId) => captureService.doorsFor(connectionId),
  mode: () => (walkerRightClick ? 'rightClick' : 'keys'),
  maps: mapSource,
  graph: worldGraph,
  log,
  onState: (state) => pushToRenderer(WALKER_STATE_CHANNEL, state)
})

// The Laborer walks to an NPC through the Walker, then works the dialog off the
// wire (WP17). It reads the dialog on screen from the same capture service the
// position comes from, and drives through the same action layer.
const laborer = createLaborer({
  actionLayer,
  walker,
  liveConnections: () => captureService.liveCharacterEntries(),
  dialogFor: (connectionId) => captureService.dialogFor(connectionId),
  noticeFor: (connectionId) => captureService.noticeFor(connectionId),
  positionFor: (connectionId) => captureService.positionFor(connectionId),
  resolveDestination: (destination) => worldGraph.resolveDestination(destination),
  passportFor,
  log,
  onState: (state) => pushToRenderer(LABORER_STATE_CHANNEL, state)
})

// The board poll reads every board and the mailbox through the client's own
// board pane (WP36 PR2): the arrow keys walk the list, View opens a row, and
// every reply off the wire is the check on where the selection is.
const boardPoll = createBoardPoll({
  actionLayer,
  liveConnections: () => captureService.liveCharacterEntries(),
  boardFor: (connectionId) => captureService.boardFor(connectionId),
  dialogFor: (connectionId) => captureService.dialogFor(connectionId),
  readBodies: async (key) => {
    await captureService.flush()
    return readPostIds((await boardStore.load()).boards[key])
  },
  log,
  onState: (state) => pushToRenderer(BOARD_POLL_STATE_CHANNEL, state)
})

// While a world map is open, the pane watcher logs where the user clicks by
// hand and pairs it with the point the client sends (WP33). A diagnostic: it
// reads the pointer through the operating system and drives nothing.
const paneWatcher = createPaneWatcher({
  pointerIn: (handle) => windowApi.pointerIn(handle),
  resolveTarget: (connectionId) => actionLayer.resolveTarget(connectionId),
  liveConnections: () => captureService.liveCharacterEntries(),
  fieldMapFor: (connectionId) => captureService.fieldMapFor(connectionId),
  dialogFor: (connectionId) => captureService.dialogFor(connectionId),
  answerFor: (connectionId) => captureService.answerFor(connectionId),
  positionFor: (connectionId) => captureService.positionFor(connectionId),
  exchangeFor: (connectionId) => captureService.exchangeFor(connectionId),
  // A hand click on a board pane, paired with the client's request (WP36).
  boardFor: (connectionId) => captureService.boardFor(connectionId),
  // The NPC tiles the errands know, so a hand click on one measures the view.
  knownNpcs: () =>
    builtinErrands().flatMap((e) => {
      const mapId = worldGraph.resolveDestination(e.destination)
      return e.npcTile !== undefined && mapId !== null
        ? [{ npcName: e.npcName, mapId, tile: e.npcTile }]
        : []
    }),
  log
})

const ctx: HandlerContext = {
  settingsPath,
  settingsManager,
  appGetVersion: () => app.getVersion(),
  captureAvailability,
  captureService,
  characterStore,
  boardStore,
  boardPoll,
  actionLayer,
  speaker,
  walker,
  laborer,
  log,
  logsPath,
  // The report's two side effects, injected so the handler module stays free of
  // electron at test time.
  diagnosticsIo: {
    writeClipboard: (text) => clipboard.writeText(text),
    openExternal: (url) => void shell.openExternal(url)
  },
  recordingsPath,
  onSettingsSaved: (settings) => {
    darkAgesPath = settings.darkAgesPath
    walkerRightClick = settings.walkerRightClick
    // Keep the running action layer in step with the settings: a new hotkey is
    // re-registered at once, so the user does not need a restart.
    actionLayer.updateSettings({
      stopHotkey: settings.assistStopHotkey,
      speakerToggleHotkey: settings.speakerToggleHotkey,
      stopOnFocusLoss: settings.assistStopOnFocusLoss
    })
  },
  updateDarkAgesPath: (path) => {
    darkAgesPath = path
  }
}

function revealMainWindow(): void {
  if (mainWindowRevealed) return
  mainWindowRevealed = true
  const splash = splashWindow
  splashWindow = null
  // The splash owns the timing: it holds itself on screen for its minimum
  // visible window, then tears down and calls back. Revealing from the callback
  // keeps the always-on-top splash from hovering over a live main window, and
  // a packaged boot fast enough to beat the splash's first paint still shows it.
  if (splash) splash.dismiss(focusMainWindow)
  else focusMainWindow()
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
    // A 256px PNG32, not the icon master: electron-builder generates the
    // platform icons from the master at build/icon.png, and nativeImage decodes
    // this one once. Regenerate with:
    //   magick build/icon.png -resize 256x256 -strip \
    //     -define png:compression-level=9 PNG32:resources/midir-icon-256.png
    icon: join(__dirname, '../../resources/midir-icon-256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Stated rather than inherited: these two are the load-bearing
      // preferences, and an auditor should not need Electron's default table.
      contextIsolation: true,
      nodeIntegration: false,
      // The preload imports `electron` and nothing else at run time (the shared
      // types are erased), which is what a sandboxed preload's loader can
      // resolve. HTOO-54.
      sandbox: true
    }
  })
  mainWindow = win

  // The other half of the remote-session mitigation (HTOO-327). Four of the
  // six themes put `backdropFilter: blur(2px)` on `MuiPaper.root`, a readback
  // and convolve on every repaint that is nearly free with a GPU and is the
  // most expensive thing left once it is gone. `dom-ready` fires before first
  // paint, so there is no flash of the blurred style; a failure is logged, not
  // thrown, because a window with one expensive effect still beats no window.
  if (isRemoteSession) {
    win.webContents.on('dom-ready', () => {
      win.webContents.insertCSS(REMOTE_SESSION_CSS).catch((err) => {
        log.warn('display', `The remote-session CSS was not applied: ${messageOf(err)}`)
      })
    })
  }

  // A window keeps its native background, Electron's default white, while the
  // renderer's compositor tears down, and that is what paints for the last
  // frame or two on the way out: the white flash on quit (HTOO-456). Hiding the
  // window takes it off screen first. `close` runs before the teardown, and the
  // close proceeds after this returns; Midir has no close guard, so one hide
  // covers every close path. The capture flush in `before-quit` is not a
  // guard on this window, and it never asks the renderer anything.
  win.on('close', () => {
    win.hide()
  })

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
    // The splash is alwaysOnTop + skipTaskbar. If the window it was narrating
    // dies before the reveal, tear it down rather than stranding a floating
    // panel the user cannot focus, close, or find in the taskbar.
    splashWindow?.destroy()
    splashWindow = null
  })

  // Deny top-level navigation and every child window; hand only allowlisted
  // external URLs to the OS. Replaces a bare `openExternal(details.url)`, which
  // forwarded any scheme the renderer asked for (WP28, R-006).
  hardenWindow(win, { allowExternal: true, openExternal: shell.openExternal })
  // Only a registered window's IPC is accepted; see guardIpc below.
  registerTrustedWindow(win)

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(PROD_INDEX_HTML).catch((err) => {
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

  // HTOO-467. The CSP on the RESPONSE, not only in the document's own <meta>
  // tag: a meta policy applies once the parser reaches it, a header applies to
  // the response itself. The policy string is the tag's, and the tag stays as
  // defence in depth. It sits here because `session.defaultSession` does not
  // exist before `ready`, and before the two windows below, because a listener
  // registered after a document has loaded stamps nothing it needed to.
  installContentSecurityPolicy(session.defaultSession, cspForEnvironment(process.env.NODE_ENV))

  // Install the item-icon handler now the app is ready. The scheme was declared
  // privileged before this (see registerSchemesAsPrivileged above).
  registerIconProtocol(protocol, iconService, log)

  // Register the global stop hotkey now the app is ready. The hotkey comes from
  // the settings; a load failure still registers the default, so the stop is
  // never left unbound.
  settingsManager
    .load()
    .then((settings) => {
      walkerRightClick = settings.walkerRightClick
      actionLayer.updateSettings({
        stopHotkey: settings.assistStopHotkey,
        speakerToggleHotkey: settings.speakerToggleHotkey,
        stopOnFocusLoss: settings.assistStopOnFocusLoss
      })
      actionLayer.register()
      paneWatcher.start()
    })
    .catch(() => {
      actionLayer.register()
      paneWatcher.start()
    })

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

// Stop every driver and release the global hotkey as the app ends. This runs
// even when before-quit defers the quit for a capture flush.
app.on('will-quit', () => {
  paneWatcher.stop()
  laborer.dispose()
  boardPoll.dispose()
  walker.dispose()
  speaker.dispose()
  actionLayer.dispose()
})

// Stop the capture and write anything still pending before the process ends.
// A character seen this session must survive the app closing.
app.on('before-quit', (event) => {
  if (!captureService.status().running) return
  event.preventDefault()
  void captureService.stop().finally(() => app.quit())
})

// guardIpc, not bare ipcMain: every channel registered here, and every channel
// added later, rejects an IPC whose sender is not the top frame of a trusted
// window, by construction rather than by remembering to opt in.
registerHandlers({ ipcMain: guardIpc(ipcMain), BrowserWindow, shell, dialog }, ctx)
