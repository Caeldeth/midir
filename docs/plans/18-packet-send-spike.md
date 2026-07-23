# WP18 — the packet-send spike

**Size:** M (as a spike; the feature behind it is larger). **Depends on:** WP2, WP11. Read
`00-overview.md` first — settled decision 3 is why this WP exists. **PLANNED, and it gates every
forged packet in the app.**

## Goal

Answer one question with evidence rather than opinion: **can Midir send a protocol packet at an
acceptable cost, and what exactly does it cost?** Nothing in the app sends a packet until this
answers yes and the answer is accepted.

This is a spike. Its deliverable is a decision and a working proof, not a feature.

## Why it is not simply "write the encrypt path"

The cipher is its own inverse, so encrypting is not the hard part. **Delivering the bytes is.**

Midir cannot write into the client's own TCP socket. It has no handle on it, and forging segments
into an established connection means guessing sequence numbers and racing the client's own writes —
which corrupts the stream the moment both send at once. So a forged packet means one of:

- **A proxy.** The client connects to Midir; Midir connects to the server. Midir then owns both
  halves and can insert a packet. This is the only mechanism that is not a hack, and it costs:
  redirecting the client to a local address, a full encrypt path, the client-direction integrity
  bytes, the submission terminator, the `0x39`/`0x3A` dialog wrapper as a **writer** (random header,
  CRC16, incrementing XOR — WP11 has the reader), and a decision about the sequence counters, which
  the docs say "should advance in step" between the client's send counter and the server's receive
  counter. Inserting a packet moves one and not the other.
- **Nothing.** Keys are adequate, and this WP ends with the packet path refused and written down.

**It ends the "no proxy" rule if it succeeds**, and that rule is load-bearing for how the app
describes itself. That is why this is a spike with an explicit accept step, not a task.

## The one way to get this wrong

**Building the encrypt path first, because it is the tractable half.** The cipher will work, and
it will prove nothing: the risk is entirely in delivery, in sequence handling, and in whether the
client tolerates being redirected. Spike the delivery against a throwaway encrypt path, and only
then decide whether to build a real one.

Second: **treating a working proof as permission.** The proof answers "can we". Whether we do is a
separate decision, and it has to be taken with the risk in view.

## What the spike must produce

1. **A yes or no on the proxy**, with a working demonstration if yes: the retail client redirected
   to a local Midir port, the session established, and **one** injected packet accepted by the
   server, with the client unaffected afterwards.
2. **The sequence answer.** Whether the server rejects, tolerates, or ignores an out-of-step client
   sequence — measured, not reasoned. This is the single fact most likely to kill the approach.
3. **A cost estimate for the real thing**, in WPs, including what the proxy does to the capture
   layer (a proxy makes Npcap redundant for the proxied connection, and that is a large change to
   the app's spine, not a small one).
4. **A written recommendation**, in this file, with the decision recorded either way.

## Decisions taken in advance

1. **The spike is throwaway code and does not land on `main`.** A branch, a scratch script, and a
   written result.
2. **It runs against one connection, by hand, with a character that would not be missed** if the
   server dislikes it.
3. **No feature is written against it while it is open.** WP17 builds its key-driven version first
   and keeps its step interface backend-agnostic, so a second backend is additive.
4. **If the answer is no, that is a good outcome**, and the app keeps a charter rule it would
   otherwise have spent.
5. **The credential rule survives whatever happens.** A send path never touches a login, a password,
   or the protected pursuit pane.

## Non-goals (stop-lines)

- **No packet sending in any shipped feature** until this lands and the recommendation is accepted.
- **No injected DLL, no memory write, no client patch** — the spike does not get to relax settled
  decision 1 just because it is a spike.
- **No forged movement.** Even if the path works, walking stays keys: WP15 says why.
- **No "while we are in there" protocol writes** — no trading, no dropping, no equipment changes.

## Current state when you start

- [protocol/cipher.ts](../../src/main/protocol/cipher.ts) — decrypt only, and the comment at the top
  says why. The transform is its own inverse, so encryption is the same function with the pieces
  assembled the other way round.
- [protocol/dialogWrapper.ts](../../src/main/protocol/dialogWrapper.ts) — the reader; the writer is
  described in `darkages-741-re/docs/network/packet-transforms.md`, section "Dialog-response inner
  wrapper", and it is the construction, not the recovery, that this WP would need.
- `packet-transforms.md` also has the outgoing body layout: opcode, sequence, payload, four MD5
  digest bytes (13, 3, 11, 7), three encoded seed bytes — and the submission terminator `0x00` that
  the builders do not write but the transform sees.
- `Repos/samhail` (private) is a text client **and proxy** for legacy Dark Ages. If a proxy is the
  answer, that is the prior art in the house, and it should be read before anything is written.
- [capture/source.ts](../../src/main/capture/source.ts) — `PacketSource` is the seam a proxy would
  eventually become another implementation of. Worth thinking about early; it is the one part of
  this that might make the app simpler rather than more complex.

## Acceptance criteria

This WP is done when the file below is filled in and the recommendation is accepted or refused.

```text
## Result (fill in)

Proxy viable:        yes / no
Sequence handling:   rejected / tolerated / ignored
Client tolerates redirect: yes / no
Cost of the real path:     __ WPs, touching: ______
Recommendation:      build / refuse
Decided by Sabrael on: ____
```

## Verification

A spike is verified by its own demonstration, not by the suite. Nothing it produces is committed to
`main`, so the gate is unaffected. **The result section above is the deliverable.**
