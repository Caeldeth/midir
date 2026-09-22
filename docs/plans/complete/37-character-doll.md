# WP37 — the character doll

**Size:** M. **Depends on:** WP7 (the dalib-ts render path), WP19 (the Equip screen). Read
`00-overview.md` first. **COMPLETE 2026-09-22.** **Card:** `HTOO-84`.
**Trigger to start:** a decision to build the doll. Sabrael, 2026-09-22: "Brigid itself does the
body composition — we ask for legacy dat files in settings, this should be doable."

## Goal

Draw the character in the centre of the Equip screen as the client's paperdoll draws it: the body,
the face, the hair, and every worn sprite, composited from the client's own archives.

## What shipped

**The recipe is Brigid's `AislingRenderer`, with the rendering taken out.** Each layer is one EPF
frame from the khan archives, `{m|w}{letter}{sprite:D3}{anim}.epf`, through the palette the
letter's `khanpal` table gives that sprite, dyed where the item is dyed. The letters are the
client's own: `b` the body outline, `m` the skin, `o` the face, `n` the pants, `l` the boots,
`h`/`e`/`f` the hair's three passes, `u`/`a` the armour's torso and arms (`i`/`j` for an overcoat,
whose sprite is 1000 higher), `w`/`p` the weapon's halves, `s` the shield, `c`/`g` an accessory's
halves. The draw order is Brigid's `FRONT_ORDER`; the doll is the walk animation's frame 5 (the
right-facing idle) mirrored to face down, as the paperdoll is; every layer sits at y 0 on a 111 by
85 canvas with the body 27 px in, and the `w`, `p`, `c`, `g` sheets 27 px further left because they
are cut wider. `main/icons/doll.ts` is that, pure, over an injected frame source, so it is proved
with hand-made frames; `main/icons/dollService.ts` is the source over the eleven archives
(`khanpal.dat` and the five `khan{m|w}*` pairs) through dalib-ts, with the dye ramps from
`legend.dat`'s `color0.tbl`. Brigid's palette rule is kept where dalib-ts's general lookup differs:
a palette number at or above 1000 is the same palette, without luminance blending.

**The record now holds the whole form.** `SDrawHumanObjects 0x33` always carried the arms sprite,
the pants dye, the boots colour, and the three accessories; the record kept none of them. They are
on `CharacterAppearance` now, named in `characterSchema` with a default of 0 so a file from before
loads. Gender is not a field: it is the packed body byte's high nibble (`genderOfBody`,
`bodySpriteOf` in `shared/doll.ts`, from Brigid's `DetermineGender` and `GetBodySpriteId`). Retail
writes 255 for no shield where Hybrasyl writes 0; both are no shield.

**The doll is asked for by URL, like an icon.** `midir-icon://doll/<field>/…`, the appearance's
fields in `DOLL_FIELDS` order, so a changed form is a new URL and the browser's cache does the
rest; the CSP already admits the scheme. The Equip screen's centre is the `<img>`; a 404 (no game
folder, no body on the record, an archive that will not open) puts the placeholder back.

**One layout fault found on the first look:** the doll's cell is a `1fr` track, and an image wider
than the track grew it and squeezed the four beside it. `minmax(0, 1fr)` and the image at its
natural size, overflowing its cell over transparent padding, is the fix.

## Decisions

1. **Brigid's recipe, not a fresh reading of the client.** Brigid's compositor is verified against
   retail by hand; a second derivation would be a second set of mistakes.
2. **Compose in main, ask by URL.** The archives stay in main with `legend.dat`; the renderer
   asks with an `<img>` and never touches a file.
3. **A frame missing from the archive is skipped, not fatal.** The item has no art at that pose, or
   the archive lacks it; the doll is still the doll. A missing body is no doll.
4. **Front view only, still.** One frame, facing down. The paperdoll animates nothing.

## Non-goals (stop-lines)

- **No animation, no other facing.** One frame.
- **No emotion, rest, or swim overlays.**
- **No writing the client's files, and no reading its memory.** The archives are read like
  `legend.dat`.

## Acceptance criteria

1. The Equip screen's centre shows the character as the client draws it, with every worn sprite.
   (Sabrael, 2026-09-22: "the characters are rendering correctly".)
2. A record from before WP37 loads, and draws once its next login fills the new fields.
   (`characterStore.test.ts`.)
3. No game folder, or an archive that will not open, leaves the placeholder. (`doll.test.ts`,
   `protocol.test.ts`.)

## Verification

1. `npm run typecheck && npm run lint:check && npm test && npm run build`.
2. Unit tests: the layers per form, the sheet and palette naming, the composite's order, offsets
   and mirror, the URL round trip, the reducer's copy, the schema's defaults.
3. GUI (Sabrael): the doll in the Equip screen, the frames beside it unmoved.
