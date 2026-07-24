# WP22 — Deposit Item, pursuit `0x43` decode

**Size:** S. **Depends on:** WP11. Read `00-overview.md` first. **PLANNED — blocked: no capture
sample yet.**
**Trigger to start:** a capture that contains a menu-type-5 click, or a reason to model what the
player put *in* the bank rather than what the bank holds.

## Goal

Decode Deposit Item, pursuit `0x43`, menu type 5 — the player-owned selection list. It is unmodelled
today because no capture contains a click on it, so there is nothing to verify a decoder against. It
is not needed to read bank contents (WP9 reads the withdraw list); it models the deposit side.

## The one way to get this wrong

**Writing a decoder with no capture to test it.** Menu type 5 is a different layout from the type-4
list WP9 reads. Do not infer the fields from the protocol docs alone and ship an unverified decoder.
The trigger for this WP is a real capture; without one, the WP stays blocked.

## Decisions

1. **Verify against a real click first.** Capture a deposit, confirm the pursuit id and the menu
   type, then write the decoder against the bytes.
2. **Read both protocol sources.** Menu type 5 has a page in each; neither is a superset. Where they
   disagree, the document repo wins.
3. **Model what the bank holds, not what the player owns**, unless the trigger is specifically the
   deposit side. WP9's read path is the priority; this is an addition, not a change to it.

## Non-goals (stop-lines)

- **No unverified decoder.** No capture, no decode.
- **No change to the withdraw read path** (WP9).

## Current state when you start

- `src/main/protocol/decode/dialog.ts` — `decodeBankContents` reads menu type 4; type 5 is not here.
- The document repo's `0x2F` page and `darkages-741-re`'s dialog pages — both describe menu type 5.

## Acceptance criteria

1. A captured deposit decodes to the expected fields.
2. The decoder accepts a body longer than the fields it reads (trailing bytes are not fields).
3. The withdraw read path is unchanged.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. A unit test against the captured deposit fixture.
