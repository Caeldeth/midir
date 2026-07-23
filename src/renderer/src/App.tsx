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
import TitleBar from '@renderer/components/TitleBar'
import Home from '@renderer/pages/Home'

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
          <Home />
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
