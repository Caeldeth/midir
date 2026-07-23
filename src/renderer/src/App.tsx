import React, { useEffect, useState } from 'react'
import { ThemeProvider, CssBaseline, Box, CircularProgress } from '@mui/material'
import type { Theme } from '@mui/material/styles'

import {
  hybrasylTheme,
  chadulTheme,
  danaanTheme,
  grinnealTheme,
  mundanesTheme,
  dubhaimidTheme
} from '@renderer/themes'
import type { ThemeName } from '@shared/types'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { useCaptureStore } from '@renderer/store/captureStore'
import { useCharacterStore } from '@renderer/store/characterStore'
import TitleBar from '@renderer/components/TitleBar'
import NavBar, { type ViewName } from '@renderer/components/NavBar'
import Live from '@renderer/pages/Live'
import Characters from '@renderer/pages/Characters'
import Settings from '@renderer/pages/Settings'

const themes: Record<ThemeName, Theme> = {
  hybrasyl: hybrasylTheme,
  chadul: chadulTheme,
  danaan: danaanTheme,
  grinneal: grinnealTheme,
  mundanes: mundanesTheme,
  dubhaimid: dubhaimidTheme
}

function App(): React.JSX.Element {
  const themeName = useSettingsStore((s) => s.theme)
  const theme = themes[themeName] ?? hybrasylTheme
  const hydrateSettings = useSettingsStore((s) => s.hydrate)
  const [view, setView] = useState<ViewName>('live')

  // Block first paint of the actual UI until settings.json has been read.
  // Otherwise we'd flash the default theme/UI for ~10-50ms before
  // re-rendering with the persisted theme. Once hydrated, signal main so it
  // reveals the window and tears down the startup splash.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      await hydrateSettings()
      if (cancelled) return
      setHydrated(true)
      window.api.appReady()
    })()
    return () => {
      cancelled = true
    }
  }, [hydrateSettings])

  // Mirror the pushes from main for as long as the app is open.
  useEffect(() => {
    const stopStatus = useCaptureStore.getState().subscribe()
    const stopCharacters = useCharacterStore.getState().subscribe()
    return () => {
      stopStatus()
      stopCharacters()
    }
  }, [])

  // Read the current state once the settings are in, then start capture if the
  // user asked for that. Starting before hydration would use an empty adapter.
  useEffect(() => {
    if (!hydrated) return
    void (async () => {
      await useCaptureStore.getState().refresh()
      await useCharacterStore.getState().refresh()
      const { captureDevice, autoStartCapture } = useSettingsStore.getState()
      if (autoStartCapture && captureDevice !== '' && !useCaptureStore.getState().status.running) {
        await useCaptureStore.getState().start(captureDevice)
      }
    })()
  }, [hydrated])

  // Push scrollbar colors onto :root as CSS variables so the chrome
  // tracks the active theme. assets/main.css consumes these.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--scrollbar-thumb', theme.palette.background.scrollbarDark)
    root.style.setProperty('--scrollbar-thumb-hover', theme.palette.background.scrollbarLight)
    root.style.setProperty('--scrollbar-track', theme.palette.background.paperDark)
  }, [theme])

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box
        data-testid="app-root"
        data-theme={themeName}
        sx={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          bgcolor: 'background.default'
        }}
      >
        <TitleBar />
        {hydrated ? (
          <>
            <NavBar value={view} onChange={setView} />
            <Box sx={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
              {view === 'live' ? <Live onOpenSettings={() => setView('settings')} /> : null}
              {view === 'characters' ? <Characters /> : null}
              {view === 'settings' ? <Settings /> : null}
            </Box>
          </>
        ) : (
          <Box
            data-testid="app-hydrating"
            sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            <CircularProgress />
          </Box>
        )}
      </Box>
    </ThemeProvider>
  )
}

export default App
