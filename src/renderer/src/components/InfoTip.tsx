import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined'
import { Box, Tooltip } from '@mui/material'
import React from 'react'

/**
 * A small "(i)" help icon with a hover tooltip.
 *
 * The icon carries the help text that a control does not need to show inline.
 * The anchor takes focus, so the tooltip is reachable from the keyboard.
 */
function InfoTip({ title, label }: { title: string; label: string }): React.JSX.Element {
  return (
    <Tooltip title={title} arrow enterDelay={150}>
      <Box
        component="span"
        tabIndex={0}
        aria-label={label}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          color: 'text.secondary',
          cursor: 'default',
          '&:focus-visible': { outline: 'none', color: 'text.primary' }
        }}
      >
        <InfoOutlinedIcon fontSize="small" />
      </Box>
    </Tooltip>
  )
}

export default InfoTip
