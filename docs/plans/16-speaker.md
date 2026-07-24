# WP16 — Speaker

**Size:** S. **Depends on:** WP13. Read `00-overview.md` first. **PLANNED — build this second, right
after the action layer.**

## Goal

Replace DA Speaker: say a line of text into the game on an interval the user sets, and stop when
told. It is the smallest possible user of the action layer, which is exactly why it goes first —
**it proves WP13 with almost no logic of its own.**

## What the legacy tool is

`DASpeaker.exe` is `PostMessage`, a timer, a rich text box, a global hotkey, and a systray icon.
There is no memory access and no protocol knowledge in it at all. Everything it does, WP13 already
provides; this WP is a text box, an interval, and a loop.

## The one way to get this wrong

**Sending into a state the client is not in.** The legacy tool types on a timer and has no idea
whether the chat line is open, whether a dialog has focus, or whether the character is even logged
in — so a mistimed line becomes a menu selection, a walk, or nothing at all. Midir knows better than
that, because it is reading the connection: if there is no live character on the bound connection,
there is nobody to speak, and the speaker stops rather than typing into a login screen.

## Decisions

1. **The unit is a line, not a keystroke.** The driver asks the action layer for the text and the
   return; the action layer decides the timing between keys.
2. **The interval is a floor, not a schedule.** Jitter is WP13's policy. A speaker that fires on an
   exact period is a speaker that is trivial to see in a chat log.
3. **It stops when the character does.** No live character on the bound connection means stop, with
   a reason — the same signal WP10 already publishes.
4. **The speaker drives one selected window** (WP13 decisions 9 and 10). The user picks the window,
   the layer brings it to the foreground and binds the speaker to its connection. A key never reaches
   another window (WP13 decision 3).
5. **A line list, not one line.** Rotate through the lines the user entered; that is what the legacy
   rich text box was for, and one line repeated forever is the most obvious possible pattern.
6. **No chat opcode is decoded for this.** The speaker types; it does not need to read what it said.
   Reading chat is a separate feature and a much larger privacy surface.

## Non-goals (stop-lines)

- **No packet sending.** A chat packet would be WP18's business, and speaking is the case where
  typing is perfectly reliable — there is no reason to forge one.
- **No reading of chat, no logging of what other players say.** The speaker is a writer.
- **No triggers, no responses, no "reply when someone says X".** That is a bot, and it is a much
  bigger decision than this WP.
- **No whisper targeting from a friends list**, no channel management. A line of text goes where the
  user's own chat prefix sends it.
- **Never into a credential field** (WP13's rule, restated because this is the feature that types).

## Current state when you start

- WP13's `ActionLayer` is the whole dependency.
- [captureService.ts](../../src/main/captureService.ts) — `liveCharacters` gives "is there somebody
  to speak" per connection.
- [pages/Live.tsx](../../src/renderer/src/pages/Live.tsx) — where a speaker panel would sit, beside
  what capture is doing.
- `E:\Games\Dark Ages\Walker\DASpeaker.exe` — worth ten minutes with a disassembler only for the
  key sequence it posts to open the chat line and send it.

## Contracts

```ts
export interface SpeakerConfig {
  /** Lines to rotate through, in order. Empty means the speaker cannot start. */
  lines: string[]
  /** The floor between lines, in milliseconds. */
  intervalMs: number
  /** The connection, and so the character, this speaker is bound to. */
  connectionId: string
}
```

| Channel         | Shape                                            |
| --------------- | ------------------------------------------------ |
| `speaker:start` | `(config: SpeakerConfig) => Promise<void>`       |
| `speaker:stop`  | `(connectionId: string) => Promise<void>`        |
| `speaker:state` | event: `{ connectionId, running, lastSentAtMs }` |

Config is not persisted with the character record. It is a setting, and it lives with the settings.

## Acceptance criteria

1. Started with three lines and an interval, the client says them in order, spaced at least the
   interval apart, and not on an exact period.
2. The global stop halts it within one line.
3. Logging off, or the connection closing, stops it with a logged reason.
4. It refuses to start with no live character, and says why.
5. Two clients open: the speaker drives only the selected window, and the other client receives
   nothing.
6. Nothing is sent while stopped.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests against WP13's fake action layer: rotation, the interval floor, the stop, the refusal
   to start, and the two-connection case. **No game needed** — that is the point of the seam.
3. GUI (hand to Sabrael): three lines into a real client, watch them arrive, then hit the stop
   mid-run.
