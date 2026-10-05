/**
 * Rista counts in kg / lt / Nos. Older app items store grams / ml / pieces.
 * Staff always type in the Rista unit (what the audit uses); we store the app unit.
 */
export type Uom = 'grams' | 'ml' | 'pieces';

export function unitFactor(ristaUnit: string | null | undefined, uom: string): number {
  const r = (ristaUnit || '').trim().toLowerCase();
  if (['kg', 'kgs', 'kilogram'].includes(r) && uom === 'grams') return 1000;
  if (['lt', 'ltr', 'l', 'litre', 'liter'].includes(r) && uom === 'ml') return 1000;
  return 1;
}

/** Label for the unit staff type / see. */
export function displayUnit(ristaUnit: string | null | undefined, uom: string): string {
  const f = unitFactor(ristaUnit, uom);
  if (f === 1000) return uom === 'grams' ? 'kg' : 'litre';
  return uom === 'pieces' ? 'pcs' : uom === 'grams' ? 'g' : uom;
}

/** App unit → what we show (e.g. 6500 g → 6.5 kg). */
export const toDisplay = (q: number, ristaUnit: string | null | undefined, uom: string) =>
  Math.round((q / unitFactor(ristaUnit, uom)) * 1000) / 1000;

/** What staff typed → app unit. */
export const fromDisplay = (q: number, ristaUnit: string | null | undefined, uom: string) =>
  q * unitFactor(ristaUnit, uom);

/** App unit to use for a new item, from the Rista unit. */
export function uomForRistaUnit(ristaUnit: string): Uom {
  const r = ristaUnit.trim().toLowerCase();
  if (['kg', 'kgs', 'g', 'gm', 'gms'].includes(r)) return 'grams';
  if (['lt', 'ltr', 'l', 'litre', 'liter', 'ml'].includes(r)) return 'ml';
  return 'pieces';
}

/** Rista category → our audit group. */
export function groupForRistaCategory(category: string, subCategory = ''): string {
  const c = category.toLowerCase();
  const s = subCategory.toLowerCase();
  if (c.includes('packaging')) return 'Packaging';
  if (s.includes('cake') || s.includes('dessert') || s.includes('fmcg') || s.includes('chocolates & bar')) return 'Cakes & Pastries';
  if (c.includes('raw')) return 'Raw Material';
  if (c.includes('asset')) return 'Assets';
  return 'Other';
}
