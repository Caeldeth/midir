# WP6 — the cross-character item index, and the credential scrub

**Size:** M. **Depends on:** WP5. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `6ff6e56`
(PR #1).

> Retrospective. Written after the fact from the commit; it records what shipped and why.

## What shipped

The reason the app exists: "who has one of these?"

- **`shared/items.ts`** — `buildItemIndex(records)`, pure and Electron-free: every item across every
  character, one row per item, each holder named once whatever the number of slots, with a total.
- **`pages/Items.tsx`** — the searchable view over it.
- **`components/ItemTooltip.tsx`** — per holder: the slot, the durability, and how long ago that
  character was read.
- **`components/Guidance.tsx`** — the "start Midir before you log in" card, which is a UI state and
  not an error.
- **`capture/scrub.ts`** — the credential scrub, which shipped in the same PR because a recording
  had just become something a user might send to somebody.

## Decisions that are load-bearing

1. **The index is a pure function of the records.** No cache, no second store, no incremental
   update. It is rebuilt from what is already in memory, which makes it trivially correct and
   trivially testable.
2. **A holder is named once, however many slots they use.** The question is "who has one", not "how
   many stacks does the list have".
3. **Freshness is per holding, and the row is as fresh as its freshest holding.** A bank read weeks
   ago must not make a character look stale, and an inventory read today must not make the bank
   look fresh.
4. **The scrub drops whole frames, and needs no key.** The frame header states the length and the
   cipher leaves the opcode in the clear, so a secret-bearing frame is found and removed without
   decrypting anything — and Midir has no encrypt path to put one back with.
5. **`SECRET_BEARING_CLIENT_OPCODES` is a set to add to, never a special case to write.** Five
   opcodes, from both protocol sources; three of them have no recovered wire format and are dropped
   anyway, because removing a packet that might hold a credential costs a recording nothing.
6. **Two limits are stated, not fixed.** The scrub stops recording a connection's client direction
   after a TCP gap, because a walk that has lost its place cannot resynchronise safely. And the
   capture filter is bare `tcp`, so a recording is not only the game protocol — one dialog type is
   documented to send an id and password in a plaintext HTTP URL from the same process, and the
   frame walk does not touch HTTP.

## What it deliberately did not do

- No icons. `ItemIndexEntry.sprite` is carried and unused — that is WP7.
- No filters beyond the name search: no class, no slot, no "equipped only".
- No blanking of a password field inside a frame. That would need the connection's startup key and
  a re-encrypt step, and dropping the frame is exact.

## Where it lives

`src/shared/items.ts`, `src/renderer/src/pages/Items.tsx`, `components/ItemTooltip.tsx`,
`components/Guidance.tsx`, `src/main/capture/scrub.ts`.

## How it is verified

`shared/__tests__/items.test.ts` covers the index from record literals, including the bank's
different freshness. `capture/__tests__/scrub.test.ts` walks synthetic streams, including the two
ways the gap rule used to leak.
