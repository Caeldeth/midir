/**
 * Protocol constants that are not shared with the renderer.
 *
 * The name tables for classes, nations, elements, legend icons, and equipment
 * slots live in `src/shared/labels.ts`, because the renderer shows them too.
 * They are re-exported here so the protocol layer reads as one thing.
 */

export {
  CHARACTER_CLASS_NAMES,
  ELEMENT_NAMES,
  EQUIPMENT_SLOT_NAMES,
  FIRST_EQUIPMENT_SLOT,
  INVENTORY_SLOT_COUNT,
  LAST_EQUIPMENT_SLOT,
  LEGEND_ICON_NAMES,
  NATION_NAMES
} from '../../shared/labels'

/** The head sprite value that marks a monster disguise in SDrawHumanObjects. */
export const MONSTER_DISGUISE_HEAD_SPRITE = 0xffff

/** The blind code SStatus uses. Only this exact value means blinded. */
export const BLIND_CODE = 0x08
