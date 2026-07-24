# Midir backlog & deferral register

Read `00-overview.md` first. This register now holds only what is **not** a WP: the non-goals, the
debts owed to another repo, and the one conditional rule.

**Slotted work now lives in the WP table.** Everything that used to sit here as "owed but not built"
is a numbered, trigger-gated WP (WP20–WP28), with its promotion trigger in its own doc header. See
the "Triggered follow-ons" table in `00-overview.md`. The multi-client decode is WP12,
`SPursuitMessage 0x30` is WP17's first job, and the item-list virtualization is part of WP19.

## Conditional rules — a guard, not schedulable work

- **The bank is the only opportunistic field.** If a second one ever appears, `mergeCharacter` needs
  to grow a rule rather than a second special case. Recorded because the special case is easy to
  copy and the general rule is not obvious. This fires on a condition, so it is a guard, not a WP.
  _Trigger:_ the second opportunistic field.

## Owed to another repo — not Midir code, so not a Midir WP

- **The document repo's `0x2F` page** should gain the bank's reuse of the merchant row, the `u32`
  that is a count rather than a price, and the empty-bank silence.
- **The document repo's `0x39` page** should gain the request pursuit `0x45` → reply pursuit `0x56`
  pair, with the `0x40` → `0x4a` shop pair as the control that both constants are server-wide.
  Both are WP11's findings, verified against five requests across three bankers. They are not
  Midir's code and so are not a Midir WP, but they are owed and easy to lose. Track them as
  document-repo tickets.

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
