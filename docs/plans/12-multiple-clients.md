# WP12 — multiple clients at once

**Size:** S. **Depends on:** WP10. Read `00-overview.md` first. **PLANNED.**

## Goal

Two Dark Ages clients open at once, both read, and the app says so. A player with an alt logged in
beside a main should see both names, not whichever logged in last.

## Why it is small

**The decode path already does this.** WP10 keyed live characters by connection id precisely so a
close or an exit clears the right one, and `captureService` holds one reducer state per connection.
Nothing below the status line assumes one client. What is left is the shape of `CaptureStatus` and
one component.

## The one way to get this wrong

`CaptureStatus.characterName` is a single optional string, and `state: 'decoding'` is defined as
"reading a named character's packets". Replacing the string with an array and leaving `state` alone
would leave two sources of truth for the same question — `state === 'decoding'` and
`characters.length > 0` — which will disagree the first time a character logs off while another
stays. **Derive the state from the list**, in one place, and let the renderer read only the list.

## Decisions

1. **`characterName?: string` becomes `characters: string[]`.** Always present, possibly empty, in
   the order the connections were opened. An array with one entry is the ordinary case and needs no
   special handling anywhere.
2. **`state` stays, and is derived.** `stopped` when not running, `decoding` when `characters` is
   not empty, `listening` otherwise. It is a convenience over the list, computed in `status()`, and
   nothing else may compute it.
3. **`STOPPED_STATUS` gains `characters: []`.** Callers that spread it keep working.
4. **The indicator shows one name, or a count.** One character reads as today. Two or more reads as
   `2 characters` with the names in the tooltip, because the title bar has no room and a truncated
   list is worse than a number. This is the whole UI change.
5. **The `Live` page lists them all**, one row each, since it has the room the title bar does not.
6. **No per-client capture control.** Capture is one adapter and one filter; the clients are what
   turned up on it.

## Non-goals (stop-lines)

- **No per-character capture toggles**, no "follow this one", no pinning.
- **No change to the record.** Two clients write two records exactly as two sequential logins do.
- **No multi-client recording format change.** A recording already carries every connection with its
  own id; `replaySource` already replays them together.
- **No new IPC channel.** The status event already carries everything.

## Current state when you start

- [shared/types.ts:73-101](../../src/shared/types.ts#L73-L101) — `CaptureStatus` and
  `STOPPED_STATUS`.
- [captureService.ts](../../src/main/captureService.ts) — `liveCharacters: Map<string, string>` is
  already the list; `currentCharacter()` collapses it to the most recent, and `status()` is the only
  reader. Both go.
- [CaptureIndicator.tsx](../../src/renderer/src/components/CaptureIndicator.tsx) — `appearanceFor`
  takes `characterName` and is a pure function, so it is directly testable with a list.
- [pages/Live.tsx](../../src/renderer/src/pages/Live.tsx) — shows the one name today.
- `captureService.test.ts` has four logoff tests that assert on `characterName`; they become
  assertions on the list, and one of them grows a second connection.

## Contracts

```ts
export interface CaptureStatus {
  running: boolean
  /** Derived from `characters`: never set it independently. */
  state: 'stopped' | 'listening' | 'decoding'
  device?: string
  /** Every character being decoded now, in connection order. Empty is normal. */
  characters: string[]
  recordingPath?: string
  connections: number
  decodedCount: number
  unreadableCount: number
  missedHandshake: boolean
}
```

No channel changes. `capture:status` carries the same object with a wider field.

## Acceptance criteria

1. One client logged in: the title bar reads the character's name, exactly as it does today.
2. Two clients logged in: the title bar reads `2 characters` and the tooltip names both.
3. One of two logs off: the remaining name is shown, and the one that left is gone at once.
4. Both log off: the bar returns to `Listening`, not to a stale name.
5. A connection that closes without an exit packet clears its character (the crash path).
6. `missedHandshake` still outranks every state — it is the only failure the user can fix.
7. Nothing in the record, the item index, or the character sheet changes.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. `captureService.test.ts`: a recording with **two world connections**, each with its own redirect,
   character name and session key, interleaved. Assert the list through both logins and both
   logoffs. The existing four logoff tests move to the list.
3. `CaptureIndicator.test.tsx`: zero, one, and two names, plus the `missedHandshake` override.
4. GUI (hand to Sabrael): two clients logged in at once, confirm the bar and the Live page, then log
   one off and confirm the other survives. **This is the only check that proves the feature**, and
   an agent cannot run it.
