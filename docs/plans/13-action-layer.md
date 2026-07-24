# WP13 — the action layer, and the stop

**Size:** M. **Depends on:** WP3 (the capture layer already resolves the game's process id). Read
`00-overview.md` first — settled decisions 1 to 4 are this WP's whole brief. **PLANNED.**

## Goal

One place that can press a key in the game window, and one stop that always works. Every assistant
is a caller; none of them touches the operating system itself.

## The one way to get this wrong

**A stop that only works while the app is responsive is not a stop.** The failure that matters is a
walker looping into a wall, or a speaker repeating into a full channel, while the user is fighting
for focus. The stop must be a registered global hotkey that halts every driver _and_ a state the
drivers poll, so a driver mid-step ends at its next step rather than at the end of its route. It
must also fire on its own when the game window disappears, when the connection the driver is bound
to closes, and when the game window loses focus, if the user asked for that.

Nothing else in this WP matters as much. Build the stop first and make a driver prove it.

## Decisions

1. **The action layer is main-process only.** It is I/O to another process, so it lives beside the
   capture layer, and the renderer asks for it over IPC like everything else.
2. **`PostMessage` to the game window, not `SendInput`.** `SendInput` drives whatever has focus, so
   a mistimed key lands in the user's browser. `PostMessage` addresses one window and needs no
   focus, which is what makes an assistant usable while the user does something else. It is what
   both legacy tools do.
3. **A window is bound to a connection, not to "the game".** The capture layer already knows the
   game's process ids and their TCP connections; a driver is started against a live character, and
   that character belongs to a connection (WP10). Resolve the window from the same process id. This
   is the piece neither legacy tool has, and it is what makes a driver address the right window when
   two clients are open (WP12).
4. **Every action is a request that can be refused.** The layer checks that the window still exists,
   still belongs to the expected process, and that no stop is in force. A refused action returns a
   reason; it never throws into a driver's loop.
5. **Rate-limit at this layer, not in the drivers.** One place to reason about how fast Midir can
   press a key, and one place to change it. A driver asks for a keystroke; the layer decides when.
6. **Human-shaped timing is a policy of this layer, not a driver's clever idea.** Jitter, and no
   two identical intervals in a row.
7. **No native code.** `PostMessage` and `FindWindow`-class calls go through the existing `da-pcap`
   addon or a small sibling addon; do not add a second native build system.
8. **The layer logs what it did.** Every keystroke posted, at debug level, through `main/log.ts`.
   When an assistant does something surprising, the log is the only record — there are no packets to
   read back, because Midir did not send any.
9. **A driving assistant targets one selected window at a time.** The user picks one window from the
   list of open game windows, the layer brings it to the foreground once on start so the user sees
   the target, and the driver binds to that one window's connection for the run. There is no
   "drive all" and no fan-out across windows. This is a policy limit on the driving path only; the
   read path still decodes every client (WP12). The layer exposes the window picker over the open
   game windows.
10. **Foreground on start, `PostMessage` throughout.** The layer brings the chosen window forward
    once for visibility, but every key still goes through `PostMessage` (decision 2), not through the
    focused window. So a key lands in the bound window even if the user moves focus mid-run, and a
    stray key never reaches the user's browser. The layer does not require the window to stay
    focused.

## Non-goals (stop-lines)

- **No packet sending.** That is WP18, and it is gated.
- **No memory reads, no injection, no patching.** Settled decisions 1 and 4.
- **No screen scraping, no pixel reading, no OCR.** State comes from the wire. If a driver wants to
  know something, the answer is a decoder, not a screenshot.
- **No mouse movement across the desktop.** Posted clicks are addressed to the window.
- **No recording or replay of user input.** This is not a macro recorder.
- **Never a credential field.** The layer refuses to type into the client while a password or
  account dialog is up, and the drivers never ask.

## Current state when you start

- [packages/da-pcap/index.d.ts](../../packages/da-pcap/index.d.ts) — `processIdsByName(name)` and
  `tcpConnectionsForPid(pid)` already exist and are how the window is found.
- [pcapSource.ts:175](../../src/main/capture/pcapSource.ts#L175) — the service already maps process
  ids to the connections it follows.
- [captureService.ts](../../src/main/captureService.ts) — `liveCharacters` is keyed by connection
  id, so "the character this driver is for" already has an identity.
- [main/log.ts](../../src/main/log.ts) — the logger to pass in; do not import a singleton.
- `E:\Games\Dark Ages\Walker\DAWalker.exe` — `DAMacKeyOps`, `extKeys`, `GetKeyboardState`,
  `AddHotkey`, `currHotKeyAtom` are the legacy equivalents, and worth reading for which virtual-key
  codes the client actually accepts.

## Contracts

```ts
/** Why an action did not happen. Never thrown — returned. */
export type ActionRefusal = 'stopped' | 'noWindow' | 'wrongProcess' | 'rateLimited' | 'blocked'

export interface ActionTarget {
  /** The connection this driver is bound to, and so the character. */
  connectionId: string
  /** The game window, resolved from the connection's process id. */
  windowHandle: number
}

export interface ActionLayer {
  resolveTarget(connectionId: string): ActionTarget | null
  pressKey(target: ActionTarget, key: VirtualKey): Promise<ActionRefusal | null>
  click(target: ActionTarget, x: number, y: number): Promise<ActionRefusal | null>
  /** True while any stop is in force. Drivers poll this between steps. */
  readonly stopped: boolean
  /** Halt everything now. Idempotent, and safe from any thread. */
  stopAll(reason: string): void
}
```

| Channel          | Shape                                          |
| ---------------- | ---------------------------------------------- |
| `assist:stopAll` | `() => Promise<void>`                          |
| `assist:state`   | event: `{ stopped: boolean, reason?: string }` |

## Acceptance criteria

1. A key posted to a resolved target arrives in the game client and nowhere else — typing into
   another window while an assistant runs is unaffected.
2. The global stop hotkey halts a running driver within one step, from any window.
3. Closing the game, or the connection ending, stops every driver bound to it, with a logged reason.
4. Two clients open: a driver bound to one never posts to the other's window.
5. Every action while stopped returns `'stopped'` and does nothing.
6. The rate limit holds under a driver that asks as fast as it can.
7. Nothing in this WP reads memory, sends a packet, or loads anything into the game process.
8. Starting a driver needs one selected open game window; the layer brings it to the foreground and
   binds to its connection. No window selected means no driver starts.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests against a fake window API: refusals, the rate limit, the stop, target resolution, and
   the two-client case. The layer is an interface with one real implementation, so the drivers can
   be tested with no game at all — the same seam `PacketSource` gives the decode side.
3. GUI (hand to Sabrael, and the only check that proves it): the game open, a scripted ten
   keystrokes, then the stop hotkey mid-run. Confirm the keys land in the client, the stop is
   immediate, and nothing reached any other window.
