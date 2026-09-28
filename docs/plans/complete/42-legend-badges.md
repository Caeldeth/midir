# WP42 — the legend badges, from the client's own sheet

**Size:** S. **Depends on:** WP19 (the item icons) and WP37 (the doll): the same protocol, the same archive pattern, the same fallback. Read `00-overview.md` first. **COMPLETE 2026-09-27**, merged in #46. **Card:** `HTOO-482`. **Trigger to start:** Sabrael, 2026-09-27: "Should we use emoji for the legend mark icons?"

## Goal

Show each legend mark with the badge the game draws for it.

`SSelfLook 0x39` gives every mark an icon byte, and Midir kept it as a word under the mark's text ("Heart", "Warrior"). The word is honest and it is not what a player reads: in the game each mark carries a small carved badge, and the eye finds the mark by its shape.

## Why not emoji

Emoji were the question, and the answer is no, for three reasons that are worth keeping:

1. **Only two of the nine map.** The icons are Aisling, Warrior, Rogue, Wizard, Priest, Monk, Heart, Victory, None. Heart and Victory have an emoji; the five class marks and Aisling do not, and every candidate borrows another game's iconography. A player who knows the real badges reads the substitute as a mistake.
2. **Emoji ignore the themes.** The platform font colours them, so they would stand unchanged through all six themes while everything around them moved.
3. **They fix nothing.** The information Midir was dropping is the badge, and the client has the badge. Reading the client's own files is what this app does for items and for the doll already.

## Where the art is

Found by reading the archives and confirmed against the second protocol source (`darkages-741-re/docs/file-formats/epf.md`, "Character legend badges"):

- **`legends.epf` in `setoa.dat`.** Both of the client's legend layouts (`llegends.txt`, `llegend2.txt`) name it as the `LegendImage` control, in a 21 x 20 rect.
- **The icon byte is the frame index.** `LegendListPane` loads the first eight frames, and `ui_legend_list_draw_item` chooses one with the legend record's first byte. The sheet holds exactly 8 frames of 21 x 20, and icon 8 ("None") has no frame and draws nothing.
- **The palette is `gui03.pal`, from the same archive.** The EPF loader gives this file legacy palette number 3 and resolves selector `0x05000003` through it. `legend.pal` is for the profile EPFs, not for these, and the wrong palette renders the badges in the wrong colours while leaving the shapes right — which is how a guess passes a careless eye.
- **Indexed pixel zero is transparent** for the badge blit.

The eight frames were rendered and checked against the eight names before this shipped.

## How it works

`icons/legendService.ts` is the item icons' pattern with a different archive: open `setoa.dat` once per folder, cache the sheet, the palette and the rendered bytes, and answer "no badge" for everything that goes wrong. `midir-icon://legend/<icon>` serves it, so the pixels never cross the IPC path and the browser caches each badge.

`LegendBadge` in the renderer is `ItemIcon`'s twin: it renders nothing — no gap, no broken image — when the legacy data files are off, when the mark has no badge, or when the fetch fails, and the mark's name is its hover text.

## The stand-in

A player with no Dark Ages folder, or with the legacy data files switched off, would have had a word and no mark. So the badge falls back to a drawn stand-in: eight shapes from the Game Icons set, Sabrael's own picks (2026-09-27). They take the text colour, so they belong to whichever theme is on, and they are plainly Midir's own mark rather than a poor copy of the game's.

The set is CC BY 3.0, so the README carries the attribution. Icon 8 ("None") has no stand-in either.

## Decisions

1. **The name is the hover text, not a caption.** Every mark now carries a shape — the client's own or the stand-in — so the word under each row was saying twice what the badge already said (Sabrael, 2026-09-27). The name stays in `alt` and `title`, where a reader and a screen reader both find it.
2. **No emoji.** See above.
3. **The badge palette and the text palette are different files.** The badge is `gui03.pal`; the mark's `color` byte indexes **`legend.pal`** in `legend.dat`, the palette the client's rich text uses. Both are named in the second source, and reading the real file confirmed it: index 1 is aqua, 32 near-white, 68 yellow, 88 blue, 128 green, 248 red — the same six that Hybrasyl's own `LegendColor` names, which is a second source agreeing with retail's own file.
4. **The colour is moved only as far as the theme needs.** The game draws on one dark parchment and Midir has six themes, two of them light. Taken literally, a near-white mark is written in a light theme's background and disappears. `readableMarkColor` keeps the hue and moves the lightness into a band the theme can show: it scales a too-light colour down, and mixes a too-dark one toward white, because scaling cannot lift a channel that is already zero.

## Non-goals (stop-lines)

- **No copy of the art into the repo.** It is read from the player's own installed client, like every other icon.
- **No new setting.** The badges follow the "Legacy data files" switch the item icons use, and the stand-in takes over when it is off.

## The mark's colour

The palette is 256 short strings, read once per folder and held in the renderer, so no mark carries a colour over IPC: `icons:legendPalette` asks main, `iconsStore` keeps it, and the sheet looks the byte up. Without the client's files there is no palette, and the theme's own text colour stands.

## Verification

- `npm run typecheck && npm run lint:check && npm test && npm run build` — 1614 tests.
- `src/main/icons/__tests__/legendService.test.ts`: the frames the sheet has, the lazy open, the cache, the folder change, and the one warning when the archive will not open.
- `src/main/icons/__tests__/protocol.test.ts`: the `legend` host, a malformed request, and the 404 for a mark with no badge.
- `src/renderer/src/components/__tests__/LegendBadge.test.tsx`: the src and the name, the empty render for "None" and for icons off the sheet, the switch, and the failed load.
- **Handed to Sabrael:** open a profile on a character with marks and confirm the badges match the game's own list.
