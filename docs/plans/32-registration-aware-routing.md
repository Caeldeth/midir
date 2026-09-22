# WP32 — registration-aware routing

**Size:** M. **Depends on:** WP15 (the walker and the graph) and WP4/WP5 (the character record and
its legend). Read `00-overview.md` first. **PLANNED.** **Card:** `HTOO-81`.
**Trigger to start:** the walker is used with unregistered characters, or a route through a Commons
is wanted for one. **Fired 2026-09-21**: Gabrael, unregistered, walked to the Mileth Commons gate
and was refused, twice (10:15Z and 10:17Z, in the recording). Registered afterwards, he entered.

## Goal

Do not route an unregistered character through a map it cannot enter. Some maps — Rucesion Commons
and Mileth Commons among them — bar an unregistered character, so a walker that routes through one
grinds to a `blocked` at the entrance. The walker should know the character's registration from the
wire, plan around a gated map, and say plainly when a place needs a registered character.

## The one way to get this wrong

**Reading absence as proof.** Registration is not a field on the wire. A registered character gets a
login system message — "Your expiration date is …" — and an unregistered one gets nothing. Silence
is not a signal, exactly as an empty bank is not (WP9, WP11): a missed login, a late capture start,
or a dropped packet all look like "no message". So Midir must read **positive signals only**, and
default to "registered" when it has none — the safe default, because a wrong "registered" only makes
the walker try and route around the gate, while a wrong "unregistered" refuses a route the character
could walk.

## The signals

Two positive signals, from opposite ends:

1. **The legend mark (unregistered).** An unregistered character carries a legend mark that reads
   "Fragile Chrysalis ((Unregistered))". Midir already decodes the legend (`CharacterRecord.legend`),
   so this is available now with no new decode. Its **presence** means unregistered. It is only
   "sometimes" there, so its absence proves nothing.
2. **The login message (registered).** `SSystemMessage 0x0A` type 3 carries "Your expiration date
   is 8-22" at login for a registered character (recording of 2026-07-24 10:14Z; the date is
   month-day with no padding). Its **presence** means registered. `0x0A` is decoded since WP17 PR3
   (`decode/message.ts`), and `captureService.noticeFor` holds the newest one; this WP reads it.
   Sabrael, 2026-09-21: an unregistered account never gets this line.
3. **The refusal (unregistered).** An unregistered character that asks a bank NPC for Labor, or a
   civic NPC for a civic action, gets the notice "(( Register first: www.darkages.com -> Click
   'Register' ))" and a dialog close (Sabrael's capture of 2026-09-21). Its **presence** means
   unregistered, and it arrives in the middle of play, not only at login. The civic menu shows the
   same thing one step earlier: an unregistered character's "What is your civil action?" offers
   only "Renounce Citizenship", with no "Support a Citizen" (Gabrael at Riona, the same night).
4. **The gate's own refusal (unregistered).** The Commons gate refuses with a **pair** of type-3
   notices: "Only a Mileth citizen may enter here", then two seconds later "((Register at
   www.DarkAges.com for full benefits))" (Gabrael, a Mileth citizen and unregistered, 2026-09-21
   10:15Z and 10:17Z; the same pair both times). The second line is the registration tell, in a
   different wording from signal 3, so both texts are matched. The first line alone is a different
   refusal: a registered character who is not a citizen of that town gets it with no register hint
   ("Only a Rucesion citizen may enter here" on its own, 2026-07-23 and 2026-09-21 10:00Z).

**The gate is on citizenship as well as registration.** The Commons admits a registered citizen of
its own town, and no one else; the two lines above say which condition failed. So the overlay
(decision 3) needs the town beside the map id, and the planner needs the character's citizenship
beside its registration. Citizenship is on the record already, from the legend ("Citizen of
Mileth" is a legend mark) — confirm the exact mark text against a live character, as for the
unregistered mark — and a route for a non-citizen avoids the other towns' Commons the same way an
unregistered one avoids them all.

The rule: an unregistered legend mark or either refusal (signal 3 or the second line of signal 4)
makes the character unregistered; else a seen expiration message makes it registered; else
registered by default. Citizenship is read from the legend, and unknown citizenship gates nothing.

## Decisions

1. **Decode `SSystemMessage 0x0A`.** Done in WP17 PR3: `decode/message.ts`, body `[u8 type]` and
   `[string16 text]`, with the type-0x11 confirmation prompt's three reply values; the type table is
   darkages-741-re's. The decoder is generally useful (it feeds the Laborer's refusal reading now,
   and a chat view or the packet inspector, WP20, later), so it is not registration-only.
2. **Registration is a positive fact on the record.** Add `registered?: boolean` to
   `CharacterRecord`, set `false` when the unregistered legend mark is seen and `true` when the
   expiration message is seen. `undefined` means unknown, which the planner treats as registered.
   Name the field in `characterSchema`, or it is dropped on load (WP11's rule).
3. **Gated maps are a small overlay, seeded and learned** (the chosen source). A hand-kept
   `route/access.json` lists the gated map ids with the town each admits, seeded with the known
   ones (Rucesion Commons `3048`, Mileth Commons `3025`, and any others). It is separate from the
   generated `worldmap.json`, so a re-import never clobbers it. The wire refines it: a stall at a
   warp into a map beside the gate's own notice (signal 4, either line) learns the map as gated,
   with the town from the notice's text — a WP29-style learned fact, with the same provenance and
   observation-count honesty. The notice is the proof; a stall alone is a creature or a wall.
4. **The planner is registration-aware.** `planRoute(from, to, { registered })` excludes edges into a
   gated map when `registered` is false. A destination reachable only through a gate returns null,
   which the walker reports as `noRoute`.
5. **The walker says why.** An unregistered character sent to a gated place stops with `noRoute` and
   a message that names the cause — "that place needs a registered character" — not the bare "no
   route". The destination picker may also mark or hide gated places for an unregistered character.

## Non-goals (stop-lines)

- **No guessing registration from class or nation.** Those are not the signal; the legend mark and
  the login message are.
- **No reading a credential or an account state beyond registration.** The expiration message is read
  for its presence, not to store a date or any account detail.
- **No forcing a gated warp.** The walker plans around a gate; it never tries to push through one.
- **No hand-authoring every gated map.** The seed is the known few; the wire learns the rest.

## Current state when you start

- [protocol/decode/character.ts:257](../../src/main/protocol/decode/character.ts#L257) — the legend
  is decoded, with each mark's `text`, ready to scan for the unregistered mark.
- [protocol/decode/message.ts](../../src/main/protocol/decode/message.ts) — `0x0A` decoded;
  [model/notice.ts](../../src/main/model/notice.ts) keeps the newest notice per connection.
- [route/graph.ts](../../src/main/route/graph.ts) — `planRoute` gains the registration option and the
  gated-map exclusion.
- [walker.ts](../../src/main/walker.ts) — reads the bound character's registration and passes it to
  the plan; maps `noRoute` to the clearer message.
- [captureService.ts](../../src/main/captureService.ts) — where the per-connection character and its
  registration are read, beside the position.
- The document repo's `server/0x0A-system-message.md` and `darkages-741-re`'s
  `server/010-0x0a-message.md` — the wire format for the decoder.

## Contracts

```ts
/** SSystemMessage 0x0A — a general server message. */
export interface SystemMessage {
  kind: 'systemMessage'
  /** The display type: 0x01 overhead, 0x03 system, 0x07 settings, 0x11 whisper. */
  messageType: number
  text: string
}

/** The registration-gated maps, seeded and then learned. */
export interface AccessOverlay {
  /** Map ids an unregistered character cannot enter. */
  registeredOnlyMaps: number[]
}
```

## Acceptance criteria

1. An unregistered character (the legend mark present) sent to a place behind a gated map stops with
   `noRoute` and a message that names registration as the cause, before it moves.
2. A registered character (the expiration message seen) walks the same route normally.
3. A character with no signal is treated as registered.
4. The gated-map overlay survives a re-import of `WorldMap.dat`.
5. A learned gate needs an unregistered character to have hit it, and a creature-block is not
   mistaken for a gate.
6. `0x0A` decodes to the right type and text against wire bytes (done in WP17 PR3).

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the `0x0A` decode; the registration reducer over a legend with and without the mark
   and over an expiration message; the planner's gated-map exclusion for a registered and an
   unregistered character.
3. GUI (hand to Sabrael): an unregistered character asked for Rucesion Town Hall (behind Commons)
   gets the clear refusal; a registered one walks it.

## Needed input

- The **map ids** to seed the overlay: Rucesion Commons `3048` and Mileth Commons `3025` are known;
  add any others as they are found.
- The **exact unregistered legend mark** text or key to match, confirmed against a live unregistered
  character.
