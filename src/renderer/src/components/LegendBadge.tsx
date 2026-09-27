import { Box } from '@mui/material'
import { useIconsStore } from '@renderer/store/iconsStore'
import { legendIconName } from '@renderer/lib/format'
import { LEGEND_ICON_FRAMES } from '@shared/labels'
import React, { useEffect, useState } from 'react'
import type { IconType } from 'react-icons'
import {
  GiBroadsword,
  GiCrossShield,
  GiFist,
  GiHearts,
  GiIronCross,
  GiOrbWand,
  GiShuriken,
  GiStrong
} from 'react-icons/gi'

/**
 * The badge for one legend mark (WP42).
 *
 * **First choice is the game's own art.** The pixels come over the
 * `midir-icon://` protocol, keyed by the mark's icon byte, which is the frame
 * index in the client's own sheet. Nothing crosses the IPC path and the browser
 * caches each badge.
 *
 * **Second choice is a drawn stand-in**, for a player with no Dark Ages folder,
 * with the legacy data files switched off, or whose client will not open. The
 * eight shapes are Sabrael's picks from the Game Icons set (2026-09-27); they
 * take the text colour, so they belong to whichever theme is on, and they are
 * plainly Midir's own mark rather than a poor copy of the game's.
 *
 * Either way the mark's name is the hover text, and icon 8 ("None") draws
 * nothing at all.
 */

/** The stand-in for each icon byte. Icon 8 has none, and needs none. */
const STAND_IN: Readonly<Record<number, IconType>> = {
  0: GiStrong,
  1: GiBroadsword,
  2: GiShuriken,
  3: GiOrbWand,
  4: GiIronCross,
  5: GiFist,
  6: GiHearts,
  7: GiCrossShield
}

function LegendBadge({
  icon,
  size = 20
}: {
  icon: number
  size?: number
}): React.JSX.Element | null {
  const enabled = useIconsStore((s) => s.enabled)
  const src = `midir-icon://legend/${icon}`
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  // A reused component that gets a new mark must try again for it.
  useEffect(() => {
    setStatus('loading')
  }, [src])

  const drawable = Number.isInteger(icon) && icon >= 0 && icon < LEGEND_ICON_FRAMES
  if (!drawable) return null
  const name = legendIconName(icon)

  // No client art to ask for, or the ask failed: the stand-in carries the mark.
  if (!enabled || status === 'failed') {
    const StandIn = STAND_IN[icon]
    if (StandIn === undefined) return null
    return (
      <Box
        title={name}
        aria-label={name}
        role="img"
        data-testid="legend-stand-in"
        sx={{
          flexShrink: 0,
          display: 'inline-flex',
          color: 'text.secondary',
          width: size,
          height: size
        }}
      >
        <StandIn size={size} />
      </Box>
    )
  }

  return (
    <Box
      component="img"
      src={src}
      alt={name}
      title={name}
      width={size}
      height={size}
      onLoad={() => setStatus('ready')}
      onError={() => setStatus('failed')}
      data-testid="legend-badge"
      sx={{
        flexShrink: 0,
        objectFit: 'contain',
        // The badge is 21 x 20 pixel art; keep it crisp when it scales.
        imageRendering: 'pixelated',
        // Out of the layout until the pixels are in, so the load never flashes
        // a broken-image glyph and never reserves a gap.
        display: status === 'ready' ? 'inline-block' : 'none'
      }}
    />
  )
}

export default LegendBadge
