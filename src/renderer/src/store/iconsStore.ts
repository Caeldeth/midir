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
  /**
   * The colours a legend mark's `color` byte indexes, from the client's own text
   * palette (WP42). Null while it has not been read, or when it cannot be.
   */
  legendPalette: string[] | null
  refresh: () => Promise<void>
}

export const useIconsStore = create<IconsStore>((set) => ({
  enabled: false,
  legendPalette: null,
  refresh: async () => {
    const path = useSettingsStore.getState().darkAgesPath
    if (path === undefined || path === '') {
      set({ enabled: false, legendPalette: null })
      return
    }
    try {
      const { legendFound } = await window.api.icons.probe(path)
      set({ enabled: legendFound })
      // The palette is 256 short strings, read once per folder. A mark's colour
      // is then a lookup in the renderer, so no mark carries a colour over IPC.
      set({ legendPalette: legendFound ? await window.api.icons.legendPalette() : null })
    } catch {
      set({ enabled: false, legendPalette: null })
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
