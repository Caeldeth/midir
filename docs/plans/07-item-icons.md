# WP7 — item icons via dalib-ts

**Size:** M. **Depends on:** WP6 (the index carries `sprite` and `color`), WP9 (bank rows carry them
too). Read `00-overview.md` first. **PLANNED — the one gap in the shipped run.**

## Goal

Show the game's own icon beside every item: in the Items index, in the inventory and equipment lists
on the character sheet, and in the bank card. One change lights up all four surfaces, because they
all render from records that already carry the sprite id and the dye colour.

## The one way to get this wrong

**Make the build, the tests, or CI need the game files.** Nobody has Dark Ages installed on a CI
runner, and nobody should have to. Icons are an enhancement over a record that is already complete
and readable: if the client path is unset, wrong, or the archive will not open, **every surface must
render exactly as it does today**, with no error, no placeholder box, and no missing-image icon.

Two consequences, both non-negotiable:

- **No game asset is ever committed, vendored, or fixtured.** The unit tests exercise the pure parts
  — id arithmetic, cache keys, the disabled path — and never open a `.dat`.
- **The archive is opened lazily, on the first icon request**, never at startup. A wrong path must
  cost nothing until somebody asks for a picture.

## The recipe (verified, not guessed)

From brigid's `PanelSpriteRepository.GetItemSprite` and the document repo's item-asset scoping,
which is a full scan of the 13,882 legacy items:

```text
spriteId &= 0x7FFF        // server ids carry the 0x8000 "item display" flag
fileId    = ceil(spriteId / 266)          // ITEMS_PER_FILE = 266
frameId   = (spriteId - 1) % 266
sheet     = legend.dat -> `item{fileId:D3}.epf`      // item001.epf, item002.epf, ...
palette   = PaletteLookup over legend.dat, prefix pair ("itempal", "item")
if color > 0: palette = palette.dye(dyeTable[color]) // color0.tbl in legend.dat
```

The dye replaces palette indices **98 to 103** (`PALETTE_DYE_INDEX_START`). A `spriteId` of 0 has no
icon. Colour is 0–71 and maps to the `DisplayColor` names; 0 is Default and means no dye.

**Only 623 of 13,882 items are actually dyeable** — the rest either have no dye ramp or paint no
pixels in the dye slots — so the dye pass is usually a no-op. Do not use that to skip the pass:
detecting dyeability costs more than doing it.

## What dalib-ts already provides

`@eriscorp/dalib-ts` v2.2.0 (`Repos/dalib-ts`) exports everything this needs, so **no binary parsing
belongs in Midir**:

- `DataArchive.fromFile(path)` / `.fromBuffer(buffer)` and `getEntryBuffer(entry)`
- `EpfView.fromEntry(entry)` — **lazy**, decodes one frame on demand rather than the whole sheet
- `PaletteLookup`, `Palette`, `Palette.dye(entry, start = 98)`, `ColorTable`
- `renderEpf(...)` → `RgbaFrame { data: Uint8ClampedArray, width, height }`
- `helpers/imageData` → `toImageData(frame)` for a canvas, if the renderer ever wants one

Add it as a dependency; do not copy code out of it. A bug in the format belongs upstream.

## Decisions

1. **Main opens the archive; the renderer never touches disk.** Settled decision 5. The renderer
   asks for a picture by sprite and colour and gets bytes back.
2. **Serve icons over a privileged protocol, not IPC.** Register `midir-icon://` in main and render
   `<img src={`midir-icon://${sprite}/${color}`} />`. An `<img>` is the whole renderer change; base64
   through IPC would put every icon in a Zustand store and re-render the list on each arrival.
3. **The cache key is `(spriteId & 0x7FFF, color)`**, exactly as brigid's is. Cache the rendered PNG
   bytes in memory, and cache the `EpfView` and the palette lookup per archive so a sheet is opened
   once.
4. **The client path is a setting, validated like every other renderer-supplied path.** Point it at
   the Dark Ages folder, not at `legend.dat`; check for `legend.dat` beside it and say plainly in
   Settings whether icons are on. The setting is optional and unset by default.
5. **Failure is silence, not an error.** A missing sheet, a frame id past the end of a sheet, an
   unreadable archive: the protocol handler answers 404 and the `<img>` renders nothing. Log once
   per archive failure, not once per icon.
6. **Icons never enter the record.** They are decoration derived from a sprite id, and a record must
   stay readable with no game installed. Nothing about an icon is persisted with a character.
7. **Do not strip `0x8000` anywhere but here.** The record stores what the server sent; the flag is
   a rendering concern.

## Non-goals (stop-lines)

- **No sprite viewer, no asset browser, no map or mob rendering.** Item icons only. Taliesin is the
  asset tool.
- **No `.datf` asset packs**, no Unity-rip PNG set, no icon overrides. Retail's own files or
  nothing.
- **No animation.** Items are one frame.
- **No on-disk icon cache.** In memory, per run. Reopening a sheet is cheap and a disk cache is a
  second thing to invalidate.
- **No ability, spell, mob, or portrait icons** — `skill001`/`spell001` live in `setoa.dat` with a
  different palette and are a separate WP if they are ever wanted.
- **No bundling of any game asset, ever.**

## Current state when you start

- [shared/items.ts](../../src/shared/items.ts) — `ItemIndexEntry.sprite` exists and has no consumer.
- [shared/character.ts](../../src/shared/character.ts) — `ItemRef` carries `sprite` and `color`;
  `BankEntry` carries `sprite` and `color` too (WP9).
- [pages/Items.tsx](../../src/renderer/src/pages/Items.tsx),
  [CharacterSheet.tsx](../../src/renderer/src/components/CharacterSheet.tsx) — the four render sites,
  all text-only today. `CharacterSheet` already keys bank rows on `${item.name}-${item.sprite}`.
- [settingsManager.ts](../../src/main/settingsManager.ts) — the settings file to add the path to.
  It validates field by field through `withDefaults`, not with a Zod schema, so an unknown or
  malformed value falls back rather than rejecting the file. `MidirSettings` lives in
  [shared/types.ts](../../src/shared/types.ts). [paths.ts](../../src/main/paths.ts) has
  `assertInsideDir` for the guard.
- [main/index.ts](../../src/main/index.ts) — where a scheme must be registered as privileged
  **before** `app.whenReady`, and the handler installed after.
- Nothing registers a custom protocol yet; this WP is the first.

## Contracts

```ts
/** Settings gain one optional path. Unset means icons are off. */
interface MidirSettings {
  /** The Dark Ages install folder, the one that holds legend.dat. */
  darkAgesPath?: string
}

/** Main-side, pure enough to unit-test without an archive. */
export function itemSheetFor(spriteId: number): { fileId: number; frameId: number } | null
export function iconCacheKey(spriteId: number, color: number): string
```

| Surface                         | Shape                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| `midir-icon://<sprite>/<color>` | PNG bytes, or 404 when there is no icon                           |
| `settings:get` / `settings:set` | gains `darkAgesPath`                                              |
| Settings UI                     | folder picker, plus "Icons: on / off, no `legend.dat` found here" |

## Acceptance criteria

1. With no client path set, every view renders exactly as it does today — no gap, no broken image,
   no error in the log.
2. With the path set, an item in the Items index shows its icon beside the name.
3. The same icon appears on the character sheet's inventory and equipment lists and in the bank
   card, from the same cache.
4. A dyed item renders in its dye colour, and the same sprite at two colours gives two different
   pictures.
5. A sprite id with the `0x8000` flag set renders the same icon as the id without it.
6. A sprite id of 0, or past the end of its sheet, renders nothing and logs nothing per-item.
7. Pointing the path at a folder with no `legend.dat` says so in Settings and leaves icons off.
8. **The test suite passes on a machine with no Dark Ages installed** — this is the acceptance
   criterion that outranks the rest.

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests, no archive: the id arithmetic against known pairs (id 1 → `item001.epf` frame 0; id
   266 → `item001.epf` frame 265; id 267 → `item002.epf` frame 0), the `0x8000` strip, the cache
   key, and the disabled path returning nothing.
3. Unit test of the protocol handler with a stubbed archive reader: a hit, a miss, and a malformed
   request are all answered without throwing.
4. GUI (hand to Sabrael, and the only check that proves it): point Settings at the real install,
   open Items and a character sheet, and confirm the icons — including one dyed item at two
   different colours, and one item known not to be dyeable.
