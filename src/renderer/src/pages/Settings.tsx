import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography
} from '@mui/material'
import ThemePicker from '@renderer/components/ThemePicker'
import { formatNumber } from '@renderer/lib/format'
import { useCaptureStore } from '@renderer/store/captureStore'
import { useIconsStore } from '@renderer/store/iconsStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { MAX_RECORDING_CAP_MB } from '@shared/types'
import React, { useEffect } from 'react'

/**
 * Settings: one card for each concern, as the sibling apps do.
 *
 * The capture card carries the two facts a new user needs — that Npcap must be
 * installed, and that Midir has to be running before they log in.
 */

const cardSx = { p: 3, display: 'flex', flexDirection: 'column', height: '100%' } as const
const headingSx = { color: 'text.button', fontWeight: 'bold' } as const
const descriptionSx = { color: 'text.secondary', mb: 2 } as const

function Settings(): React.JSX.Element {
  const theme = useSettingsStore((s) => s.theme)
  const setTheme = useSettingsStore((s) => s.setTheme)
  const captureDevice = useSettingsStore((s) => s.captureDevice)
  const setCaptureDevice = useSettingsStore((s) => s.setCaptureDevice)
  const autoStartCapture = useSettingsStore((s) => s.autoStartCapture)
  const setAutoStartCapture = useSettingsStore((s) => s.setAutoStartCapture)
  const recordSessions = useSettingsStore((s) => s.recordSessions)
  const setRecordSessions = useSettingsStore((s) => s.setRecordSessions)
  const recordingCapMb = useSettingsStore((s) => s.recordingCapMb)
  const setRecordingCapMb = useSettingsStore((s) => s.setRecordingCapMb)
  const darkAgesPath = useSettingsStore((s) => s.darkAgesPath)
  const setDarkAgesPath = useSettingsStore((s) => s.setDarkAgesPath)
  const iconsEnabled = useIconsStore((s) => s.enabled)
  const refreshIcons = useIconsStore((s) => s.refresh)

  const availability = useCaptureStore((s) => s.availability)
  const status = useCaptureStore((s) => s.status)
  const busy = useCaptureStore((s) => s.busy)
  const error = useCaptureStore((s) => s.error)
  const refresh = useCaptureStore((s) => s.refresh)
  const start = useCaptureStore((s) => s.start)
  const stop = useCaptureStore((s) => s.stop)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const devices = availability?.devices ?? []
  const canCapture = availability?.available === true

  const chooseDarkAgesFolder = async (): Promise<void> => {
    const path = await window.api.icons.chooseFolder()
    if (path === null) return
    setDarkAgesPath(path)
    // Re-probe now, so re-picking the same folder after adding legend.dat still
    // updates the on/off note.
    void refreshIcons()
  }

  const iconStatus = (): string => {
    if (darkAgesPath === undefined || darkAgesPath === '')
      return 'Icons are off. No folder is chosen.'
    if (iconsEnabled) return 'Icons are on.'
    return 'Icons are off. No legend.dat is in this folder.'
  }

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(680px, 1fr))',
          gap: 3,
          alignItems: 'stretch'
        }}
      >
        <Paper sx={cardSx} data-testid="capture-settings">
          <Typography variant="h6" sx={headingSx}>
            Capture
          </Typography>
          <Typography variant="body2" sx={descriptionSx}>
            Midir reads the game client&apos;s own connections through Npcap. It never sends a
            packet and never changes the client. Start Midir before you log in, because it learns
            each session&apos;s keys from the login handshake.
          </Typography>

          {availability !== null && !canCapture ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {availability.reason ?? 'Packet capture is unavailable.'}
            </Alert>
          ) : null}

          {error !== null ? (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          ) : null}

          <TextField
            select
            fullWidth
            size="small"
            label="Network adapter"
            value={devices.some((device) => device.name === captureDevice) ? captureDevice : ''}
            onChange={(event) => setCaptureDevice(event.target.value)}
            disabled={!canCapture || status.running}
            helperText={
              canCapture
                ? 'Choose the adapter your computer uses to reach the internet.'
                : 'No adapters are available.'
            }
            sx={{ mb: 2 }}
          >
            {devices.map((device) => (
              <MenuItem key={device.name} value={device.name}>
                {device.description || device.name}
                {device.addresses.length > 0 ? ` — ${device.addresses[0]}` : ''}
              </MenuItem>
            ))}
          </TextField>

          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', mb: 2 }}>
            {status.running ? (
              <Button variant="outlined" disabled={busy} onClick={() => void stop()}>
                Stop capture
              </Button>
            ) : (
              <Button
                variant="contained"
                disabled={busy || !canCapture || captureDevice === ''}
                onClick={() => void start(captureDevice)}
              >
                Start capture
              </Button>
            )}
            <Button size="small" onClick={() => void refresh()}>
              Refresh adapters
            </Button>
          </Stack>

          <FormControlLabel
            control={
              <Switch
                checked={autoStartCapture}
                onChange={(event) => setAutoStartCapture(event.target.checked)}
              />
            }
            label="Start capturing when Midir opens"
          />

          <FormControlLabel
            control={
              <Switch
                checked={recordSessions}
                onChange={(event) => setRecordSessions(event.target.checked)}
                disabled={status.running}
              />
            }
            label="Record sessions to a file"
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', ml: 6, mt: -0.5 }}>
            A recording lets a session be replayed later, which is how a packet Midir does not
            understand yet gets worked out. It holds everything the client and the server exchanged,
            including your character name and that session&apos;s keys, so treat it as private.
            Recording starts on the next capture. Read and delete recordings in Diagnostics.
          </Typography>

          <TextField
            type="number"
            size="small"
            label="Keep recordings under"
            value={recordingCapMb}
            onChange={(event) => setRecordingCapMb(Math.max(0, Number(event.target.value) || 0))}
            helperText="Megabytes. Midir deletes the oldest recordings when a capture starts. Zero means no limit."
            sx={{ ml: 6, mt: 1.5, maxWidth: 320 }}
            slotProps={{
              htmlInput: { min: 0, max: MAX_RECORDING_CAP_MB, step: 100 },
              input: { endAdornment: <InputAdornment position="end">MB</InputAdornment> }
            }}
          />

          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', mt: 2 }}>
            {status.running
              ? `Following ${formatNumber(status.connections)} connection${
                  status.connections === 1 ? '' : 's'
                } · ${formatNumber(status.decodedCount)} packets decoded · ${formatNumber(
                  status.unreadableCount
                )} not read`
              : 'Capture is stopped.'}
          </Typography>
          {status.recordingPath !== undefined ? (
            <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.5 }}>
              Recording to {status.recordingPath}
            </Typography>
          ) : null}
        </Paper>

        <Paper sx={cardSx}>
          <Typography variant="h6" sx={headingSx}>
            Appearance
          </Typography>
          <Typography variant="body2" sx={descriptionSx}>
            Choose the theme Midir uses.
          </Typography>
          <ThemePicker value={theme} onChange={setTheme} />
        </Paper>

        <Paper sx={cardSx} data-testid="icon-settings">
          <Typography variant="h6" sx={headingSx}>
            Item icons
          </Typography>
          <Typography variant="body2" sx={descriptionSx}>
            Midir can draw each item&apos;s own icon from your Dark Ages files. Point it at your
            Dark Ages folder, the one that holds legend.dat. Midir reads that file only to draw
            icons, and never changes it. This is optional: with no folder set, every list reads
            exactly as it does now.
          </Typography>

          <TextField
            fullWidth
            size="small"
            label="Dark Ages folder"
            value={darkAgesPath ?? ''}
            placeholder="No folder chosen"
            slotProps={{ htmlInput: { readOnly: true, 'aria-label': 'Dark Ages folder' } }}
            sx={{ mb: 2 }}
          />

          <Stack direction="row" sx={{ gap: 1.5, alignItems: 'center', mb: 2 }}>
            <Button variant="contained" onClick={() => void chooseDarkAgesFolder()}>
              Choose folder
            </Button>
            {darkAgesPath !== undefined && darkAgesPath !== '' ? (
              <Button onClick={() => setDarkAgesPath(undefined)}>Clear</Button>
            ) : null}
          </Stack>

          <Box sx={{ flexGrow: 1 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {iconStatus()}
          </Typography>
        </Paper>
      </Box>
    </Box>
  )
}

export default Settings
