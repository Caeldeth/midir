# WP41 — the explorer, which visits maps without being steered

**Size:** L. **Depends on:** WP29 (learned transitions), WP33 (the world map pane), WP34 (popups),
WP35 (right-click walking), WP39 (`reachableFrom`), WP32 (access). Read `00-overview.md` first.
**PLANNED — not scheduled.** It needs the ruling in "Open questions" first. **Card:** `HTOO-476`.
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

## Open questions — Sabrael decides before this is scheduled

1. **How long may it run, and may it run while the player is away?** A walker that goes where the
   player just asked is a convenience. A process that walks a world for hours is the thing an
   operator looks for, and the README already says automation is at the player's own risk. The
   conservative answer, and this doc's default until told otherwise, is: a budget in minutes, a
   visible panel, `assistStopOnFocusLoss` honoured, and no unattended mode at all.
2. **Towns and paths only, or learn the danger?** Restricting the frontier by hand is safe and
   slow. The avoid set is automatic and costs a death or two.
3. **Does it use a gateway?** WP33 can click a world map point, so it can. A world-map hop crosses
   the map the player would not walk, which widens the frontier a long way.

## Non-goals (stop-lines)

- **No packet.** The spike (WP18) has not landed, and nothing here needs it.
- **No tile probing for unknown warps.** See above.
- **No combat, no healing, no item use, no death recovery.** A run that ends in trouble stops; it
  does not play the character out of it.
- **No unattended run** until question 1 is answered otherwise.
- **No store of its own.** Everything it learns is written by the reducer that already owns it.

## Verification

- The scheduler is a pure queue over a fake walker, so the frontier order, the budget, the avoid
  set, and each stop reason are unit-testable with no game.
- The walking itself is WP35's and WP29's, already proven.
- Handed to Sabrael: one watched run of a dozen town maps, and a check that the export from WP40
  gained those maps.
