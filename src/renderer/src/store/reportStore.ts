import { create } from 'zustand'

/**
 * Whether the Report Issue dialog is open. That is the whole of it.
 *
 * **A store rather than local state, and the reason is the count of entry
 * points.** Report an issue has two openers, the bug button in the title bar
 * and the button on the About card in Settings, and lifting the flag to their
 * nearest common ancestor would mean `App` prop-drilling through both. One flag
 * on a store is smaller than that and reads the same from either side.
 *
 * **Deliberately NOT persisted, and not connected to `settingsStore`.** A dialog
 * that is open is not a preference; restoring one at launch would greet a user
 * with a bug report they did not ask for.
 *
 * The dialog the error boundary renders does NOT come from here. It mounts its
 * own instance with its own local flag, because by then the React tree this
 * store lives beside may be the thing that is broken.
 */
interface ReportStore {
  open: boolean
  setOpen: (open: boolean) => void
}

export const useReportStore = create<ReportStore>((set) => ({
  open: false,
  setOpen: (open) => set({ open })
}))
