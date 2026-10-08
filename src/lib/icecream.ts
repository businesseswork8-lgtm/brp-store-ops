/**
 * Baskin Robbins ice cream is counted in GRAMS.
 *
 *   stock (g) = packed (sealed) boxes × 2250 g
 *             + (open box on the scale, WITH the box − 100 g empty box)
 *
 * Both weights are fixed for every flavour (ice cream and gelato):
 * - FULL_BOX_GRAMS  = ice cream inside one sealed bulk box
 * - EMPTY_BOX_GRAMS = the empty bulk box itself — taken off automatically,
 *                     so staff type exactly what the scale shows.
 * - Only ONE open box per flavour is weighed. If there is no open box, leave it blank.
 */

export const FULL_BOX_GRAMS = 2250;
export const EMPTY_BOX_GRAMS = 100;

export type BoxItem = { name: string; tare_grams?: number; full_box_grams?: number | null };

/** What staff type in for one flavour (strings, straight from the inputs). */
export type BoxEntry = { unopened: string; openGross: string };

export const isBoxItem = (i: { tare_grams: number }) => Number(i.tare_grams) > 0;

/** True when nothing has been typed. */
export const boxEntryEmpty = (e: BoxEntry) => e.unopened.trim() === '' && e.openGross.trim() === '';

/**
 * Net grams of ice cream, or an error message staff can act on.
 * An empty entry is NOT allowed (staff enter 0 boxes if none).
 */
export function boxNet(item: BoxItem, e: BoxEntry): { grams: number | null; error: string | null } {
  if (boxEntryEmpty(e)) return { grams: null, error: null };
  const unopened = e.unopened.trim() === '' ? 0 : Number(e.unopened);
  const gross = e.openGross.trim() === '' ? 0 : Number(e.openGross);
  if (!Number.isInteger(unopened) || unopened < 0) return { grams: null, error: `${item.name}: packed boxes must be a whole number` };
  if (isNaN(gross) || gross < 0) return { grams: null, error: `${item.name}: check the open box weight` };
  if (gross > 0 && gross < EMPTY_BOX_GRAMS) {
    return { grams: null, error: `${item.name}: open box weighs less than an empty box (${EMPTY_BOX_GRAMS} g)` };
  }
  if (gross > FULL_BOX_GRAMS + EMPTY_BOX_GRAMS) {
    return { grams: null, error: `${item.name}: open box can't weigh more than a full box (${FULL_BOX_GRAMS + EMPTY_BOX_GRAMS} g)` };
  }
  const openNet = gross > 0 ? gross - EMPTY_BOX_GRAMS : 0;
  return { grams: unopened * FULL_BOX_GRAMS + openNet, error: null };
}

/** Rebuild the inputs from a saved row. Old rows (before boxes) can't be split, so they come back blank. */
export function boxEntryFromSaved(unopened: number | null | undefined, openGross: number | null | undefined): BoxEntry {
  if (openGross === null || openGross === undefined) return { unopened: '', openGross: '' };
  return { unopened: String(unopened ?? 0), openGross: Number(openGross) > 0 ? String(openGross) : '' };
}
