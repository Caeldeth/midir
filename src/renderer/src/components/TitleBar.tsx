import React from 'react'
import { Toolbar, IconButton, Tooltip, Box, Typography } from '@mui/material'
import { GiContract, GiExpand, GiDeathSkull } from 'react-icons/gi'
import RemoveIcon from '@mui/icons-material/Remove'
import CropSquareIcon from '@mui/icons-material/CropSquare'
import CloseIcon from '@mui/icons-material/Close'
import { PLAIN_CHROME_THEMES } from '@shared/types'
import CaptureIndicator from '@renderer/components/CaptureIndicator'
import { useSettingsStore } from '@renderer/store/settingsStore'

// Shared shadow vocabulary for the title bar. KEYLINE is the crisp four-way
// #000 outline; DEPTH is the soft layer that lifts the glyph off the bar.
// These drive the "gamified" chrome; the plain/corporate themes drop them.
const KEYLINE = ['1px 1px 0 #000', '-1px -1px 0 #000', '1px -1px 0 #000', '-1px 1px 0 #000']
const DEPTH = '0 2px 3px rgba(0,0,0,0.55)'

// The wordmark is real text: CSS text-shadow paints every layer independently
// from the glyph, so keyline + depth both read at full strength.
const TITLE_TEXT_SHADOW = [...KEYLINE, DEPTH].join(', ')

// Gamified chrome (the four stylized themes): stroked glyphs, keyline/depth.
const iconSx = {
  '& svg': {
    fontSize: '1.4em',
    // SVG glyphs can't take text-shadow, so the keyline comes from a solid
    // (full-opacity) stroke and the depth from a SINGLE drop-shadow. Earlier
    // this chained the four keyline offsets as drop-shadows too, but chained
    // filters compound — the depth layer ended up cast from the icon *plus*
    // its four hard shadows and washed out, which is why the icons read
    // flatter than the wordmark. One depth shadow off the crisp stroked glyph
    // matches the wordmark's lift.
    stroke: '#000',
    strokeWidth: 11,
    filter: `drop-shadow(${DEPTH})`
  }
}

const gameBtnSx = {
  WebkitAppRegion: 'no-drag',
  color: 'secondary.contrastText',
  ...iconSx,
  '&:hover': {
    backgroundColor: 'info.main',
    color: 'text.dark'
  }
} as const

// Plain chrome (corporate themes): standard MUI icons, flat, no stroke/shadow.
// The bar is the navy secondary.main, so hover uses a translucent-white wash
// (a dark action.hover overlay would be invisible on navy).
const plainBtnSx = {
  WebkitAppRegion: 'no-drag',
  color: 'secondary.contrastText',
  '& svg': { fontSize: '1.15em' },
  '&:hover': { backgroundColor: 'rgba(255,255,255,0.16)' }
} as const

function TitleBar(): React.JSX.Element {
  // Corporate themes get plain MUI window icons and a flat bar; the four
  // stylized themes keep the gamified skull glyph + #000 keyline shadows.
  const themeName = useSettingsStore((s) => s.theme)
  const plain = PLAIN_CHROME_THEMES.includes(themeName)

  const winBtnSx = plain ? plainBtnSx : gameBtnSx
  const closeBtnSx = {
    ...winBtnSx,
    '&:hover': plain
      ? { backgroundColor: 'error.main', color: 'error.contrastText' }
      : { backgroundColor: 'info.main', color: 'warning.main' }
  }

  return (
    <Toolbar
      data-testid="title-bar"
      variant="dense"
      sx={{
        bgcolor: 'secondary.main',
        minHeight: 36,
        px: 1.5,
        WebkitAppRegion: 'drag',
        userSelect: 'none',
        flexShrink: 0
      }}
    >
      <Typography
        variant="h6"
        sx={{
          fontWeight: 'bold',
          flexGrow: 0,
          // responsiveFontSizes() attaches sm/md/lg font-size media queries to
          // the h6 variant, so the title would grow when the window crosses a
          // breakpoint on resize. The doubled-class `&&` outranks those media
          // queries to pin the size at every width. (variant="h6" kept for its
          // Cinzel font.)
          '&&': { fontSize: '1.5rem' },
          color: 'secondary.contrastText',
          textShadow: plain ? 'none' : TITLE_TEXT_SHADOW
        }}
      >
        Midir
      </Typography>

      <Box sx={{ flexGrow: 1 }} />

      <CaptureIndicator />

      <Tooltip title="Minimize">
        <IconButton
          size="small"
          aria-label="Minimize"
          sx={winBtnSx}
          onClick={() => window.api.minimizeWindow()}
        >
          {plain ? <RemoveIcon /> : <GiContract />}
        </IconButton>
      </Tooltip>
      <Tooltip title="Maximize">
        <IconButton
          size="small"
          aria-label="Maximize"
          sx={winBtnSx}
          onClick={() => window.api.maximizeWindow()}
        >
          {plain ? <CropSquareIcon /> : <GiExpand />}
        </IconButton>
      </Tooltip>
      <Tooltip title="Close">
        <IconButton
          size="small"
          aria-label="Close"
          sx={closeBtnSx}
          onClick={() => window.api.closeWindow()}
        >
          {plain ? <CloseIcon /> : <GiDeathSkull />}
        </IconButton>
      </Tooltip>
    </Toolbar>
  )
}

export default TitleBar
