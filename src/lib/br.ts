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

export type BRPeriodReportRow = {
  item_id: string;
  code: string | null;
  flavour: string;
  range_name: string;
  is_gelato: boolean;
  opening: number | null;
  opening_date: string | null;
  opening_session: string | null;
  received: number;
  received_boxes: number;
  closing: number | null;
  closing_date: string | null;
  closing_session: string | null;
  used: number | null;
  sold: number;
  wasted: number;
  expected_closing: number | null;
  gap: number | null;
  allowance: number;
  shortageGrams: number;
  status: 'OVER' | 'CHECK' | 'OK' | 'NO_SALES' | 'NOT_COUNTED';
};

export function boxesLabel(grams: number, fullBoxGrams = 2250): string {
  if (!grams || grams <= 0) return '0 boxes';
  const b = grams / fullBoxGrams;
  if (Math.abs(b - Math.round(b)) < 0.01) {
    const intB = Math.round(b);
    return `${intB} box${intB === 1 ? '' : 'es'}`;
  }
  return `${b.toFixed(1)} boxes`;
}

export type BRSalesLine = {
  sales_key: string; item_name: string; variant: string; item_type: string; category: string; quantity: number;
  item_id: string | null; flavour_name: string | null; size_id: string | null; size_name: string | null;
  grams_each: number | null; grams: number; matched_by: 'saved' | 'auto' | 'ignored' | 'skipped' | 'no_flavour' | 'none';
};

export const BR_STATUS: Record<BRReportRow['status'], { label: string; cls: 'badgeDanger' | 'badgeSuccess' | 'badgeDefault' | 'badgeWarning'; help: string }> = {
  OVER: { label: '⚠ OVER LIMIT', cls: 'badgeDanger', help: 'More ice cream gone than sales + wastage + tasting allowance explain.' },
  CHECK: { label: '🔍 CHECK GAIN', cls: 'badgeWarning', help: 'More ice cream left than expected — miscount, or a delivery not entered?' },
  OK: { label: '✓ OK', cls: 'badgeSuccess', help: 'Within allowance.' },
  NO_SALES: { label: '📊 Pending Sales', cls: 'badgeDefault', help: 'Sales By Items not uploaded for this day.' },
  NOT_COUNTED: { label: '⏳ Pending Weigh', cls: 'badgeDefault', help: 'Opening or closing weigh is missing.' },
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

/**
 * Self-healing repair for post-midnight closing counts that were previously saved
 * one day too early due to double-subtracting businessDate().
 * E.g. weighed at 3:00 AM on 11 Oct (shift date = 10 Oct), accidentally saved under 9 Oct.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function repairLateNightBRCounts(supabase: any, storeId: string): Promise<boolean> {
  try {
    const { businessDate, addDays, isLateNightShift } = await import('@/lib/dates');
    const cutoffDate = addDays(businessDate(), -5);
    const { data: rows } = await supabase
      .from('br_flavour_counts')
      .select('id, store_id, item_id, count_date, session, unopened_boxes, open_box_gross, grams, staff_member_id, submitted_by_profile_id, created_at, updated_at')
      .eq('store_id', storeId)
      .gte('count_date', cutoffDate);

    if (!rows || !rows.length) return false;

    type CountRow = {
      id: string; store_id: string; item_id: string; count_date: string; session: Session;
      unopened_boxes: number; open_box_gross: number; grams: number;
      staff_member_id: string | null; submitted_by_profile_id: string | null;
      created_at: string; updated_at: string;
    };

    const typedRows = rows as CountRow[];
    const existingClosingByDateItem = new Set(
      typedRows.filter(r => r.session === 'closing').map(r => `${r.count_date}:${r.item_id}`)
    );
    const openingByDateItem = new Map<string, CountRow>();
    typedRows.filter(r => r.session === 'opening').forEach(r => {
      openingByDateItem.set(`${r.count_date}:${r.item_id}`, r);
    });

    const toUpsert: Array<Record<string, unknown>> = [];
    const toRestoreOnPrevDay: Array<Record<string, unknown>> = [];
    const idsToDelete: string[] = [];

    for (const r of typedRows) {
      if (r.session !== 'closing') continue;
      const ts = r.updated_at || r.created_at;
      if (!ts) continue;
      const dt = new Date(ts);
      if (isNaN(dt.getTime()) || !isLateNightShift(dt)) continue;

      // True operating shift date for this post-midnight timestamp
      const trueShiftDate = businessDate(dt);
      // If it was saved one day earlier than the true shift date (double-subtraction bug)
      if (r.count_date === addDays(trueShiftDate, -1) && !existingClosingByDateItem.has(`${trueShiftDate}:${r.item_id}`)) {
        toUpsert.push({
          store_id: r.store_id,
          item_id: r.item_id,
          count_date: trueShiftDate,
          session: 'closing',
          unopened_boxes: Number(r.unopened_boxes) || 0,
          open_box_gross: Number(r.open_box_gross) || 0,
          grams: Number(r.grams) || 0,
          staff_member_id: r.staff_member_id,
          submitted_by_profile_id: r.submitted_by_profile_id,
          updated_at: ts,
        });

        // If the row was originally created on that earlier day and overwritten tonight,
        // restore it from trueShiftDate's opening count if available; otherwise if created tonight, remove the stray duplicate.
        const createdShift = r.created_at ? businessDate(new Date(r.created_at)) : trueShiftDate;
        const nextOpening = openingByDateItem.get(`${trueShiftDate}:${r.item_id}`);
        if (createdShift === r.count_date && nextOpening) {
          toRestoreOnPrevDay.push({
            store_id: r.store_id,
            item_id: r.item_id,
            count_date: r.count_date,
            session: 'closing',
            unopened_boxes: Number(nextOpening.unopened_boxes) || 0,
            open_box_gross: Number(nextOpening.open_box_gross) || 0,
            grams: Number(nextOpening.grams) || 0,
            staff_member_id: nextOpening.staff_member_id || r.staff_member_id,
            submitted_by_profile_id: nextOpening.submitted_by_profile_id || r.submitted_by_profile_id,
            updated_at: r.created_at,
          });
        } else if (createdShift === trueShiftDate) {
          idsToDelete.push(r.id);
        }
      }
    }

    if (toUpsert.length === 0) return false;

    const { error } = await supabase
      .from('br_flavour_counts')
      .upsert(toUpsert, { onConflict: 'store_id,item_id,count_date,session' });

    if (error) {
      console.warn('Could not auto-repair late-night BR counts:', error.message);
      return false;
    }

    if (toRestoreOnPrevDay.length > 0) {
      await supabase
        .from('br_flavour_counts')
        .upsert(toRestoreOnPrevDay, { onConflict: 'store_id,item_id,count_date,session' });
    }
    if (idsToDelete.length > 0) {
      await supabase.from('br_flavour_counts').delete().in('id', idsToDelete);
    }

    return true;
  } catch (e) {
    console.warn('repairLateNightBRCounts error:', e);
    return false;
  }
}