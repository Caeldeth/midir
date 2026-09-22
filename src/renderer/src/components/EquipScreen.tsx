import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined'
import { Box, Tooltip, Typography } from '@mui/material'
import ItemIcon from '@renderer/components/ItemIcon'
import { equipmentSlotName, formatDurability } from '@renderer/lib/format'
import type { CharacterRecord, ItemRef } from '@shared/types'
import { dollUrl } from '@shared/doll'
import React, { useEffect, useState } from 'react'

/**
 * The equipment, in the client's Equip-screen layout.
 *
 * Each frame holds one slot. A worn item draws its own icon; an empty slot
 * draws an empty frame. The centre is the character doll (WP37), composited
 * in main from the client's own khan archives the way the client's paperdoll
 * is, and asked for by URL like an item icon; when there is no doll (no game
 * folder, no body on the record yet) the centre keeps its placeholder.
 *
 * The layout follows the client Equip screen: head and neck across the top, the
 * body down the centre, the hands and arms to the sides, and the legs, feet,
 * and belt across the bottom.
 */

/**
 * The doll, or the placeholder when main has none to give. The `<img>` asks
 * `midir-icon://doll/…`; a 404 fires `onError`, and the placeholder returns.
 * The URL changes with the appearance, so a new login redraws it.
 */
function Doll({ record }: { record: CharacterRecord }): React.JSX.Element {
  const src = record.appearance.bodyShape > 0 ? dollUrl(record.appearance) : null
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => setFailed(null), [src])
  const showDoll = src !== null && failed !== src
  return (
    <Box
      sx={{
        gridArea: 'body',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'text.disabled',
        gap: 0.5,
        minWidth: 0,
        overflow: 'visible'
      }}
      data-testid="equip-doll"
    >
      {showDoll ? (
        <Box
          component="img"
          src={src}
          alt={`${record.name}, as the game draws them`}
          onError={() => setFailed(src)}
          // The composite's natural size: 57 px of body with 27 px of
          // transparent padding each side for the wide sheets, so it may
          // overflow its cell without touching the frames beside it.
          sx={{
            imageRendering: 'pixelated',
            width: 111,
            height: 85,
            maxWidth: 'none',
            flexShrink: 0
          }}
          data-testid="doll-image"
        />
      ) : (
        <>
          <PersonOutlineOutlinedIcon sx={{ fontSize: 56 }} />
          <Typography variant="caption" sx={{ textAlign: 'center' }}>
            No preview
          </Typography>
        </>
      )}
    </Box>
  )
}

/** Each cell maps a grid area to an equipment slot id (see labels.ts). */
const SLOT_CELLS: readonly { area: string; slot: number }[] = [
  { area: 'ear', slot: 5 },
  { area: 'head', slot: 4 },
  { area: 'neck', slot: 6 },
  { area: 'armor2', slot: 15 },
  { area: 'armor', slot: 2 },
  { area: 'head2', slot: 16 },
  { area: 'cape', slot: 14 },
  { area: 'cape2', slot: 17 },
  { area: 'weapon', slot: 1 },
  { area: 'lhand', slot: 7 },
  { area: 'rhand', slot: 8 },
  { area: 'shield', slot: 3 },
  { area: 'larm', slot: 9 },
  { area: 'rarm', slot: 10 },
  { area: 'leg', slot: 12 },
  { area: 'foot', slot: 13 },
  { area: 'belt', slot: 11 },
  { area: 'cape3', slot: 18 }
]

const GRID_AREAS = [
  '".      ear    head   neck   .     "',
  '"armor2 armor  head2  cape   cape2 "',
  '"weapon lhand  body   rhand  shield"',
  '"larm   .      body   .      rarm  "',
  '".      leg    foot   belt   cape3 "'
].join('\n')

function SlotFrame({ slot, item }: { slot: number; item: ItemRef | undefined }): React.JSX.Element {
  const name = equipmentSlotName(slot)
  const durability = item ? formatDurability(item.durability, item.maxDurability) : ''
  const title =
    item === undefined
      ? name
      : durability === ''
        ? `${name}: ${item.name}`
        : `${name}: ${item.name} — durability ${durability}`
  return (
    <Tooltip title={title}>
      <Box
        data-testid="equip-slot"
        data-slot={slot}
        aria-label={title}
        sx={{
          gridArea: SLOT_CELLS.find((cell) => cell.slot === slot)?.area,
          aspectRatio: '1 / 1',
          minWidth: 0,
          border: 1,
          borderColor: 'divider',
          borderRadius: 1,
          bgcolor: 'background.paperDark',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {item !== undefined ? <ItemIcon sprite={item.sprite} color={item.color} size={30} /> : null}
      </Box>
    </Tooltip>
  )
}

function EquipScreen({ record }: { record: CharacterRecord }): React.JSX.Element {
  return (
    <Box
      data-testid="equip-screen"
      sx={{
        display: 'grid',
        gridTemplateAreas: GRID_AREAS,
        // minmax(0, 1fr): a track never grows for its content, so the doll,
        // wider than its cell, overflows it rather than squeezing the rest.
        gridTemplateColumns: 'repeat(5, minmax(0, 1fr))',
        gap: 1,
        maxWidth: 340,
        mx: 'auto'
      }}
    >
      {SLOT_CELLS.map((cell) => (
        <SlotFrame key={cell.slot} slot={cell.slot} item={record.equipment[cell.slot]} />
      ))}
      <Doll record={record} />
    </Box>
  )
}

export default EquipScreen
