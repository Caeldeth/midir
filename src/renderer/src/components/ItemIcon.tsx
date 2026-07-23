import { Box } from '@mui/material'
import { useIconsStore } from '@renderer/store/iconsStore'
import React, { useEffect, useState } from 'react'

/**
 * The game's own icon for one item.
 *
 * The pixels come over the `midir-icon://` protocol, keyed by the raw sprite id
 * and the dye colour, so the browser caches each icon and the list is not
 * re-rendered as they arrive. The raw sprite id is sent as-is: the `0x8000`
 * display flag is stripped in main and nowhere else.
 *
 * The component renders nothing — no gap, no broken image — when icons are off,
 * the sprite has no icon, or the fetch fails. The image is kept out of the
 * layout until it has loaded, so a 404 or a decode error never flashes the
 * browser's broken-image glyph and never reserves a gap. So a view with no
 * icons looks exactly as it does with no game installed.
 */
function ItemIcon({
  sprite,
  color = 0,
  size = 20
}: {
  sprite: number
  color?: number
  size?: number
}): React.JSX.Element | null {
  const enabled = useIconsStore((s) => s.enabled)
  // Sprite and colour go in the path, behind a fixed host. A numeric host is
  // read as an IPv4 address by the standard scheme and rewritten.
  const src = `midir-icon://item/${sprite}/${color}`
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')

  // A reused component that gets a new sprite must try again for it.
  useEffect(() => {
    setStatus('loading')
  }, [src])

  if (!enabled || sprite === 0 || status === 'failed') return null

  return (
    <Box
      component="img"
      src={src}
      alt=""
      width={size}
      height={size}
      onLoad={() => setStatus('ready')}
      onError={() => setStatus('failed')}
      sx={{
        flexShrink: 0,
        objectFit: 'contain',
        // Item art is small and pixel-precise; let it stay crisp when scaled.
        imageRendering: 'pixelated',
        // Out of the layout until the pixels are in. A failed load shows no
        // broken-image glyph and reserves no space.
        display: status === 'ready' ? 'inline-block' : 'none'
      }}
    />
  )
}

export default ItemIcon
