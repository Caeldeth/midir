# Midir backlog & deferral register

Everything known and not scheduled. Read `00-overview.md` first.

Each entry names **why it is not being built now** and **the trigger that would promote it**. An
entry with no trigger is a non-goal, and it is recorded here so it is not proposed again.

## Owed — specified by a shipped WP and not built

- **The packet inspector.** `session.ts` and `tracker.ts` both describe a UI that shows every packet,
  readable or not, and `PacketEvent.body` is kept for it. Nothing renders it. WP11 made the body
  correct for the wrapped opcodes, which is the last protocol work it needed.
  _Trigger:_ the next protocol question that a `console.log` in a scratch script cannot answer —
  or a bug report where the ring buffer alone is not enough.
- **e2e coverage of the capture surface.** `e2e/capture-surface.spec.js` exists and is thin. The
  views built after it (Items, Diagnostics, the bank card) have no e2e spec.
  _Trigger:_ a regression that unit tests and the replay both miss.

## Protocol — known and unread

- **Deposit Item, pursuit `0x43`.** Menu type 5 (a player-owned selection list) stays unmodelled: no
  capture contains a click on it, so there is nothing to verify a decoder against. Not needed to
  read bank contents. _Trigger:_ a capture that contains one, or a reason to model what the player
  put **in** rather than what the bank holds.
- **The `0x39` response tail.** WP11 keeps it raw on purpose — the tail carries no type tag, so its
  shape is recoverable only from the server's dialog state. Six forms are documented.
  _Trigger:_ a feature that needs an answer's argument, such as reading the quantity a player typed.
  Note that `0x3A`'s argument **is** self-describing and is already decoded.
- **`SPursuitMessage 0x30`.** Every NPC conversation that is not a menu. **Promoted 2026-07-23 —
  this is now WP17's first job**, because a dialog automation cannot act on a conversation it cannot
  read. The trigger that fired was the Clout Assistant, not a data source.
- **Multi-client decoding below the status line.** `captureService` already keys live characters by
  connection, so the decode path is ready. Only `CaptureStatus` narrows it to one name — that is
  WP12, and it is scheduled.

## The assistants — known and deferred

- **Reconstruct the walker's route graph from ceridwen.** WP15 ships on the hand-made
  `WorldMap.dat` imported from DA Walker. Ceridwen (`Repos/ceridwen/xml/maps/`) holds the same graph
  as authored XML — `<Warp>` edges with `<MapTarget>` destinations — plus NPC positions the `.dat`
  lacks, which WP17 would want for "walk to this NPC". Ceridwen's intent is a **1:1 capture of the
  retail world**, so it is the aligned source for a retail-only tool — **not** `Repos/world`, the
  divergent Hybrasyl production data. **Blocker:** ceridwen is **not built yet**; today's `xml/maps/`
  is partial. Even when complete, verify a derived graph against the positions WP14 reads on a live
  retail session before trusting it. _Trigger:_ ceridwen built out, or the hand-made graph going
  stale, or WP17 wanting NPC coordinates. See WP15.

## Data and durability

- **Nothing prunes a character record.** A character deleted on the server stays in the file
  forever. There is a delete handler; there is no policy. _Trigger:_ a real list long enough to be
  annoying, or a request for "hide characters not seen since".
- **The bank is the only opportunistic field.** If a second one ever appears, `mergeCharacter` needs
  to grow a rule rather than a second special case. Recorded because the special case is easy to
  copy and the general rule is not obvious. _Trigger:_ the second field.

## Reporting and release

- **The bug report to cernunnos.** The Diagnostics ring buffer was built to be attached to one.
  Deliberately deferred: it is a workflow, not a feature, and it wants the packet inspector more
  than it wants another button. _Trigger:_ the first bug a user cannot describe without one.
- **No release has been cut.** `package.json` is `0.1.0`, the changelog holds one `[Unreleased]`
  section, and `release.yml` came from the template unexercised. Windows-only, unsigned.
  _Trigger:_ handing Midir to somebody who is not Sabrael.

## Owed to another repo

- **The document repo's `0x2F` page** should gain the bank's reuse of the merchant row, the `u32`
  that is a count rather than a price, and the empty-bank silence.
- **The document repo's `0x39` page** should gain the request pursuit `0x45` → reply pursuit `0x56`
  pair, with the `0x40` → `0x4a` shop pair as the control that both constants are server-wide.
  Both are WP11's findings, verified against five requests across three bankers. They are not
  Midir's code and so are not a Midir WP, but they are owed and easy to lose.

## Non-goals (no trigger — these stay out)

- **Reading the client's memory.** DA Walker did; Midir does not and will not. The wire carries what
  the pointer table pointed at, and a pointer table is a debt against one build. See WP14.
- **Injecting a library, patching the client, or writing its memory or files.** Refused, not
  deferred, in every mode.
- **Sending a forged packet before WP18 lands**, and never for movement or chat. Settled decision 3:
  keys are the default, a packet is a per-feature exception, and the exception is gated on a
  spike that has not run.
- **Automating a credential dialog**, including the protected ID and password pursuit. Every
  assistant stops when it sees one.
- **Unattended or scheduled automation.** Every assistant runs because the user started it and can
  watch it. A scheduler is a different tool with a different risk, and it would need its own
  decision.
- **Hybrasyl support.** Retail is the target. Hybrasyl's server is a sibling project with its own
  tools; supporting both would make every protocol decision a compatibility argument.
- **Reading a credential, even one Midir could read.** `CLogin`'s password field is deliberately not
  decoded: a value that is never read cannot be logged, saved, or leaked.
- **An account-wide or shared library.** One person, one machine, one record file.
