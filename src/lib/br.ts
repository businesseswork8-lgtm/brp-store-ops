/**
 * Baskin Robbins: ice cream only.
 * Every flavour is weighed at OPENING and CLOSING (grams), and checked against
 * Rista "Sales By Items" (qty × serving grams) plus a tasting allowance per flavour.
 */
export const BR_BRAND_ID = '22222222-2222-2222-2222-222222222222';

export const isBRStore = (store: { brand_id: string } | null | undefined) => store?.brand_id === BR_BRAND_ID;

export type Session = 'opening' | 'closing';

export type BRReportRow = {
  item_id: string; code: string | null; flavour: string; range_name: string; is_gelato: boolean;
  opening: number | null; received: number; closing: number | null; used: number | null;
  sold: number; wasted: number; gap: number | null; allowance: number;
  prev_closing: number | null; overnight_change: number | null;
  status: 'OVER' | 'CHECK' | 'OK' | 'NO_SALES' | 'NOT_COUNTED';
};

export type BRSalesLine = {
  sales_key: string; item_name: string; variant: string; item_type: string; category: string; quantity: number;
  item_id: string | null; flavour_name: string | null; size_id: string | null; size_name: string | null;
  grams_each: number | null; grams: number; matched_by: 'saved' | 'auto' | 'ignored' | 'skipped' | 'no_flavour' | 'none';
};

export const BR_STATUS: Record<BRReportRow['status'], { label: string; cls: 'badgeDanger' | 'badgeSuccess' | 'badgeDefault'; help: string }> = {
  OVER: { label: 'Over', cls: 'badgeDanger', help: 'More ice cream gone than sales + wastage + tasting allowance explain.' },
  CHECK: { label: 'Check', cls: 'badgeDefault', help: 'More ice cream left than expected — miscount, or a delivery not entered?' },
  OK: { label: 'OK', cls: 'badgeSuccess', help: '' },
  NO_SALES: { label: 'No sales file', cls: 'badgeDefault', help: 'Sales By Items not uploaded for this day.' },
  NOT_COUNTED: { label: 'Not weighed', cls: 'badgeDefault', help: 'Opening or closing weigh is missing.' },
};

/** Grams → "1.25 kg" / "850 g" */
export function grams(n: number | null | undefined): string {
  if (n === null || n === undefined || isNaN(Number(n))) return '—';
  const v = Math.round(Number(n));
  return Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(2)} kg` : `${v} g`;
}

export const signedGrams = (n: number | null | undefined) =>
  n === null || n === undefined ? '—' : `${Number(n) > 0 ? '+' : ''}${grams(n)}`;

export function toReportRows(data: unknown): BRReportRow[] {
  return ((data || []) as BRReportRow[]).map(r => ({
    ...r,
    opening: r.opening === null ? null : Number(r.opening),
    closing: r.closing === null ? null : Number(r.closing),
    used: r.used === null ? null : Number(r.used),
    gap: r.gap === null ? null : Number(r.gap),
    prev_closing: r.prev_closing === null ? null : Number(r.prev_closing),
    overnight_change: r.overnight_change === null ? null : Number(r.overnight_change),
    received: Number(r.received), sold: Number(r.sold), wasted: Number(r.wasted), allowance: Number(r.allowance),
  }));
}