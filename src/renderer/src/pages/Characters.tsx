import DeleteOutlinedIcon from '@mui/icons-material/DeleteOutlined'
import { Box, Button, IconButton, List, ListItemButton, ListItemText, Tooltip } from '@mui/material'
import CharacterSheet from '@renderer/components/CharacterSheet'
import Guidance from '@renderer/components/Guidance'
import { characterClassName, formatAgo, formatNumber } from '@renderer/lib/format'
import { findCharacter, useCharacterStore } from '@renderer/store/characterStore'
import React, { useEffect } from 'react'

/**
 * Every character Midir has recorded.
 *
 * A stored record is a snapshot of the last time the character was seen. The
 * list says how long ago that was, so an old count is never read as a live one.
 */

const LIST_WIDTH = 300

function Characters(): React.JSX.Element {
  const characters = useCharacterStore((s) => s.characters)
  const selected = useCharacterStore((s) => s.selected)
  const select = useCharacterStore((s) => s.select)
  const remove = useCharacterStore((s) => s.remove)
  const refresh = useCharacterStore((s) => s.refresh)

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Show the most recently seen character until the user picks another.
  const shown = findCharacter(characters, selected) ?? characters[0] ?? null

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
        <List dense disablePadding data-testid="character-list">
          {characters.map((record) => (
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
