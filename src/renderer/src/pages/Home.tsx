import React from 'react'
import { Box, Paper, Typography } from '@mui/material'
import { useSettingsStore } from '@renderer/store/settingsStore'
import ThemePicker from '@renderer/components/ThemePicker'

/**
 * Placeholder landing page — replace once the app's purpose is decided.
 * The theme picker doubles as an end-to-end check of the settings round-trip
 * (store → debounced IPC save → settings.json → hydrate).
 *
 * SETTINGS, when this app grows them: the house pattern (see creidhne /
 * taliesin SettingsPage) is a scrollable page holding a responsive grid of
 * MUI `<Paper>` cards — one card per concern (Appearance, paths, libraries,
 * About, …), NOT a tab strip. The shared card vocabulary is:
 *
 *   const cardSx = { p: 3, display: 'flex', flexDirection: 'column', height: '100%' }
 *   const cardHeadingSx = { color: 'text.button', fontWeight: 'bold' }
 *   const cardDescSx = { color: 'text.secondary', mb: 2 }
 *
 * laid out in a
 *   `display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(680px, 1fr))'`
 * grid with `gap: 3` and `alignItems: 'stretch'` (equal-height cards per row).
 * The Appearance card is just a heading + description + `<ThemePicker>`.
 */
function Home(): React.JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)

  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: 4,
        overflow: 'auto'
      }}
    >
      <Paper sx={{ p: 4, maxWidth: 560, textAlign: 'center' }}>
        <Typography variant="h4" gutterBottom>
          Midir
        </Typography>
        <Typography variant="body1" sx={{ mb: 3, color: 'text.secondary' }}>
          Scaffolded from the shared Electron skeleton. Purpose to be decided — this page is a
          placeholder.
        </Typography>
        <ThemePicker value={theme} onChange={setTheme} />
      </Paper>
    </Box>
  )
}

export default Home
