import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import {
  Box,
  Chip,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import Guidance from '@renderer/components/Guidance'
import {
  equipmentSlotName,
  formatAgo,
  formatDurability,
  formatNumber,
  plural
} from '@renderer/lib/format'
import { useCharacterStore } from '@renderer/store/characterStore'
import { buildItemIndex, filterItems, summariseItems, type ItemHolding } from '@shared/items'
import React, { useEffect, useMemo, useState } from 'react'

/**
 * Every item across every character, searchable by name.
 *
 * This is the view Midir exists for. It is derived from the character records
 * on every render, so it is always as fresh as they are and there is no second
 * copy of the truth.
 *
 * A record is a snapshot of the last time a character was read, so every
 * holding says how long ago that was. A count from three weeks ago must never
 * read as a count from now.
 */

/** Append the count when a holding has more than one. One rule, two subjects. */
function withCount(text: string, count: number): string {
  return count > 1 ? `${text} × ${formatNumber(count)}` : text
}

function HolderChip({ holding }: { holding: ItemHolding }): React.JSX.Element {
  const where =
    holding.place === 'equipment' ? equipmentSlotName(holding.slot) : `Slot ${holding.slot}`
  const durability = formatDurability(holding.durability, holding.maxDurability)
  const detail = [
    withCount(where, holding.count),
    durability === '' ? '' : `durability ${durability}`,
    `last seen ${formatAgo(holding.lastSeenMs)}`
  ]
    .filter((part) => part !== '')
    .join(' · ')

  return (
    <Tooltip title={detail}>
      <Chip
        size="small"
        variant={holding.place === 'equipment' ? 'filled' : 'outlined'}
        label={withCount(holding.character, holding.count)}
      />
    </Tooltip>
  )
}

function Items(): React.JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const refresh = useCharacterStore((s) => s.refresh)
  const [query, setQuery] = useState('')

  useEffect(() => {
    void refresh()
  }, [refresh])

  const index = useMemo(() => buildItemIndex(characters), [characters])
  const shown = useMemo(() => filterItems(index, query), [index, query])
  const summary = useMemo(() => summariseItems(shown), [shown])

  // Gate on the index, not the character list. A recorded character can hold
  // no items at all: one SStatus is enough to file a record, and it arrives
  // before the first item packet. Gating on the list showed that character a
  // search result of "no item matches" against a search nobody had typed.
  if (index.length === 0) {
    return (
      <Guidance
        title="No items yet"
        detail={
          characters.length === 0
            ? 'Turn capture on, then log in to Dark Ages. Everything your characters carry and ' +
              'wear is indexed here.'
            : 'Midir has not read an item for any character yet. The index fills as the world ' +
              'sends your inventory.'
        }
      />
    )
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          flexWrap: 'wrap',
          p: 2.5,
          pb: 1.5
        }}
      >
        <TextField
          size="small"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search items"
          sx={{ minWidth: 260 }}
          slotProps={{
            htmlInput: { 'aria-label': 'Search items' },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon fontSize="small" />
                </InputAdornment>
              )
            }
          }}
        />
        <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="item-summary">
          {`${plural(summary.itemCount, 'item')} · ${formatNumber(summary.totalCount)} held across ${plural(summary.characterCount, 'character')}`}
        </Typography>
      </Box>

      {shown.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 2.5, pb: 2.5 }}>
          No item matches “{query.trim()}”.
        </Typography>
      ) : (
        <TableContainer sx={{ flex: 1, minHeight: 0, px: 2.5, pb: 2.5 }}>
          <Table size="small" stickyHeader data-testid="item-index">
            <TableHead>
              <TableRow>
                <TableCell>Item</TableCell>
                <TableCell align="right">Total</TableCell>
                <TableCell>Held by</TableCell>
                <TableCell align="right">Last seen</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {shown.map((entry) => (
                <TableRow key={entry.name} hover>
                  <TableCell sx={{ fontWeight: 'medium' }}>{entry.name}</TableCell>
                  <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                    {formatNumber(entry.totalCount)}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                      {entry.holdings.map((holding) => (
                        <HolderChip
                          key={`${holding.character}-${holding.place}-${holding.slot}`}
                          holding={holding}
                        />
                      ))}
                    </Box>
                  </TableCell>
                  <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {formatAgo(entry.lastSeenMs)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}

export default Items
