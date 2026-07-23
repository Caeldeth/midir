import { Box, Tooltip, Typography, useTheme } from '@mui/material'
import { equipmentSlotName, formatAgo, formatDurability, formatNumber } from '@renderer/lib/format'
import type { ItemHolder } from '@shared/items'
import React from 'react'

/**
 * The item tooltip, in the shape the game client uses.
 *
 * The retail client shows a bordered panel with the item name above a
 * durability line in cornflower blue. Midir keeps that arrangement so a player
 * reads it without learning anything new, and adds the two facts only Midir
 * knows: which slot each one is in, and how long ago it read that character.
 *
 * The panel takes its surface, border, and name colour from the active theme,
 * so it belongs to the six themes rather than to one of them.
 */

/** The durability colour the client uses. It needs a darker pair on a light theme. */
const DURABILITY_DARK = '#6495ed'
const DURABILITY_LIGHT = '#2f4f8f'

/** When the bank rows in this holder were read. */
function bankReadAtMs(holder: ItemHolder): number {
  return Math.max(...holder.holdings.filter((h) => h.place === 'bank').map((h) => h.lastSeenMs))
}

interface ItemTooltipProps {
  itemName: string
  holder: ItemHolder
  children: React.ReactElement
}

/** One line for each slot the character holds the item in. */
function SlotLine({
  holding,
  durabilityColor
}: {
  holding: ItemHolder['holdings'][number]
  durabilityColor: string
}): React.JSX.Element {
  const where =
    holding.place === 'equipment'
      ? equipmentSlotName(holding.slot)
      : holding.place === 'bank'
        ? 'In the bank'
        : `Pack slot ${holding.slot}`
  const durability = formatDurability(holding.durability, holding.maxDurability)

  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {holding.count > 1 ? `${where} × ${formatNumber(holding.count)}` : where}
      </Typography>
      {durability === '' ? null : (
        <Typography
          variant="caption"
          sx={{ color: durabilityColor, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
        >
          {durability}
        </Typography>
      )}
    </Box>
  )
}

function ItemTooltip({ itemName, holder, children }: ItemTooltipProps): React.JSX.Element {
  // The client's cornflower blue reads well on the four dark themes and badly
  // on the two light ones, whose tooltip surface is light. The light pair gets
  // a darker tone of the same colour.
  const theme = useTheme()
  const durabilityColor = theme.palette.mode === 'dark' ? DURABILITY_DARK : DURABILITY_LIGHT

  return (
    <Tooltip
      arrow
      enterDelay={150}
      slotProps={{
        tooltip: {
          sx: (theme) => ({
            // The keyline the themes give a Paper, so the tooltip reads as one
            // of Midir's own surfaces and not as a browser default.
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
            sx={(theme) => ({ color: theme.palette.text.headline, fontWeight: 'bold' })}
          >
            {itemName}
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', mb: 0.5 }}>
            {holder.character} · {formatNumber(holder.totalCount)} held
          </Typography>
          {holder.holdings.map((holding) => (
            <SlotLine
              key={`${holding.place}-${holding.slot}`}
              holding={holding}
              durabilityColor={durabilityColor}
            />
          ))}
          <Typography variant="caption" sx={{ color: 'text.disabled', mt: 0.5 }}>
            Last read {formatAgo(holder.lastSeenMs)}
          </Typography>
          {holder.banked ? (
            // The bank is read only when the player opens it, so its age is
            // its own and usually older than the rest of the record.
            <Typography variant="caption" sx={{ color: 'text.disabled' }}>
              Bank read {formatAgo(bankReadAtMs(holder))}
            </Typography>
          ) : null}
        </Box>
      }
    >
      {children}
    </Tooltip>
  )
}

export default ItemTooltip
