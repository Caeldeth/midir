# WP32 — registration-aware routing

**Size:** M. **Depends on:** WP15 (the walker and the graph) and WP4/WP5 (the character record and
its legend). Read `00-overview.md` first. **IN PROGRESS.** **Card:** `HTOO-81`.

**Built 2026-09-21; the live check is what is left.** The walker plans around the gates its
character cannot pass (`planAround` in `walker.ts`), stops before it moves with the gate named when
the only way is through one (`gated`), and learns a gate from the gate's own refusal mid-walk. The
record carries `registered` from the wire's positive signals, and citizenship is the `nation` byte
already on it. The facts are in `model/access.ts`; the gates and the passport are `route/access.ts`
and `route/access.json`.
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

**The gate is on citizenship as well as registration.** Sabrael, 2026-09-21: the Mileth Commons
admits a registered citizen of Mileth or Loures, the Rucesion Commons one of Rucesion or Loures,
and no other map is gated on citizenship; the two lines above say which condition failed. So the
overlay (decision 3) carries the towns each gate admits beside the map id, and the planner reads
the character's citizenship beside its registration.

**Citizenship is the `nation` byte, not the legend.** Sabrael's facts, 2026-09-21: the legend mark
"<Town> Citizen by oath of <Name> - <Date>" is given only by Mileth and Rucesion (Loures gives none,
Suomi's and Tagor's differ, Medenia has none), Medenia does not remove the marks of other towns,
and a character can hold no citizenship. So a mark can be stale. The `nation` byte of SSelfLook
`0x39`, on the record as `citizenship`, tracks the change: every recording agrees with its legend
where the legend speaks (Gabrael 4 = Mileth with the Mileth mark; every Rucesion mark on 6), and
Sylphid, Medenian, is nation 7 with an old Rucesion mark. The Nation table is darkages-741-re's
(`NATION_OF_TOWN` in `model/access.ts`). Value 0 is "None", a citizenship of nowhere, and it is a
fact once SelfLook has been seen: it bars both Commons, and clout at Mileth and Rucesion (Sabrael).
That is why the record carries `citizenship` beside `appearance.nation`: the latter defaults to 0,
and only the former says whether the byte has been seen. Not yet seen bars nothing.

The rule: an unregistered legend mark or either refusal (signal 3 or the second line of signal 4)
makes the character unregistered; else a seen expiration message makes it registered; else
registered by default, and the newest signal wins because a registration expires. Citizenship is
the `nation` byte; a gate admits the towns it lists; not yet seen gates nothing, and 0 gates
everything. A map whose gate refused this character is barred for the rest of the session whatever
the byte says: the gate's word is the authority.

## Decisions

1. **Decode `SSystemMessage 0x0A`.** Done in WP17 PR3: `decode/message.ts`, body `[u8 type]` and
   `[string16 text]`, with the type-0x11 confirmation prompt's three reply values; the type table is
   darkages-741-re's. The decoder is generally useful (it feeds the Laborer's refusal reading now,
   and a chat view or the packet inspector, WP20, later), so it is not registration-only.
2. **Registration is a positive fact on the record.** Add `registered?: boolean` to
   `CharacterRecord`, set `false` when the unregistered legend mark is seen and `true` when the
   expiration message is seen. `undefined` means unknown, which the planner treats as registered.
   Name the field in `characterSchema`, or it is dropped on load (WP11's rule). **Taken**: the
   character reducer reads SelfLook's legend and every type-3 `0x0A` (`registrationFromNotice`);
   `mergeCharacter` keeps the last known value across a login that showed no signal, and a newer
   signal replaces it; the schema names it.
3. **Gated maps are a small overlay, seeded and learned** (the chosen source). A hand-kept
   `route/access.json` lists the gated map ids with the town each admits, seeded with the known
   ones (Rucesion Commons `3048`, Mileth Commons `3025`, and any others). It is separate from the
   generated `worldmap.json`, so a re-import never clobbers it. The wire refines it: a stall at a
   warp into a map beside the gate's own notice (signal 4, either line) learns the map as gated,
   with the town from the notice's text — a WP29-style learned fact, with the same provenance and
   observation-count honesty. The notice is the proof; a stall alone is a creature or a wall.
   **Taken, for the process**: `gateRefusal` in the walker reads the newest notice after a warp
   that did not fire, learns the map as that town's gate for the life of the process, and marks
   the town as one that refused this character for the session. Persisting a learned gate with its
   provenance is WP29's store, not built yet; the log line names the map and the town so the seed
   can be extended by hand.
4. **The planner is registration-aware.** **Taken as** `planRoute(from, to, { passable })`: the
   graph takes a predicate and knows nothing of gates; the walker builds it from the gates and the
   character's passport (`gateBars` in `route/access.ts`). A route that exists only through a
   barred gate is `gated`; no route at all is `noRoute`.
5. **The walker says why.** **Taken**: a new `WalkStopReason` `gated`, and the run's reason line
   names the gate and the condition — "Mileth Commons admits only a registered character", "…
   admits only a citizen of Mileth or Loures", or the gate's own words when it refused mid-walk. The
   destination picker is unchanged.

## Non-goals (stop-lines)

- **No guessing registration from class or nation.** Those are not the signal; the notices and the
  legend mark are. (Nation is the citizenship, a different fact.)
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

1. An unregistered character sent to a place behind a gated map stops with `gated` and a message
   that names the gate and the cause, before it moves. **Unit test passes** (`walker.test.ts`,
   "a gated map"): zero presses; a citizen of another town the same.
2. A registered character of the gate's town walks the same route normally. **Unit test passes.**
3. A character with no signal is treated as one that may pass. **Unit test passes**: an empty
   passport and a record not yet identified both walk.
4. The gated-map overlay survives a re-import of `WorldMap.dat`. **Holds by construction**:
   `access.json` is a separate hand-kept file.
5. A learned gate needs the gate's own refusal, and a creature-block is not mistaken for a gate.
   **Unit test passes**: the refusal at the warp stops the walk as `gated` with no three-stall
   grind, and the next walk stops before moving; a stale citizenship byte does not send the
   character back. A stall with no notice is the walker's ordinary `blocked` path, unchanged.
6. `0x0A` decodes to the right type and text against wire bytes (done in WP17 PR3).
7. The record's `registered` follows the newest signal and survives a restart. **Unit tests pass**
   (`character.test.ts`, `characterStore.test.ts`).

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the `0x0A` decode; the registration reducer over a legend with and without the mark
   and over an expiration message; the planner's gated-map exclusion for a registered and an
   unregistered character.
3. GUI (hand to Sabrael): a character whose record says unregistered (a Labor refusal or the
   gate's register line this session, or the unregistered mark) asked for a place behind a Commons
   stops before moving with "… admits only a registered character"; a registered citizen of the
   other town stops with "… admits only a citizen of …"; a registered citizen of the town walks
   it. And a character the record knows nothing about, sent at a Commons that refuses it, stops on
   the refusal with the gate's own words and does not walk back into it on the next Run.

## Needed input

- The **map ids** to seed the overlay: Rucesion Commons `3048` and Mileth Commons `3025` are known;
  add any others as they are found.
- The **exact unregistered legend mark** text or key to match, confirmed against a live unregistered
  character. Matched on the word "Unregistered" for now; no recording holds the mark, and Sabrael
  says it is inconsistent, which is correct.
- The **citizenship marks of Suomi and Tagor**, if they are ever wanted: not needed for the planner,
  which reads the byte, but useful for the record's legend view.
