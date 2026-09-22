import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import {
  Box,
  Button,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  TextField,
  Tooltip,
  Typography
} from '@mui/material'
import CharacterSheet from '@renderer/components/CharacterSheet'
import Guidance from '@renderer/components/Guidance'
import { characterClassName, formatAgo, formatNumber } from '@renderer/lib/format'
import { findCharacter, useCharacterStore } from '@renderer/store/characterStore'
import { useSettingsStore } from '@renderer/store/settingsStore'
import { HIDE_UNSEEN_DAY_CHOICES, splitUnseen } from '@shared/unseen'
import React, { useEffect } from 'react'

/**
 * Every character Midir has recorded.
 *
 * A stored record is a snapshot of the last time the character was seen. The
 * list says how long ago that was, so an old count is never read as a live one.
 *
 * "Hide unseen" (WP25) is a view over the list, not a retention policy. A
 * character last seen more than N days before the newest sighting drops out of
 * the list and comes back when N changes; the record stays in the file, and
 * only Forget removes one. The threshold is a setting, so it survives a
 * restart, and the control sits on the list it filters rather than in
 * Settings, where a hidden character would be a mystery.
 */

const LIST_WIDTH = 300

function Characters(): React.JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const selected = useCharacterStore((s) => s.selected)
  const select = useCharacterStore((s) => s.select)
  const remove = useCharacterStore((s) => s.remove)
  const refresh = useCharacterStore((s) => s.refresh)
  const hideUnseenDays = useSettingsStore((s) => s.hideUnseenDays)
  const setHideUnseenDays = useSettingsStore((s) => s.setHideUnseenDays)

  useEffect(() => {
    void refresh()
  }, [refresh])

  const { shown: listed, hidden } = splitUnseen(characters, hideUnseenDays)

  // Show the most recently seen listed character until the user picks another.
  // A selection that the filter hid falls back to the newest listed one, so the
  // sheet never shows a character the list does not.
  const shown = findCharacter(listed, selected) ?? listed[0] ?? null

  if (characters.length === 0) {
    return (
      <Guidance
        title="No characters yet"
        detail="Turn capture on, then log in to Dark Ages. Every character you play is recorded here."
      />
    )
  }

  return (
    <Box sx={{ display: 'flex', flex: 1, minHeight: 0 }}>
      <Box
        sx={{
          width: LIST_WIDTH,
          flexShrink: 0,
          borderRight: 1,
          borderColor: 'divider',
          overflow: 'auto'
        }}
      >
        <Box sx={{ p: 1.5, pb: 1 }}>
          <TextField
            select
            size="small"
            fullWidth
            label="Hide unseen"
            value={hideUnseenDays}
            onChange={(event) => setHideUnseenDays(Number(event.target.value))}
          >
            {HIDE_UNSEEN_DAY_CHOICES.map((days) => (
              <MenuItem key={days} value={days}>
                {days === 0 ? 'Off' : `Not seen in ${days} days`}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <List dense disablePadding data-testid="character-list">
          {listed.map((record) => (
            <ListItemButton
              key={record.name}
              selected={record.name === shown?.name}
              onClick={() => select(record.name)}
            >
              <ListItemText
                primary={record.name}
                secondary={`Level ${formatNumber(record.stats.level)} ${characterClassName(
                  record.appearance.characterClass
                )} · ${formatAgo(record.lastSeenMs)}`}
                slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
              />
              <Tooltip title={`Forget ${record.name}`}>
                <IconButton
                  size="small"
                  aria-label={`Forget ${record.name}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    void remove(record.name)
                  }}
                >
                  <DeleteOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </ListItemButton>
          ))}
        </List>
        {hidden.length > 0 && (
          <Typography
            variant="caption"
            sx={{ display: 'block', px: 2, py: 1, color: 'text.secondary' }}
            data-testid="hidden-count"
          >
            {hidden.length} hidden, still on file. Set Hide unseen to Off to show{' '}
            {hidden.length === 1 ? 'it' : 'them'}.
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, minWidth: 0, overflow: 'auto', p: 2.5 }}>
        {shown === null ? (
          <Button onClick={() => void refresh()}>Reload</Button>
        ) : (
          <CharacterSheet record={shown} />
        )}
      </Box>
    </Box>
  )
}

export default Characters
