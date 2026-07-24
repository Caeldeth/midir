import { Alert, Box, Button, Tab, Tabs } from '@mui/material'
import CharacterSheet from '@renderer/components/CharacterSheet'
import Guidance from '@renderer/components/Guidance'
import { useCaptureStore } from '@renderer/store/captureStore'
import { findCharacter, useCharacterStore } from '@renderer/store/characterStore'
import type { CharacterRecord } from '@shared/types'
import React from 'react'

/**
 * The characters being decoded now.
 *
 * The page has four empty states, and each one tells the user what to do next
 * instead of showing a blank sheet. Once a character is live it shows the full
 * sheet, and two or more clients each get a tab.
 */

interface LiveProps {
  onOpenSettings: () => void
}

function Live({ onOpenSettings }: LiveProps): React.JSX.Element {
  const status = useCaptureStore((s) => s.status)
  const characters = useCharacterStore((s) => s.characters)

  // The live records, in connection order. A name in the status without a
  // record yet is dropped until the record arrives.
  const live: CharacterRecord[] = status.characters
    .map((name) => findCharacter(characters, name))
    .filter((record): record is CharacterRecord => record !== null)

  // Track the tab by character name, not index, so a logoff that shrinks the
  // list does not leave a stale selection pointing at the wrong character.
  const [selected, setSelected] = React.useState<string | null>(null)
  const active = live.find((record) => record.name === selected) ?? live[0] ?? null

  if (status.missedHandshake && live.length === 0) {
    return (
      <Guidance
        title="Midir joined too late"
        detail={
          'Midir learns this session’s keys from the login handshake, so it has to be ' +
          'running before you log in. Log out of Dark Ages, then log back in with Midir open.'
        }
      />
    )
  }

  if (!status.running) {
    return (
      <Guidance
        title="Capture is off"
        detail="Choose a network adapter and turn capture on, then start Dark Ages and log in."
        action={
          <Button variant="contained" onClick={onOpenSettings}>
            Open settings
          </Button>
        }
      />
    )
  }

  if (active === null) {
    return (
      <Guidance
        title="Listening"
        detail={
          status.connections > 0
            ? 'Dark Ages is connected. The sheet fills as soon as the world sends your character.'
            : 'Start Dark Ages and log in. Midir reads the login handshake as it happens.'
        }
      />
    )
  }

  return (
    <Box sx={{ p: 2.5, overflow: 'auto' }}>
      {status.missedHandshake ? (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          Part of this session arrived before Midir could read it. Log out and back in with Midir
          running to be sure the sheet is complete.
        </Alert>
      ) : null}
      {live.length > 1 ? (
        <Tabs
          value={active.name}
          onChange={(_event, name: string) => setSelected(name)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{ mb: 2 }}
        >
          {live.map((record) => (
            <Tab key={record.name} value={record.name} label={record.name} />
          ))}
        </Tabs>
      ) : null}
      <CharacterSheet record={active} />
    </Box>
  )
}

export default Live
