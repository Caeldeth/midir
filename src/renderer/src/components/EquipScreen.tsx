import PersonOutlineOutlinedIcon from '@mui/icons-material/PersonOutlineOutlined'
import { Box, Tooltip, Typography } from '@mui/material'
import ItemIcon from '@renderer/components/ItemIcon'
import { equipmentSlotName, formatDurability } from '@renderer/lib/format'
import type { CharacterRecord, ItemRef } from '@shared/types'
import React from 'react'

/**
 * The equipment, in the client's Equip-screen layout.
 *
 * Each frame holds one slot. A worn item draws its own icon; an empty slot
 * draws an empty frame. The centre keeps a placeholder, because Midir does not
 * yet composite the character sprite the client shows there — that needs the
 * body archives and a layer compositor Midir does not have.
 *
 * The layout follows the client Equip screen: head and neck across the top, the
 * body down the centre, the hands and arms to the sides, and the legs, feet,
 * and belt across the bottom.
 */

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
        gridTemplateColumns: 'repeat(5, 1fr)',
        gap: 1,
        maxWidth: 340,
        mx: 'auto'
      }}
    >
      {SLOT_CELLS.map((cell) => (
        <SlotFrame key={cell.slot} slot={cell.slot} item={record.equipment[cell.slot]} />
      ))}
      <Box
        sx={{
          gridArea: 'body',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.disabled',
          gap: 0.5
        }}
      >
        <PersonOutlineOutlinedIcon sx={{ fontSize: 56 }} />
        <Typography variant="caption" sx={{ textAlign: 'center' }}>
          No preview
        </Typography>
      </Box>
    </Box>
  )
}

export default EquipScreen
