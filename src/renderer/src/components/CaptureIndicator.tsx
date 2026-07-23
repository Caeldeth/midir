import { Box, Tooltip, Typography } from '@mui/material'
import { useCaptureStore } from '@renderer/store/captureStore'
import React from 'react'

/**
 * What capture is doing, shown in the title bar.
 *
 * Three states, and a warning that outranks all of them. The warning is the
 * only failure the user can fix, so it must be the loudest thing on the bar.
 */

const DOT_SIZE = 9

interface Appearance {
  color: string
  label: string
  tooltip: string
}

function appearanceFor(
  state: 'stopped' | 'listening' | 'decoding',
  characterName: string | undefined,
  missedHandshake: boolean
): Appearance {
  if (missedHandshake) {
    return {
      color: 'warning.main',
      label: 'Start Midir first',
      tooltip:
        'Midir joined this session after the login handshake, so it cannot read it. ' +
        'Log out, then log back in with Midir already running.'
    }
  }
  switch (state) {
    case 'decoding':
      return {
        color: 'success.main',
        label: characterName ?? 'Decoding',
        tooltip: `Reading packets for ${characterName ?? 'a character'}.`
      }
    case 'listening':
      return {
        color: 'info.main',
        label: 'Listening',
        tooltip: 'Capture is running. Start Dark Ages and log in.'
      }
    default:
      return {
        color: 'text.disabled',
        label: 'Not capturing',
        tooltip: 'Capture is stopped. Turn it on from Settings.'
      }
  }
}

function CaptureIndicator(): React.JSX.Element {
  const status = useCaptureStore((s) => s.status)
  const { color, label, tooltip } = appearanceFor(
    status.state,
    status.characterName,
    status.missedHandshake
  )

  return (
    <Tooltip title={tooltip}>
      <Box
        data-testid="capture-indicator"
        data-state={status.missedHandshake ? 'warning' : status.state}
        sx={{
          WebkitAppRegion: 'no-drag',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          cursor: 'default'
        }}
      >
        <Box
          sx={{
            width: DOT_SIZE,
            height: DOT_SIZE,
            borderRadius: '50%',
            bgcolor: color,
            flexShrink: 0
          }}
        />
        <Typography variant="caption" sx={{ color: 'secondary.contrastText', fontWeight: 'bold' }}>
          {label}
        </Typography>
      </Box>
    </Tooltip>
  )
}

export default CaptureIndicator
