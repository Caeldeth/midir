# WP23 — the `0x39` response tail decode

**Size:** S. **Depends on:** WP11. Feeds WP17. Read `00-overview.md` first. **PLANNED.**
**Trigger to start:** a feature that needs the answer's argument, such as reading the quantity a
player typed. In practice, the Laborer (WP17).

## Goal

Decode the `0x39` response tail that WP11 keeps raw. The tail carries the player's answer to a dialog
step. WP11 left it raw on purpose: the tail has no type tag, so its shape is recoverable only from
the server's dialog state. Six forms are documented.

Note that `0x3A`'s argument **is** self-describing and is already decoded (WP11 decision 4). This WP
is only the `0x39` side.

## The one way to get this wrong

**Decoding the tail without the dialog state.** The tail is not self-describing. The same bytes mean
different things depending on which pursuit the server is running. Decode it against the pursuit id
the server last sent, not on its own.

## Decisions

1. **The pursuit id selects the form.** The decoder takes the server's current dialog state, then
   reads the tail as the form that pursuit expects. One of the six documented forms per pursuit.
2. **Read both protocol sources** for the six forms; neither is a superset.
3. **This feeds the Laborer.** WP17 is the caller that needs a typed argument (the quantity). Keep
   the decoded shape aligned with what WP17's step matcher consumes.

## Non-goals (stop-lines)

- **No guess without the pursuit id.** A tail read out of dialog context is not decoded.
- **No change to the `0x3A` path**, which is already correct.

## Current state when you start

- `src/main/protocol/decode/merchant.ts` — `0x39` decoded with the wrapper off; the tail is raw here.
- The document repo's `server/0x30-pursuit.md` and `0x39` page — the six forms and the dialog state.

## Acceptance criteria

1. A captured `0x39` response decodes to the argument the player entered, read against its pursuit.
2. A tail with no matching form is reported, not guessed.
3. The `0x3A` path is unchanged.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests against the recorded dialog exchanges from 2026-07-23, one per form that a fixture has.
