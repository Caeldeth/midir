import { Alert, Box, Button } from '@mui/material'
import CharacterSheet from '@renderer/components/CharacterSheet'
import Guidance from '@renderer/components/Guidance'
import { useCaptureStore } from '@renderer/store/captureStore'
import { findCharacter, useCharacterStore } from '@renderer/store/characterStore'
import React from 'react'

/**
 * The character being decoded now.
 *
 * The page has four states, and each one tells the user what to do next
 * instead of showing an empty sheet.
 */

interface LiveProps {
  onOpenSettings: () => void
}

function Live({ onOpenSettings }: LiveProps): React.JSX.Element {
  const status = useCaptureStore((s) => s.status)
  const characters = useCharacterStore((s) => s.characters)
  const record = findCharacter(characters, status.characterName ?? null)

  if (status.missedHandshake && record === null) {
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

  if (record === null) {
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
      <CharacterSheet record={record} />
    </Box>
  )
}

export default Live
