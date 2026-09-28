import AccountBalanceOutlinedIcon from '@mui/icons-material/AccountBalanceOutlined'
import CheckroomOutlinedIcon from '@mui/icons-material/CheckroomOutlined'
import SearchOutlinedIcon from '@mui/icons-material/SearchOutlined'
import {
  Box,
  InputAdornment,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography
} from '@mui/material'
import GoldTooltip from '@renderer/components/GoldTooltip'
import Guidance from '@renderer/components/Guidance'
import ItemIcon from '@renderer/components/ItemIcon'
import ItemTooltip from '@renderer/components/ItemTooltip'
import { formatAgo, formatNumber, plural } from '@renderer/lib/format'
import { useCharacterStore } from '@renderer/store/characterStore'
import { summariseGold } from '@shared/character'
import {
  buildItemIndex,
  filterItems,
  summariseItems,
  type ItemHolder,
  type ItemIndexEntry
} from '@shared/items'
import { useVirtualizer } from '@tanstack/react-virtual'
import React, { useEffect, useMemo, useRef, useState } from 'react'

/** Lists longer than this are windowed; a shorter one renders in full. */
const WINDOW_THRESHOLD = 60
/** A one-line row's height, before the wrapped rows are measured. */
const ROW_HEIGHT = 37
/** Rows kept mounted beyond the view, so a scroll does not reveal a blank. */
const OVERSCAN = 12
/** The table's column count, for the spacer rows. */
const COLUMNS = 4

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

/**
 * One character that holds the item.
 *
 * One character is one answer, however many slots they keep it in. The name
 * carries the weight, the total sits beside it in a dimmer tone, and a worn
 * item takes a small mark. The slots are in the tooltip, because they are the
 * detail a player asks for and not the answer they came for.
 */
function HolderTag({
  itemName,
  holder
}: {
  itemName: string
  holder: ItemHolder
}): React.JSX.Element {
  return (
    <ItemTooltip itemName={itemName} holder={holder}>
      <Box
        component="span"
        tabIndex={0}
        data-testid="item-holder"
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          cursor: 'default',
          borderRadius: 1,
          px: 0.5,
          '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
          '&:focus-visible': { outline: 'none' }
        }}
      >
        {holder.equipped ? (
          <CheckroomOutlinedIcon
            fontSize="inherit"
            aria-label="worn"
            sx={{ color: 'text.link', fontSize: '0.9em' }}
          />
        ) : null}
        {holder.banked ? (
          <AccountBalanceOutlinedIcon
            fontSize="inherit"
            aria-label="in the bank"
            sx={{ color: 'text.secondary', fontSize: '0.9em' }}
          />
        ) : null}
        <Typography component="span" variant="body2" sx={{ fontWeight: 'medium' }}>
          {holder.character}
        </Typography>
        {holder.totalCount > 1 ? (
          <Typography
            component="span"
            variant="body2"
            sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
          >
            ×{formatNumber(holder.totalCount)}
          </Typography>
        ) : null}
      </Box>
    </ItemTooltip>
  )
}

/**
 * One row of the index. Memoised because the windowing keeps the same rows
 * mounted while the table around them re-renders, and because a row is the
 * expensive thing here: an icon, and a tooltip for each holder.
 */
const ItemRow = React.memo(function ItemRow({
  entry,
  index,
  measure
}: {
  entry: ItemIndexEntry
  /** The row's place in the list, for the virtualizer's own measurement. */
  index?: number
  measure?: (element: HTMLElement | null) => void
}): React.JSX.Element {
  return (
    <TableRow hover ref={measure} data-index={index}>
      <TableCell sx={{ fontWeight: 'medium' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <ItemIcon sprite={entry.sprite} />
          {entry.name}
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        {formatNumber(entry.totalCount)}
      </TableCell>
      <TableCell>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            columnGap: 1,
            rowGap: 0.25,
            // A thin rule between names, so the list reads as one sentence
            // instead of a row of separate objects.
            '& > span + span': {
              borderLeft: 1,
              borderColor: 'divider',
              pl: 1,
              ml: -0.5
            }
          }}
        >
          {entry.holders.map((holder) => (
            <HolderTag key={holder.character} itemName={entry.name} holder={holder} />
          ))}
        </Box>
      </TableCell>
      <TableCell align="right" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
        {formatAgo(entry.lastSeenMs)}
      </TableCell>
    </TableRow>
  )
})

function Items(): React.JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const refresh = useCharacterStore((s) => s.refresh)
  const [query, setQuery] = useState('')
  const scrollRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const index = useMemo(() => buildItemIndex(characters), [characters])
  const shown = useMemo(() => filterItems(index, query), [index, query])
  const summary = useMemo(() => summariseItems(shown), [shown])
  const gold = useMemo(() => summariseGold(characters), [characters])
  // Only characters that hold gold read on the breakdown; a zero adds nothing.
  const goldHolders = useMemo(() => gold.contributions.filter((c) => c.gold > 0), [gold])

  /**
   * The window over the rows (HTOO-85).
   *
   * A row is not cheap — an icon and a tooltip for each holder — and the index
   * grows with every character: 25 characters give 703 rows and 1375 holders,
   * which is 9500 DOM nodes and over a second of mounting before anything is on
   * screen. So above the threshold only the visible slice mounts, with a spacer
   * row above and below holding the scroll height so the scrollbar and the
   * sticky header behave as they did.
   *
   * The rows are **measured**, not assumed: a held-by cell wraps, so a row with
   * a dozen holders is several times the height of a row with one.
   */
  const rows = useVirtualizer({
    count: shown.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    initialRect: { width: 900, height: 600 },
    getItemKey: (index) => shown[index]?.name ?? index
  })
  const virtual = shown.length > WINDOW_THRESHOLD ? rows.getVirtualItems() : []
  /**
   * The window is in force only once it has placed something.
   *
   * A scroller the virtualizer cannot measure places no rows, and a window of
   * nothing is an empty table — which is worse than a slow one. It happens where
   * there is no `ResizeObserver`, which is every jsdom test, and it could happen
   * on a frame that precedes layout. So the full list renders until a
   * measurement arrives: correct first, fast as soon as it can be.
   */
  const windowed = virtual.length > 0
  const padTop = windowed ? virtual[0]!.start : 0
  const padBottom = windowed ? rows.getTotalSize() - virtual[virtual.length - 1]!.end : 0

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
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25 }}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }} data-testid="item-summary">
            {`${plural(summary.itemCount, 'item')} · ${formatNumber(summary.totalCount)} held across ${plural(summary.characterCount, 'character')}`}
          </Typography>
          <GoldTooltip contributions={goldHolders}>
            <Box
              component="span"
              tabIndex={0}
              data-testid="gold-total"
              sx={{
                cursor: 'default',
                borderRadius: 1,
                px: 0.5,
                '&:hover, &:focus-visible': { bgcolor: 'action.hover' },
                '&:focus-visible': { outline: 'none' }
              }}
            >
              <Typography component="span" variant="body2" sx={{ color: 'text.secondary' }}>
                {`${formatNumber(gold.total)} gold across ${plural(goldHolders.length, 'character')}`}
              </Typography>
            </Box>
          </GoldTooltip>
        </Box>
      </Box>

      {shown.length === 0 ? (
        <Typography variant="body2" sx={{ color: 'text.secondary', px: 2.5, pb: 2.5 }}>
          No item matches “{query.trim()}”.
        </Typography>
      ) : (
        <TableContainer ref={scrollRef} sx={{ flex: 1, minHeight: 0, px: 2.5, pb: 2.5 }}>
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
              {windowed ? (
                <>
                  {padTop > 0 ? (
                    <TableRow style={{ height: padTop }} data-testid="item-index-pad-top">
                      <TableCell colSpan={COLUMNS} sx={{ p: 0, border: 0 }} />
                    </TableRow>
                  ) : null}
                  {virtual.map((slot) => (
                    <ItemRow
                      key={slot.key}
                      entry={shown[slot.index]!}
                      index={slot.index}
                      measure={rows.measureElement}
                    />
                  ))}
                  {padBottom > 0 ? (
                    <TableRow style={{ height: padBottom }} data-testid="item-index-pad-bottom">
                      <TableCell colSpan={COLUMNS} sx={{ p: 0, border: 0 }} />
                    </TableRow>
                  ) : null}
                </>
              ) : (
                shown.map((entry) => <ItemRow key={entry.name} entry={entry} />)
              )}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Box>
  )
}

export default Items
