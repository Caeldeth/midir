import type { LogEntry, LogFileInfo, RecordingInfo } from '@shared/types'
import { create } from 'zustand'

/**
 * The files Midir writes for diagnosis.
 *
 * Unlike the item index, none of this is derived from something the renderer
 * already holds. Main owns the disk, so every value here arrives over IPC.
 *
 * The current launch's log is live: main pushes each entry as it is written,
 * and the store appends it while that file is the one on screen. An older file
 * is a fixed thing and never changes under the reader.
 */

interface DiagnosticsState {
  logFiles: LogFileInfo[]
  /** The file being read. Null before the first load. */
  selectedLog: string | null
  entries: LogEntry[]
  recordings: RecordingInfo[]
  loading: boolean
  /** The last problem worth showing the user. */
  error: string | null

  /** Load the file lists and read whichever log is selected. */
  refresh: () => Promise<void>
  selectLog: (name: string) => Promise<void>
  removeRecording: (name: string) => Promise<void>
  removeAllRecordings: () => Promise<void>
  openLogsFolder: () => Promise<void>
  openRecordingsFolder: () => Promise<void>
  /** Begin mirroring the log as main writes it. The result stops mirroring. */
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** How many entries the view holds. It matches what main returns for a file. */
const MAX_ENTRIES = 2000

export const useDiagnosticsStore = create<DiagnosticsState>((set, get) => ({
  logFiles: [],
  selectedLog: null,
  entries: [],
  recordings: [],
  loading: false,
  error: null,

  refresh: async () => {
    set({ loading: true, error: null })
    try {
      const [logFiles, recordings] = await Promise.all([
        window.api.diagnostics.listLogs(),
        window.api.diagnostics.listRecordings()
      ])
      // Keep the file the user chose. Fall back to this launch's own file,
      // which is the one they want the first time they open the view.
      const wanted =
        get().selectedLog !== null && logFiles.some((file) => file.name === get().selectedLog)
          ? (get().selectedLog as string)
          : (logFiles.find((file) => file.current)?.name ?? logFiles[0]?.name ?? null)

      const entries = wanted === null ? [] : await window.api.diagnostics.readLog(wanted)
      set({ logFiles, recordings, selectedLog: wanted, entries })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ loading: false })
    }
  },

  selectLog: async (name) => {
    set({ selectedLog: name, error: null })
    try {
      set({ entries: await window.api.diagnostics.readLog(name) })
    } catch (error) {
      set({ entries: [], error: messageOf(error) })
    }
  },

  removeRecording: async (name) => {
    set({ error: null })
    try {
      await window.api.diagnostics.deleteRecording(name)
      set({ recordings: get().recordings.filter((recording) => recording.name !== name) })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  removeAllRecordings: async () => {
    set({ error: null })
    try {
      await window.api.diagnostics.deleteAllRecordings()
      // The one being written survives, so read the folder again rather than
      // assuming the list is now empty.
      set({ recordings: await window.api.diagnostics.listRecordings() })
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  openLogsFolder: async () => {
    await window.api.diagnostics.openLogsFolder()
  },

  openRecordingsFolder: async () => {
    await window.api.diagnostics.openRecordingsFolder()
  },

  subscribe: () =>
    window.api.diagnostics.onLogEntry((entry) => {
      // An entry belongs to this launch. Appending it to an older file the
      // user is reading would put a line in a file that does not hold it.
      const current = get().logFiles.find((file) => file.current)
      if (current !== undefined && get().selectedLog !== current.name) return
      set({ entries: [...get().entries, entry].slice(-MAX_ENTRIES) })
    })
}))

/** Keep the entries the user asked to see. */
export function filterEntries(
  entries: readonly LogEntry[],
  levels: readonly LogEntry['level'][],
  query: string
): LogEntry[] {
  const needle = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (!levels.includes(entry.level)) return false
    if (needle === '') return true
    return (
      entry.message.toLowerCase().includes(needle) || entry.scope.toLowerCase().includes(needle)
    )
  })
}
