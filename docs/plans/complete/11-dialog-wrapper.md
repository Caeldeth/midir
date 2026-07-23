# WP11 — the dialog wrapper, and the empty bank

**Size:** M. **Depends on:** WP9, WP10. Read `00-overview.md` first. **COMPLETE 2026-07-23** —
`26e0fad`, branch `feat/dialog-wrapper-empty-bank`.

> Retrospective, written the same day as the work. It started as a question, not a WP: client
> `0x39` and `0x3A` decrypted to bodies matching no known layout, and the worry was a decrypt bug
> quietly damaging other client packets.

## What shipped

**It is not a decrypt bug.** Both opcodes carry a second layer under the transform, and Midir's
cipher stopped one level short.

- **`protocol/crc16.ts`** — the client's custom CRC16. Table from polynomial `0x1021`, running value
  from zero, **the input byte XORed after the lookup**. It is _not_ CRC-16/XMODEM; `123456789` must
  give `0xBEEF`.
- **`protocol/dialogWrapper.ts`** — `unwrapDialogResponse`, reversing the random header, the encoded
  length, the incrementing XOR, and checking the CRC.
- **`protocol/opcodes.ts`** — `DIALOG_WRAPPED_CLIENT_OPCODES`, a transport rule beside the transform
  tables.
- **`protocol/decode/merchant.ts`** — `CMerchant 0x39` and `CPursuit 0x3A`.
- **`model/character.ts`** — the pending bank request, its wait, and the empty result.
- **`store/characterStore.ts`** — `mergeCharacter`, and the `bank` field the schema never named.
- **`capture/tracker.ts`** — `TrackedEvent.timestampMs`, so the record runs on capture time.

## The wrapper

Only client `0x39` (CMerchant) and `0x3A` (CPursuit) enter this branch. On a builder body of `N`
bytes whose payload is the `N - 1` bytes after the opcode:

```text
[u8 opcode][u8 random1][u8 encodedRandom2][u8 lenHigh][u8 lenLow][encrypted inner][u8 0]

random2     = encodedRandom2 XOR ((random1 + 0xD3) & 0xFF)
innerLength = (lenHigh XOR ((random2 + 0x72) & 0xFF)) << 8 | (lenLow XOR ((random2 + 0x73) & 0xFF))
plain inner = [u16 BE crc16(payload)][payload]          // innerLength == N + 1
key         = (random2 + 0x28) & 0xFF, + 1 per byte, XORed over the inner bytes
```

Every input is in the packet, so the unwrap needs no key and no state. **The CRC is the proof the
outer key was right.** Across the seven session recordings, **102 of 105** wrapped client packets
unwrap with a matching CRC; the three failures are all on one connection that opened before capture
started, where plain `0x43` decrypts to rubbish as well. That closes the original worry: where the
wrapper fails, the plain opcodes fail with it.

## The bank request

Unwrapping showed the request. `CMerchant 0x39` **pursuit `0x45`** is "withdraw item"; the reply is
the `SScreenMenu 0x2F` menu type 4 pursuit `0x56` that WP9 already read.

| Character | Banker           | Request | Reply                               | Latency |
| --------- | ---------------- | ------- | ----------------------------------- | ------: |
| Taurael   | Antonio `0x1f6f` | `0x45`  | type 4 pursuit `0x56`, 21 rows      |  253 ms |
| Angelique | Drave `0x2ab5`   | `0x45`  | type 4 pursuit `0x56`, 53 rows      |  214 ms |
| Arachne   | Cassidy `0x1ba9` | `0x45`  | type 4 pursuit `0x56`, 45 rows      |  208 ms |
| Paelrohm  | Antonio `0x1f6f` | `0x45`  | type 4 pursuit `0x56`, 49 rows      |  119 ms |
| Paelrohm  | Antonio `0x1f6f` | `0x40`  | type 4 pursuit `0x4a`, 1 row (shop) |       — |
| Gabrael   | Antonio `0x1f6f` | `0x45`  | **nothing**                         |       — |

The `0x40` → `0x4a` row is the control that both constants are server-wide. Gabrael is the empty
bank: the next server packet was a heartbeat at 1.7 s, then an unrelated `0x2F` **type 0** at 3.2 s
when the player clicked the NPC again. No list ever came.

## Decisions that are load-bearing

1. **The unwrap belongs in the session layer**, so `PacketEvent.body` is the true plaintext body for
   these opcodes — which is what the packet inspector will want.
2. **A failed unwrap is reported as `decryptFailed`, with no new reason code.** The three real
   failures in the capture _are_ key failures, and a separate reason would suggest otherwise.
3. **`0x39`'s tail is kept raw; `0x3A`'s argument is decoded.** `0x3A` writes a type tag, so it is
   self-describing. `0x39` does not: its form is recoverable only from the server's dialog state, so
   a decoder that guessed would read a slot number as a string length sooner or later.
4. **Typed dialog text is decoded** (Sabrael's call) — it is wanted for later features. Nothing logs
   it; it lives in the decoded packet only.
5. **"Empty" needs three things: the request, the wait, and no packet loss.** `BANK_REPLY_WINDOW_MS`
   is 2000 — about ten times the observed reply time, and well clear of the 3.2 s counter-example,
   which is a different menu type anyway. A lost packet cancels the wait rather than answering it,
   because a missed list and an empty bank look identical.
6. **The reading is stamped with the time of the request**, not the time the wait ran out. That is
   the moment the player looked.
7. **Time settles a request, not any one packet** — including a packet Midir does not model, which
   is most of what the world server sends. `notModelled` is therefore **not** treated as a loss: the
   opcode is in the clear, so that packet is known not to be the list. Counting it would cancel
   every wait.
8. **A close settles nothing.** It carries no time of its own, so a request that was the last packet
   on its connection stays unread. Nothing on the wire says how long the player waited.

## Three data-loss bugs found on the way

All three cost bank readings, and all three predate this WP:

1. **`characterSchema` did not name `bank`**, and Zod drops what it does not name — so every reading
   was lost at the next start. The user's live file held 22 characters and zero banks.
2. **A later login replaced the stored record whole**, wiping a bank it knew nothing about; the
   write queue coalesced by name and did the same. Both now go through `mergeCharacter`.
3. **The record ran on the wall clock**, so a replay collapsed a whole evening into one second — and
   a feature that measures elapsed time cannot be verified from a recording. `TrackedEvent` now
   carries capture time.

## What it deliberately did not do

- No parsing of `0x39`'s six tail forms, and no menu type 5 (Deposit Item, pursuit `0x43`). Both are
  in `00a-backlog.md`.
- No change to the scrub set. `0x39` and `0x3A` carry text the player typed, and a recording already
  held those bytes; this WP changed only what Midir reads out of them.

## Where it lives

`src/main/protocol/crc16.ts`, `dialogWrapper.ts`, `opcodes.ts`, `session.ts`, `decode/merchant.ts`,
`decode/dialog.ts`; `src/main/model/character.ts`; `src/main/captureService.ts`;
`src/main/capture/tracker.ts`; `src/main/store/characterStore.ts`; `src/shared/character.ts`;
`src/renderer/src/components/CharacterSheet.tsx`.

## How it is verified

The gate, plus: the CRC check value; the wrapper against **real outer-decrypted bodies lifted from
the recordings** (neither fixture carries anything a player typed); the session layer turning a
wrapped frame into a packet and a wrong key into `decryptFailed`; the model's four wait outcomes;
and a replay of the real recordings through `replaySource` + `captureService`, which reproduces
Taurael 21, Angelique 53, Arachne 45, Paelrohm 49, and **Gabrael empty**.
