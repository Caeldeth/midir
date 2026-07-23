# WP9 — the bank, out of the NPC dialog

**Size:** M. **Depends on:** WP4, WP6. Read `00-overview.md` first. **COMPLETE 2026-07-23** —
`7dd59d5` (PR #4).

> Retrospective. Written after the fact from the commit; it records what shipped and why.

## What shipped

Banked items in the record and in the item index, read out of an NPC conversation.

- **`protocol/decode/dialog.ts`** — `decodeBankContents`, which reads `SScreenMenu 0x2F` when it is
  the bank and returns `null` for every other dialog.
- **`shared/character.ts`** — `BankSnapshot` on the record: when it was read, the banker, the rows.
- **`shared/items.ts`** — bank holdings in the index, with `banked` on the holder and the bank's own
  read time carried per holding.
- **`CharacterSheet.tsx`** and **`ItemTooltip.tsx`** — the bank card, and "bank read <ago>".

## The protocol facts, and where they came from

**The retail protocol has no bank opcode.** Bank contents arrive as NPC dialog: `SScreenMenu 0x2F`,
menu type 4, **pursuit `0x56`**. Four live captures settle that the pursuit is a server-wide
constant and not a per-NPC dialog id:

| Character | Banker           | Pursuit | Rows | Values |
| --------- | ---------------- | ------- | ---: | ------ |
| Taurael   | Antonio `0x1f6f` | `0x56`  |   21 | 1–4    |
| Angelique | Drave `0x2ab5`   | `0x56`  |   53 | 1–10   |
| Arachne   | Cassidy `0x1ba9` | `0x56`  |   45 | 1–2    |
| Paelrohm  | Antonio `0x1f6f` | `0x4a`  |    1 | 8300   |

The last row is the control: it is a **shop buy list from the same NPC as the first row's bank**, so
the pursuit cannot belong to the NPC. Each of the three banks consumed its body to exactly zero
trailing bytes.

**The row's `u32` is a count, not a price.** Both protocol sources call it a price. In a bank it is
the quantity held — ordinary items at 1 to 10 against a single "Mystic Gown" at 8300 in the buy list
from the same NPC. Same offset, different meaning per dialog, so the decoder names it for the only
dialog it reads.

## Decisions that are load-bearing

1. **The whole list replaces the stored one; it never merges.** The bank arrives complete, and there
   is no per-item update that could correct a stale row a merge would keep.
2. **Bank data is opportunistic.** It updates only when the player opens the bank, so every surface
   shows the "as of" time.
3. **An empty bank sends no reply at all**, so silence is identical to never having opened one, to a
   missed packet, and to capture starting late. **Nothing may render a bank as empty.** It is read
   or not read. (WP11 later found the evidence that makes "empty" sayable — the player's own
   request — and this rule became conditional rather than absolute.)
4. **Returning `null` rather than throwing is the normal case.** Every NPC conversation in the game
   uses this opcode; a dialog that is not the bank is not a failure.

## What it deliberately did not do

- No modelling of the deposit side, no menu type 5, no shop inventory. Reading what the bank holds
  is the goal.
- No attempt to ask for a bank. Midir does not send.

## Where it lives

`src/main/protocol/decode/dialog.ts`, `src/shared/character.ts`, `src/shared/items.ts`,
`src/renderer/src/components/CharacterSheet.tsx`, `ItemTooltip.tsx`.

## How it is verified

`protocol/__tests__/dialog.test.ts` decodes a bank body and rejects a non-bank dialog of the same
opcode; the model and the renderer tests cover the snapshot and the "never say empty" rule.
