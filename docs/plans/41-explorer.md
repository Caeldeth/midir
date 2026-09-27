# WP41 — the explorer, which visits maps without being steered

**Size:** L. **Depends on:** WP29 (learned transitions), WP33 (the world map pane), WP34 (popups),
WP35 (right-click walking), WP39 (`reachableFrom`), WP32 (access). Read `00-overview.md` first.
**BUILT 2026-09-27**, under the conservative default of question 1: no unattended mode.
**Card:** `HTOO-476`.
**Trigger to start:** Sabrael, 2026-09-26: "walking all these maps by hand would be tedious."

## Goal

Visit maps in order, without the player steering each hop, so that everything which only a visit can
teach gets taught.

A visit is the only source for all of these:

- the map's own name from the wire (`SMapSize 0x15`, WP29), which outranks every imported name;
- the map's size, which the cache file has no header for (WP30);
- the music track (WP40), which arrives only when it changes;
- the confirmation of a warp the world XML only proposes (WP24 — every XML edge is a candidate
  until the wire crosses it, because the XML is a tile off where the wire is not);
- the door tiles a map really has (WP31);
- the NPC positions WP24 still owes.

One evening of ordinary play produced 35 music readings and a few dozen confirmed warps. The
production world repo holds 1424 maps. The gap is the whole argument for this WP.

## How it would work

The explorer is not a new way to drive the client. It is a **queue in front of the walker that
already exists**, so the new code is a scheduler and a stop policy, not new input.

1. **The frontier** is every node in `reachableFrom(current)` (WP39) that the stores have no reading
   for — no wire name, no size, no music, or an unconfirmed warp on the way in.
2. It picks the cheapest one by `planRoute`, walks there with the walker exactly as a player's
   "Go" does, waits for the map to settle (the `0x15`, then the first `0x04`), and lets the ordinary
   reducers record what arrives. The explorer stores nothing of its own.
3. It repeats until the frontier is empty, the budget runs out, or a stop fires.

**It confirms edges; it does not discover them.** A map with no edge Midir has ever heard of is not
in `reachableFrom`, so the explorer cannot reach it. Finding an unknown warp means walking a map's
walkable tiles until one warps, which is a different feature with a different cost. It is out of
scope here, and it belongs in the register with its own trigger.

## The stop policy is the hard part, not the walking

Every rule in `CLAUDE.md` applies unchanged: off until turned on, one global stop that always works,
stop on losing the game window, no packet, no credential pane. The explorer needs more, because
nobody is watching each hop:

- **Stop on health.** The reducer holds health and mana (`SStatus 0x08`). A drop stops the run and
  marks the map.
- **Stop on a dialog it did not open** (WP34), and on an exchange window, which another player
  opens (`SExchange 0x42`).
- **Stop on a refusal.** A gate's own words are the authority for the session (WP32,
  `route/access.ts`).
- **A budget.** A count of maps and a wall-clock limit, both stated in the panel, both reached by
  stopping.
- **An avoid set.** A map that ended a run is not offered again until the user clears it. The graph
  holds no danger data, and this is the only way the explorer can learn any.

**Retail maps hold monsters, and a character that walks into a hunting ground will be attacked.**
The plan does not pretend otherwise. The first runs are towns and paths with Sabrael watching, and
the avoid set is how the frontier shrinks to what is survivable.

## What shipped

- `src/main/explorer.ts`: the scheduler. `run` walks the queue, `stop` ends a run, `states` reports
  them, `dispose` stops every run on shutdown. It holds no store of its own.
- `RouteGraph.distancesFrom(mapId)`: the reachability sweep WP39 added, with the hop count kept.
  `reachableFrom` is now that sweep with the distances dropped, so the rule for which exits a walk
  may take stays in one place.
- The IPC surface: `explorer:start`, `explorer:stop`, `explorer:state`, and the
  `explorer:state-changed` push, with the Zod shape check beside the walker's.
- `ExplorerCard` on the Walker tab, because the explorer is the Walker with a queue and it drives
  the window the Walker is pointed at. It states the budget, the map it is walking to, how many maps
  it has visited, how many are unread and in reach, and how many it set aside.
- The frontier is **a map the stores have never held**. A map that was visited and stayed silent is
  not a target: the server sends a music track only when the track changes, so a second visit would
  teach nothing and the run would circle it until its budget ran out.
- The store read is taken after `captureService.flush()`. An arrival writes on a debounce, and a
  stale read would send the run back to the map it just left.

**The stop policy as built.** The walker's own stops arrive as outcomes, and the explorer sorts them
into one map's problem and the session's: `blocked`, `noRoute`, and a gate's `gated` set that map
aside and the run goes on, while `lostCharacter`, `lostPosition`, `dialog`, and `protected` end it.
On top of those it stops when the character loses health, when the budget of maps or of minutes is
spent, and when the frontier empties.

**The health rule holds the lowest reading, not the last.** Against the last reading, natural
regeneration between hops reads as a hit (90, then 95, then 92 would stop a run). Against the lowest
seen, it does not, and a character that began the run already hurt is not stopped for the health it
was missing when it started.

## What the first watched run found, 2026-09-27

Sabrael ran it. Three faults, all now fixed, and the log was the evidence for each.

1. **A run stranded itself and called it finished.** It walked Mileth → MilethEnt → Abel Outskirts →
   EwEnt → EW-Crossroads → Wastelands, and at the Wastelands the frontier collapsed from 187 unread
   to 1 and the run reported `done`. Nothing was reachable from there, because the learned graph holds
   the way in and not the way back. An empty frontier with unread maps left is now `stuck`, which says
   what happened.
2. **One unwalkable map condemned thirteen good ones.** In a third of a second the run set aside
   Mileth Town Hall, West Woods 10-1, Pravat West Entrance, Loures Castle, Loures Harbour, Abel Bank
   and seven more, each with `blocked`. Every one of those walks failed at the origin: no first step
   landed. A `blocked` stop that took **no step** is now read as a fact about where the character
   stands, and the run stops as `stuck` instead of burning the frontier. `WalkOutcome` carries
   `stepsTaken` for that.
3. **The frontier ignored most of the map data Midir holds.** The sweep took only confirmed edges, so
   224 maps were in reach from Mileth where the imported world XML knows 485. Both the explorer's
   sweep and the walker's plan now take candidate edges (`PlanOptions.useCandidates`), which is also
   the only way a candidate ever gets confirmed.

The same run proved the good half: the first six maps were a clean Mileth sweep — the Altar, the
Tavern, the Bank, TOC, the Crypt Vestibule, Crypt 1 and Crypt 2-1 — and no map was misread.

## Open questions — the first is answered by the build, and Sabrael may overrule it

1. **How long may it run, and may it run while the player is away?** **Built as the conservative
   answer**: a budget of 20 maps and 15 minutes by default, bounded at 200 maps and 120 minutes, a
   panel that states what the run is doing, `assistStopOnFocusLoss` honoured through the action
   layer, and no unattended mode. A walker that goes where the player just asked is a convenience; a
   process that walks a world for hours is the thing an operator looks for, and the README already
   says automation is at the player's own risk. Raising the bound is a decision, not a tweak.
2. **Towns and paths only, or learn the danger?** Built the second way: the run sets aside a map the
   walker could not deliver, and the health stop ends the run on the first hit. There is no curated
   safe list. If the first watched runs are bloody, a hand-kept list of maps to leave alone is the
   next step.
3. **Does it use a gateway?** Yes, and it needed no code of its own: the walker plans a world-map
   hop and clicks the pane's point (WP33), so a gateway is one more leg to the explorer.

## Non-goals (stop-lines)

- **No packet.** The spike (WP18) has not landed, and nothing here needs it.
- **No tile probing for unknown warps.** See above.
- **No combat, no healing, no item use, no death recovery.** A run that ends in trouble stops; it
  does not play the character out of it.
- **No unattended run** until question 1 is answered otherwise.
- **No store of its own.** Everything it learns is written by the reducer that already owns it.

## Verification

- `src/main/__tests__/explorer.test.ts`: 44 tests over a fake walker. The nearest-first order and its
  tie-break, the map already read, the map set aside and never asked for twice, every stop reason,
  both budgets, the health rule including the regeneration case, the stop that ends a run, the
  refusal of a second run on one window, and `dispose`.
- `src/main/__tests__/assistHandlers.test.ts`: the IPC shape check and the refusal with no window.
- `src/renderer/src/components/__tests__/ExplorerCard.test.tsx`: the panel off until a window is
  picked, the budget it sends, the progress it states, and the stop.
- The walking itself is WP35's and WP29's, already proven.
- **Handed to Sabrael:** one watched run of a dozen town maps, then `scripts/export-map-music.mjs`
  to confirm the table gained them. Nothing below the `PacketSource` seam can be checked by an
  agent, and a run drives a real client.
