import { create } from 'zustand'
import { useSettingsStore } from './settingsStore'

/**
 * Whether item icons are on.
 *
 * Icons are on only when the Dark Ages folder is set and holds a `legend.dat`.
 * The renderer asks main once, and again whenever the folder changes, so an
 * `<img>` is drawn only when there are pixels behind it. With icons off, every
 * view renders exactly as it does with no game installed.
 */
interface IconsStore {
  enabled: boolean
  refresh: () => Promise<void>
}

export const useIconsStore = create<IconsStore>((set) => ({
  enabled: false,
  refresh: async () => {
    const path = useSettingsStore.getState().darkAgesPath
    if (path === undefined || path === '') {
      set({ enabled: false })
      return
    }
    try {
      const { legendFound } = await window.api.icons.probe(path)
      set({ enabled: legendFound })
    } catch {
      set({ enabled: false })
    }
  }
}))

// Probe once now (the store may load after settings have hydrated), and again
// whenever the folder changes.
let lastPath: string | undefined = useSettingsStore.getState().darkAgesPath
void useIconsStore.getState().refresh()
useSettingsStore.subscribe((state) => {
  if (state.darkAgesPath !== lastPath) {
    lastPath = state.darkAgesPath
    void useIconsStore.getState().refresh()
  }
})
