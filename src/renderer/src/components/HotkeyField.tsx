import { Button, Stack, TextField } from '@mui/material'
import { formatHotkey } from '@shared/types'
import React, { useState } from 'react'

/**
 * Capture a global hotkey as an Electron accelerator.
 *
 * The field records the next key chord after it is focused. A chord needs a
 * modifier and a main key, so a stray letter cannot become a global shortcut.
 * Escape cancels the recording.
 */

interface HotkeyFieldProps {
  value: string
  onChange: (accelerator: string) => void
  label: string
  /** The value the Reset button restores. */
  defaultValue: string
  /** Show a Clear button, for a hotkey that may be unset. */
  allowEmpty?: boolean
}

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta'])

const NAMED_KEYS: Record<string, string> = {
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ' ': 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown'
}

/** The main key of a chord as an Electron accelerator token, or null. */
function mainKey(key: string): string | null {
  if (key.length === 1) return key.toUpperCase()
  if (/^F\d{1,2}$/.test(key)) return key
  return NAMED_KEYS[key] ?? null
}

/** Build an accelerator from a key event, or null when it is not a valid chord. */
function toAccelerator(event: React.KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null
  const parts: string[] = []
  if (event.ctrlKey) parts.push('CommandOrControl')
  if (event.metaKey) parts.push('Super')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const main = mainKey(event.key)
  if (main === null) return null
  parts.push(main)
  // A global shortcut needs at least one modifier, or it would fire on a normal
  // keypress anywhere.
  if (parts.length < 2) return null
  return parts.join('+')
}

function HotkeyField({
  value,
  onChange,
  label,
  defaultValue,
  allowEmpty
}: HotkeyFieldProps): React.JSX.Element {
  const [recording, setRecording] = useState(false)

  const onKeyDown = (event: React.KeyboardEvent): void => {
    event.preventDefault()
    if (event.key === 'Escape') {
      setRecording(false)
      return
    }
    const accelerator = toAccelerator(event)
    if (accelerator !== null) {
      onChange(accelerator)
      setRecording(false)
    }
  }

  return (
    <Stack direction="row" sx={{ gap: 1, alignItems: 'center' }}>
      <TextField
        size="small"
        label={label}
        value={recording ? 'Press keys…' : formatHotkey(value)}
        onFocus={() => setRecording(true)}
        onBlur={() => setRecording(false)}
        onKeyDown={onKeyDown}
        slotProps={{ htmlInput: { readOnly: true, 'aria-label': label } }}
        sx={{ width: 260 }}
      />
      <Button size="small" onClick={() => onChange(defaultValue)} disabled={value === defaultValue}>
        Reset
      </Button>
      {allowEmpty === true ? (
        <Button size="small" onClick={() => onChange('')} disabled={value === ''}>
          Clear
        </Button>
      ) : null}
    </Stack>
  )
}

export default HotkeyField
