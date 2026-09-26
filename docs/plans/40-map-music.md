# WP40 — capture the music track of each map

**Size:** S. **Depends on:** WP29 and WP30 (the learned layer, and `maps.json`). Read
`00-overview.md` first.
**PLANNED.** **Card:** `HTOO-475`.
**Trigger to start:** Sabrael, 2026-09-26, on a map music table for the other tools in the
ecosystem.

## Goal

Record which music track each map plays, and let another tool read the table.

Hybrasyl's map format already holds the field: `Music` is an `unsignedByte` attribute on a map
(`xml/src/Objects/Map.cs`, `xml/src/XSD/Map.xsd`). The production world repo sets it on 151 maps of
1424, and ceridwen on 110 of 1104. Nothing gives the other 1273 a value, because the value is
retail's and nobody has read it off retail.

Midir is already on the wire when retail states it.

## What the wire gives

`SSoundEffect 0x19` carries one byte. A byte of `0xFF` marks the music form, and the byte after it
is the track. Any other value is a one-shot sound effect id. Sources: the document repo's
`protocol/server/0x19-play-sound.md`, and `darkages-741-re/docs/network/server/025-0x19-sound-effect.md`.

**The server sends no audio.** The client plays its own local file, `.\music\<track>.mus`, which is
an MP3 with the extension changed. So this WP records a number. There is no sound to capture, and
no file to copy.

Track `100` means "keep playing". It is not a stop, and it names no map.

### Measured in the private recordings, 2026-09-26

53 recordings hold 2273 `0x19` frames. The session decoded 2224 of them; the other 49 arrived on
connections whose key was never known. Of the 2224: **1808 sound effects** over 16 distinct ids, and
**416 music readings**.

Retail sends **four body bytes** for music, `[0xFF][track][0][0]`, in 410 of the 416 readings; five
carry a single trailing zero and one carries `[0][25]`. The 7.41 client reads the first two bytes
and stops, so the tail changes nothing. This settles the open note on the document repo's page,
which records that the reference servers disagree on the length: retail matches Chaos's serializer,
not Hybrasyl's. That page is owed the correction.

## How the track finds its map

The packet names no map, so the map is the connection's newest `SMapSize 0x15`. Two rules make that
attribution sound, and both are measured rather than assumed:

1. **Drop track 100.** It means the music did not change. 18 of the 416 readings.
2. **Drop a reading that belongs to the world map pane.** 34 readings arrived after `SFieldMap
0x2E` on the same map. **Every one of the 34 is track 15**, which is the field theme the pane
   itself plays, and the map under the pane is a gateway whose own track is something else.

With both rules, **364 readings name 35 maps and no map disagrees with itself.** Without them, 6 of
36 maps carried two tracks, and the false one was track 15 every time: Abel Port read 17 and 15,
Rucesion Village 16 and 15, Undine Village Way 13 and 15.

The 35 maps also agree with each other in a way that no rule enforced: track 16 is every Rucesion
map that was visited (the Village, the Commons, the Hall, the Threshold, the Armor Shop, the
Storage), and track 18 is every Mileth one (the Village Way, the Hall, the Threshold, the Inn). A
track is a town's theme, so a wrong attribution would show as one map out of step with its town.
None is.

Four maps carry track 15 as their own reading, with no pane in sight: Piet Village, Pravat South
Entrance, Mehadi Entrance, and Training Dojo 1. Each is a field or entrance map, and the pane shows
a field, so the plain reading is that 15 is the field theme and the pane reuses it. **The rule
above does not depend on which it is**, because it drops a pane reading by what preceded it, not by
its value.

## Design

- **The decoder.** `protocol/decode/sound.ts`: `{ kind: 'music', track }` for the `0xFF` form, and
  `{ kind: 'soundEffect', id }` for the other. It reads the two bytes and steps over any tail.
  `ServerOpcode.SoundEffect = 0x19`.
- **The reducer.** `model/music.ts`, pure, per connection, in the shape of `model/doors.ts`: it
  holds the current map id and whether a field-map pane has arrived since that map's `0x15`, and it
  returns a reading only when the two rules above allow one.
- **The store.** `MapSize` in `store/mapStore.ts` gains an optional
  `music?: { track: number; seenAtMs: number }`, with the Zod schema extended in the same commit —
  a field the schema does not name is dropped on load, silently. `withMapMusic` writes it, newest
  reading wins, beside `withMapSize`. `captureService` pushes the write at the same site the map
  size is written.
- **The export.** `scripts/export-map-music.mjs` reads `maps.json` and writes map id, name, track,
  and the reading's time, as JSON and as CSV. It writes into a path the user names. It never writes
  into another repo.
- **The Map tab** names the track beside the size, so a wrong value is visible where the map is.

## Decisions

1. **The sound effect is decoded and dropped.** It is driven by an event, not by the map, so it has
   no per-map value (Sabrael, 2026-09-26). The decoder still names it, because the packet inspector
   (WP20) must not report a modelled packet as unmodelled.
2. **A map that sent nothing gets nothing.** The server sends a track only when the track changes,
   so a map whose music matches the map behind you is silent. "The same as the previous map" is a
   fact about the route, not about the map. This is the bank's rule, and the reading carries its
   time for the same reason.
3. **The pane rule is by order, not by value.** See above. Track 15 is a real map's track as well.
4. **One number per map, and the newest wins.** No promotion count. A reading that survives the two
   rules has no competing source, unlike a warp, which the XML and the `.dat` also claim.

## Non-goals (stop-lines)

- **No audio.** There is none on the wire, and Midir does not read the client's files for it.
- **No sound-effect record.** See decision 1.
- **No guess for a silent map.** See decision 2.
- **No write into the world repo, ceridwen, or any other repo.** Midir exports a file; a person
  decides what to do with it.
- **No playback in Midir.**

## Verification

- `npm run typecheck && npm run lint:check && npm test && npm run build`.
- Unit tests: both body forms and the four-byte tail; the reducer drops track 100, drops a reading
  after a pane, keeps one after the next map change, and forgets its map on a connection loss; the
  store round-trips the new field through the schema.
- A synthesised replay fixture proves the path from packet to `maps.json`. The private recordings
  are not in the repo, so the 35-map figure above is reproduced by Sabrael with the export script.
- Handed to Sabrael: walk from Mileth to Rucesion, and confirm the export names both towns with the
  tracks measured above.

## What this cannot do alone

53 recordings and 976 map entries produced 35 maps. The table fills only by visiting, and only when
the track changes. Filling it for a world of 1424 maps by hand is the problem WP41 exists for. WP40
does not depend on WP41, and ships without it.
