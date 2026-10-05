/**
 * Baskin Robbins ice cream is counted in GRAMS.
 *
 *   stock (g) = unopened boxes × full box weight
 *             + (open box on the scale − empty box weight)
 *
 * - full box weight  = items.full_box_grams (ice cream inside one sealed box, set per flavour)
 * - empty box weight = items.tare_grams (100 g)
 * - Only ONE open box per flavour is weighed. If the open box is empty / finished, leave it blank.
 */

export type BoxItem = { name: string; tare_grams: number; full_box_grams: number | null };

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
  if (!Number.isInteger(unopened) || unopened < 0) return { grams: null, error: `${item.name}: unopened boxes must be a whole number` };
  if (isNaN(gross) || gross < 0) return { grams: null, error: `${item.name}: check the open box weight` };
  if (unopened > 0 && !(Number(item.full_box_grams) > 0)) {
    return { grams: null, error: `${item.name}: full box weight is not set — ask your manager (Ice Cream Flavours page)` };
  }
  if (gross > 0 && gross < item.tare_grams) {
    return { grams: null, error: `${item.name}: open box weighs less than an empty box (${item.tare_grams} g)` };
  }
  const openNet = gross > 0 ? gross - item.tare_grams : 0;
  return { grams: unopened * Number(item.full_box_grams || 0) + openNet, error: null };
}

/** Rebuild the inputs from a saved row. Old rows (before boxes) can't be split, so they come back blank. */
export function boxEntryFromSaved(unopened: number | null | undefined, openGross: number | null | undefined): BoxEntry {
  if (openGross === null || openGross === undefined) return { unopened: '', openGross: '' };
  return { unopened: String(unopened ?? 0), openGross: Number(openGross) > 0 ? String(openGross) : '' };
}
