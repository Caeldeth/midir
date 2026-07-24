import { Box, Tooltip, Typography } from '@mui/material'
import { formatAgo, formatNumber } from '@renderer/lib/format'
import type { GoldContribution } from '@shared/types'
import React from 'react'

/**
 * The gold total, broken down by character.
 *
 * The header shows the total. The tooltip lists each character and the gold it
 * holds, most first, with the age of each reading. A gold count is a snapshot,
 * so the age is part of the answer.
 *
 * The panel takes its surface and border from the active theme, the way
 * `ItemTooltip` does, so it belongs to all six themes.
 */
function GoldTooltip({
  contributions,
  children
}: {
  contributions: readonly GoldContribution[]
  children: React.ReactElement
}): React.JSX.Element {
  return (
    <Tooltip
      arrow
      enterDelay={150}
      slotProps={{
        tooltip: {
          sx: (theme) => ({
            backgroundColor: theme.palette.background.paperDark,
            color: theme.palette.text.primary,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: theme.shape.borderRadius,
            boxShadow: theme.shadows[6],
            maxWidth: 320,
            p: 1.25
          })
        },
        arrow: {
          sx: (theme) => ({ color: theme.palette.background.paperDark })
        }
      }}
      title={
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          <Typography
            variant="subtitle2"
            sx={(theme) => ({ color: theme.palette.text.headline, fontWeight: 'bold', mb: 0.5 })}
          >
            Gold by character
          </Typography>
          {contributions.length === 0 ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              No gold read yet.
            </Typography>
          ) : (
            contributions.map((entry) => (
              <Box
                key={entry.name}
                sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
              >
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {entry.name}
                </Typography>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography
                    variant="caption"
                    sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
                  >
                    {formatNumber(entry.gold)}
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.disabled', display: 'block', whiteSpace: 'nowrap' }}
                  >
                    {formatAgo(entry.lastSeenMs)}
                  </Typography>
                </Box>
              </Box>
            ))
          )}
        </Box>
      }
    >
      {children}
    </Tooltip>
  )
}

export default GoldTooltip
