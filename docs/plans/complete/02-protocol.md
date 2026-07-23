# WP2 — the retail protocol layer

**Size:** L. **Depends on:** WP1. Read `00-overview.md` first. **COMPLETE 2026-07-23** — `925b789`,
with the cipher-state corrections in `c2f6503` and `86bff7d`.

> Retrospective. Written after the fact from the commits; it records what shipped and why.

## What shipped

The whole decode path, pure and testable with no capture in sight: the three-mode cipher, the
binary frame reader, the per-direction opcode transform tables, a cursor over a packet body, the
per-opcode decoders, and the per-connection session that joins them.

- **`cipher.ts`** — the startup key (`UrkcnItnI` with bytes 3 and 7 replaced), the ten salt tables
  built from their formulas, the MD5 expansion of the character name, the per-packet key selection,
  and the XOR transform. Decryption is **stateless per packet**.
- **`frame.ts`** — `[0xAA][u16 length][body]`, resynchronising on a bad marker and counting what it
  dropped. It cannot detect a hole inside a frame; the capture layer must `reset()` on one.
- **`opcodes.ts`** — none / startup / session, **per direction**, from both protocol sources.
- **`session.ts`** — one connection's cipher state, one frame reader per direction, and the
  `SessionEvent` union: a decoded packet, or an unreadable one with a reason.
- **`decode/`** — handshake (`0x00`, `0x03`), character (`0x05`, `0x08`, `0x33`, `0x39`), items
  (`0x0F`, `0x10`, `0x37`, `0x38`), client (`0x03`, `0x10`).

## Decisions that are load-bearing

1. **The layer is pure TypeScript with no Electron import**, so the vitest node project covers all
   of it and a decoder can be exercised from a hex literal.
2. **`SStatus 0x08` is flag-gated and must merge.** The byte after the opcode selects which blocks
   follow. A partial update that replaced the record would wipe the inventory on every health tick.
3. **Trailing bytes are not fields.** The retail parsers stop at the last field they read, so every
   decoder accepts a body longer than what it consumes.
4. **The two directions never share a sequence counter or a transform table.**
5. **A decoder returns `null` for an opcode it models but a variant it does not read**, and throws
   only when the body did not match. The session turns those into `notModelled` and `decodeFailed`,
   which are different facts.
6. **The character name is the session key.** Two sources: `CLogin 0x03` (what the client itself
   feeds its key setup) and the `CTransferServer 0x10` token (raw, and present on all three
   connections). The token's layout came from a **loopback capture**, so it is the fallback and
   `looksLikeCharacterName` guards it — a wrong name does not fail loudly, it silently decrypts
   everything after it into rubbish.

## What it deliberately did not do

- No encrypt path, ever. Midir has nothing to send.
- No verification of the client direction's four integrity bytes. They are selected MD5 digest
  bytes, and the client's own receive path does not check them either.
- The greeting `0x7E` is reported unreadable rather than decrypted: the client consumes it with its
  terminal handler before frame parsing starts.

## Where it lives

`src/main/protocol/` — `cipher.ts`, `frame.ts`, `opcodes.ts`, `reader.ts`, `session.ts`, `types.ts`,
`decode/`. Tests in `protocol/__tests__/`, including the Hybrasyl salt-table fixture (evidence, and
named for where it came from).

## How it is verified

The node vitest project covers the layer end to end: salt tables against the fixture, the transform
against its own inverse, framing against split and joined chunks, and each decoder against bodies
built by the test helpers.
