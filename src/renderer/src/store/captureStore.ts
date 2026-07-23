import { STOPPED_STATUS, type CaptureAvailability, type CaptureStatus } from '@shared/types'
import { create } from 'zustand'

/**
 * What capture is doing, mirrored from the main process.
 *
 * Main owns the truth. The renderer asks for the current status once, then
 * listens for pushes.
 */

interface CaptureState {
  status: CaptureStatus
  availability: CaptureAvailability | null
  /** True while a start or stop is in flight. */
  busy: boolean
  /** The last failure to report to the user. */
  error: string | null
  refresh: () => Promise<void>
  start: (device: string) => Promise<void>
  stop: () => Promise<void>
  clearError: () => void
  /** Begin mirroring pushes from main. The result stops mirroring. */
  subscribe: () => () => void
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  // An error thrown across IPC arrives with the channel name in front of it.
  // Show the part the user can act on.
  const text = String(error)
  const marker = "Error invoking remote method '"
  const at = text.indexOf(marker)
  return at < 0 ? text : text.split(': ').slice(1).join(': ') || text
}

export const useCaptureStore = create<CaptureState>((set, get) => ({
  status: STOPPED_STATUS,
  availability: null,
  busy: false,
  error: null,

  refresh: async () => {
    const [availability, status] = await Promise.all([
      window.api.capture.availability(),
      window.api.capture.status()
    ])
    set({ availability, status })
  },

  start: async (device) => {
    if (get().busy) return
    set({ busy: true, error: null })
    try {
      set({ status: await window.api.capture.start(device) })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  stop: async () => {
    if (get().busy) return
    set({ busy: true })
    try {
      set({ status: await window.api.capture.stop() })
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ busy: false })
    }
  },

  clearError: () => set({ error: null }),

  subscribe: () => window.api.capture.onStatus((status) => set({ status }))
}))
