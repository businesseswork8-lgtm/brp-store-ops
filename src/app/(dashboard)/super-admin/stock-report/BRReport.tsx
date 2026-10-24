'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatDateTime, isLateNightShift } from '@/lib/dates';
import { BR_STATUS, BRReportRow, BRPeriodReportRow, boxesLabel, grams, signedGrams, toReportRows, repairLateNightBRCounts } from '@/lib/br';
import { EMPTY_BOX_GRAMS, FULL_BOX_GRAMS } from '@/lib/icecream';
import styles from '../super-admin.module.css';

const fmtDate = (ymd: string) =>
  new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

type PeriodMode = '1d' | '7d' | '15d' | '30d' | 'custom';

type InventoryItem = {
  item_id: string;
  name: string;
  range_name: string;
  unopened_boxes: number;
  open_box_gross: number;
  net_grams: number;
  last_session: string;
  last_date: string;
  staff_name: string;
};

type CountRecord = {
  item_id: string;
  count_date: string;
  session: string;
  unopened_boxes: number;
  open_box_gross: number;
  grams: number;
  created_at: string;
  updated_at: string;
  staff_members?: { name: string } | null;
};

/**
 * Robust helper: Find the most accurate physical count representing the start of a period window.
 */
function findStartCount(counts: CountRecord[], targetFrom: string): CountRecord | null {
  // 1. Exact opening on targetFrom
  const op = counts.find(c => c.count_date === targetFrom && c.session === 'opening');
  if (op) return op;
  // 2. Closing on previous night (targetFrom - 1)
  const prevClosing = counts.find(c => c.count_date === addDays(targetFrom, -1) && c.session === 'closing');
  if (prevClosing) return prevClosing;
  // 3. Closing on targetFrom
  const cl = counts.find(c => c.count_date === targetFrom && c.session === 'closing');
  if (cl) return cl;
  // 4. Earliest available count on or after targetFrom
  const after = counts.filter(c => c.count_date >= targetFrom).sort((a, b) => a.count_date.localeCompare(b.count_date) || (a.session === 'opening' ? -1 : 1));
  if (after.length > 0) return after[0];
  // 5. Latest available count prior to targetFrom
  const before = counts.filter(c => c.count_date < targetFrom).sort((a, b) => b.count_date.localeCompare(a.count_date) || (b.session === 'closing' ? -1 : 1));
  if (before.length > 0) return before[0];
  return null;
}

/**
 * Robust helper: Find the most accurate physical count representing the end of a period window.
 */
function findEndCount(counts: CountRecord[], targetTo: string): CountRecord | null {
  // 1. Closing on targetTo
  const cl = counts.find(c => c.count_date === targetTo && c.session === 'closing');
  if (cl) return cl;
  // 2. Opening on targetTo (represents physical stock at end of targetTo - 1 / start of targetTo)
  const op = counts.find(c => c.count_date === targetTo && c.session === 'opening');
  if (op) return op;
  // 3. Latest count on or before targetTo (prefer closing over opening on the same date)
  const before = counts
    .filter(c => c.count_date <= targetTo)
    .sort((a, b) => b.count_date.localeCompare(a.count_date) || (b.session === 'closing' ? -1 : 1));
  if (before.length > 0) return before[0];
  return null;
}

/**
 * Fetch all flavour counts in a date range using pagination to avoid Supabase PostgREST's
 * default 1,000-row single-request cap on 15-day / 30-day views.
 */
async function fetchAllFlavourCounts(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string,
  fromDate: string,
  toDate: string
): Promise<CountRecord[]> {
  const pageSize = 1000;
  const all: CountRecord[] = [];
  for (let offset = 0; offset < 10000; offset += pageSize) {
    const { data, error } = await supabase
      .from('br_flavour_counts')
      .select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, created_at, updated_at, staff_members(name)')
      .eq('store_id', storeId)
      .gte('count_date', fromDate)
      .lte('count_date', toDate)
      .order('count_date', { ascending: true })
      .order('session', { ascending: true })
      .order('item_id', { ascending: true })
      .range(offset, offset + pageSize - 1);
    if (error || !data || data.length === 0) break;
    all.push(...(data as unknown as CountRecord[]));
    if (data.length < pageSize) break;
  }
  return all;
}

/** Baskin Robbins: Daily shift & Multi-Day periodic reconciliation report + Current inventory on hand. */
export function BRReport() {
  const { supabase, store, profile } = useActiveStore();
  const activeShiftDate = istDate();
  const prevShiftDate = addDays(activeShiftDate, -1);
  const isLateNight = isLateNightShift();

  const [activeTab, setActiveTab] = useState<'reconciliation' | 'inventory'>('reconciliation');
  const [period, setPeriod] = useState<PeriodMode>('1d');
  const [date, setDate] = useState(activeShiftDate);
  const [customFrom, setCustomFrom] = useState(addDays(activeShiftDate, -6));
  const [customTo, setCustomTo] = useState(activeShiftDate);

  // Active range dates
  const activeFrom = period === '1d'
    ? date
    : period === '7d'
      ? addDays(date, -6)
      : period === '15d'
        ? addDays(date, -14)
        : period === '30d'
          ? addDays(date, -29)
          : customFrom;

  const activeTo = period === '1d' ? date : period === 'custom' ? customTo : date;

  // Single-day shift data
  const [rows, setRows] = useState<BRReportRow[]>([]);
  // Multi-day period data
  const [periodRows, setPeriodRows] = useState<BRPeriodReportRow[]>([]);
  const [periodMeta, setPeriodMeta] = useState<{
    totalDays: number;
    salesDaysCount: number;
    totalNetSales: number;
    totalReceivedGrams: number;
    totalReceivedBoxes: number;
    totalSoldGrams: number;
    totalWastedGrams: number;
    hasAnySales: boolean;
  }>({
    totalDays: 1,
    salesDaysCount: 0,
    totalNetSales: 0,
    totalReceivedGrams: 0,
    totalReceivedBoxes: 0,
    totalSoldGrams: 0,
    totalWastedGrams: 0,
    hasAnySales: false,
  });

  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [invSearch, setInvSearch] = useState('');

  const [countsForDate, setCountsForDate] = useState<Record<string, Record<'opening' | 'closing', { unopened_boxes: number; open_box_gross: number }>>>({});
  const [shiftMeta, setShiftMeta] = useState<{
    openingCount: number;
    openingTime: string | null;
    openingStaff: string | null;
    closingCount: number;
    closingTime: string | null;
    closingStaff: string | null;
    salesNet: number | null;
    salesTime: string | null;
    hasSummary: boolean;
    hasItems: boolean;
  }>({
    openingCount: 0,
    openingTime: null,
    openingStaff: null,
    closingCount: 0,
    closingTime: null,
    closingStaff: null,
    salesNet: null,
    salesTime: null,
    hasSummary: false,
    hasItems: false,
  });

  const [editModal, setEditModal] = useState<{
    item_id: string;
    flavour: string;
    count_date: string;
    session: 'opening' | 'closing';
    unopened_boxes: number;
    open_box_gross: number;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Read ?date=YYYY-MM-DD if navigated from All Stores
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const qDate = params.get('date');
      if (qDate && /^\d{4}-\d{2}-\d{2}$/.test(qDate)) {
        setDate(qDate);
        setPeriod('1d');
        setActiveTab('reconciliation');
      }
    }
  }, []);

  const openEditModal = (
    item_id: string,
    flavour: string,
    session: 'opening' | 'closing',
    targetDate = date,
    initialBoxes?: number,
    initialGross?: number
  ) => {
    const existing = countsForDate[item_id]?.[session];
    const unopened = initialBoxes !== undefined ? initialBoxes : (existing?.unopened_boxes || 0);
    const gross = initialGross !== undefined ? initialGross : (existing?.open_box_gross || 0);
    setEditModal({
      item_id,
      flavour,
      count_date: targetDate,
      session,
      unopened_boxes: unopened,
      open_box_gross: gross,
    });
  };

  const handleSaveEdit = async () => {
    if (!store || !editModal) return;
    setSavingEdit(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const unopened = Number(editModal.unopened_boxes) || 0;
      const gross = Number(editModal.open_box_gross) || 0;
      const openNet = gross > 0 ? Math.max(0, gross - EMPTY_BOX_GRAMS) : 0;
      const computedGrams = unopened * FULL_BOX_GRAMS + openNet;

      const { error } = await supabase.from('br_flavour_counts').upsert({
        store_id: store.id,
        item_id: editModal.item_id,
        count_date: editModal.count_date,
        session: editModal.session,
        unopened_boxes: unopened,
        open_box_gross: gross,
        grams: computedGrams,
        submitted_by_profile_id: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id,item_id,count_date,session' });

      if (error) throw error;
      setEditModal(null);
      await load();
    } catch (err) {
      console.error(err);
      alert('Could not save count correction.');
    } finally {
      setSavingEdit(false);
    }
  };

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    setError(null);

    try {
      await repairLateNightBRCounts(supabase, store.id);

      if (period === '1d') {
        // SINGLE DAY RECONCILIATION
        const [
          { data: reportData, error: e },
          { data: lines },
          { data: flvRows },
          { data: recentCounts },
          { data: dateCounts },
          { data: salesSummary },
        ] = await Promise.all([
          supabase.rpc('br_daily_report', { p_store_id: store.id, p_date: date }),
          supabase.rpc('br_sales_lines', { p_store_id: store.id, p_from: date, p_to: date }),
          supabase.from('items')
            .select('id, name, item_categories!inner(brand_id, is_flavour, name, sort_order)')
            .eq('is_active', true)
            .eq('item_categories.brand_id', store.brand_id)
            .eq('item_categories.is_flavour', true)
            .order('name'),
          supabase.from('br_flavour_counts')
            .select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, created_at, updated_at, staff_members(name)')
            .eq('store_id', store.id)
            .order('count_date', { ascending: false })
            .limit(500),
          supabase.from('br_flavour_counts')
            .select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, created_at, updated_at, staff_members(name)')
            .eq('store_id', store.id)
            .eq('count_date', date),
          supabase.from('daily_sales_summary')
            .select('net_sales, has_summary, has_items, created_at')
            .eq('store_id', store.id)
            .eq('entry_date', date)
            .maybeSingle(),
        ]);

        setError(e ? e.message : null);
        setRows(e ? [] : toReportRows(reportData));
        setUnmatched(((lines || []) as { matched_by: string }[]).filter(l => l.matched_by === 'none' || l.matched_by === 'no_flavour').length);

        const countsMap: Record<string, Record<'opening' | 'closing', { unopened_boxes: number; open_box_gross: number }>> = {};
        let openCount = 0;
        let closeCount = 0;
        let latestOpenIso: string | null = null;
        let latestCloseIso: string | null = null;
        let openStaff: string | null = null;
        let closeStaff: string | null = null;

        (dateCounts || []).forEach(c => {
          if (!countsMap[c.item_id]) {
            countsMap[c.item_id] = {
              opening: { unopened_boxes: 0, open_box_gross: 0 },
              closing: { unopened_boxes: 0, open_box_gross: 0 },
            };
          }
          const ses = c.session as 'opening' | 'closing';
          countsMap[c.item_id][ses] = {
            unopened_boxes: Number(c.unopened_boxes) || 0,
            open_box_gross: Number(c.open_box_gross) || 0,
          };
          const t = c.updated_at || c.created_at;
          const staffName = (c as unknown as { staff_members?: { name: string } }).staff_members?.name || null;
          if (ses === 'opening') {
            openCount += 1;
            if (t && (!latestOpenIso || t > latestOpenIso)) latestOpenIso = t;
            if (staffName && !openStaff) openStaff = staffName;
          } else if (ses === 'closing') {
            closeCount += 1;
            if (t && (!latestCloseIso || t > latestCloseIso)) latestCloseIso = t;
            if (staffName && !closeStaff) closeStaff = staffName;
          }
        });
        setCountsForDate(countsMap);

        setShiftMeta({
          openingCount: openCount,
          openingTime: latestOpenIso ? formatDateTime(latestOpenIso) : null,
          openingStaff: openStaff,
          closingCount: closeCount,
          closingTime: latestCloseIso ? formatDateTime(latestCloseIso) : null,
          closingStaff: closeStaff,
          salesNet: salesSummary && salesSummary.has_summary !== false ? Number(salesSummary.net_sales) : null,
          salesTime: salesSummary?.created_at ? formatDateTime(salesSummary.created_at) : null,
          hasSummary: Boolean(salesSummary && salesSummary.has_summary !== false),
          hasItems: Boolean(salesSummary?.has_items),
        });

        // Build live freezer inventory
        const latestByItem: Record<string, {
          count_date: string; session: string; unopened_boxes: number; open_box_gross: number; grams: number; staff_name: string;
        }> = {};

        (recentCounts || []).forEach(c => {
          if (!latestByItem[c.item_id]) {
            latestByItem[c.item_id] = {
              count_date: c.count_date,
              session: c.session,
              unopened_boxes: Number(c.unopened_boxes) || 0,
              open_box_gross: Number(c.open_box_gross) || 0,
              grams: Number(c.grams) || 0,
              staff_name: (c as unknown as { staff_members?: { name: string } }).staff_members?.name || '',
            };
          }
        });

        const invList: InventoryItem[] = ((flvRows || []) as unknown as { id: string; name: string; item_categories: { name: string; sort_order: number } }[])
          .map(f => {
            const c = latestByItem[f.id];
            return {
              item_id: f.id,
              name: f.name,
              range_name: f.item_categories?.name || 'Ice Cream',
              unopened_boxes: c?.unopened_boxes ?? 0,
              open_box_gross: c?.open_box_gross ?? 0,
              net_grams: c?.grams ?? 0,
              last_session: c?.session ?? 'none',
              last_date: c?.count_date ?? '',
              staff_name: c?.staff_name ?? '',
            };
          })
          .sort((a, b) => b.net_grams - a.net_grams || a.name.localeCompare(b.name));

        setInventory(invList);
      } else {
        // MULTI-DAY PERIOD RECONCILIATION (7d, 15d, 30d, custom)
        const [
          counts,
          { data: salesSummaries },
          { data: deliveries },
          { data: wastages },
          { data: flvRows },
          { data: recentCounts },
        ] = await Promise.all([
          fetchAllFlavourCounts(supabase, store.id, addDays(activeFrom, -3), activeTo),
          supabase.from('daily_sales_summary')
            .select('entry_date, net_sales, has_summary, has_items, created_at')
            .eq('store_id', store.id)
            .gte('entry_date', activeFrom)
            .lte('entry_date', activeTo),
          supabase.from('purchase_orders')
            .select('item_id, quantity, boxes, movement, entry_date')
            .eq('store_id', store.id)
            .gte('entry_date', activeFrom)
            .lte('entry_date', activeTo)
            .limit(2000),
          supabase.from('daily_wastage_log')
            .select('item_id, quantity_wasted, entry_date')
            .eq('store_id', store.id)
            .gte('entry_date', activeFrom)
            .lte('entry_date', activeTo)
            .limit(2000),
          supabase.from('items')
            .select('id, name, code, tasting_allowance_grams, item_categories!inner(brand_id, is_flavour, name, sort_order)')
            .eq('is_active', true)
            .eq('item_categories.brand_id', store.brand_id)
            .eq('item_categories.is_flavour', true)
            .order('name'),
          supabase.from('br_flavour_counts')
            .select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, created_at, updated_at, staff_members(name)')
            .eq('store_id', store.id)
            .order('count_date', { ascending: false })
            .limit(1000),
        ]);

        // Bound POS sales to the actual counted date window:
        // - If activeFrom is before the store's earliest physical count, start from the earliest count date.
        // - If activeTo has no closing counts yet (only opening counts), completed shift sales end on activeTo - 1.
        const hasCountOnOrBeforeStart = counts.some(c => c.count_date <= activeFrom);
        const earliestCountDate = counts.length > 0 ? counts[0].count_date : activeFrom;
        const effectiveSalesFrom = hasCountOnOrBeforeStart ? activeFrom : (earliestCountDate > activeFrom ? earliestCountDate : activeFrom);

        const hasClosingOnEnd = counts.some(c => c.count_date === activeTo && c.session === 'closing');
        const effectiveSalesTo = hasClosingOnEnd || activeTo <= effectiveSalesFrom ? activeTo : addDays(activeTo, -1);

        const { data: lines, error: linesErr } = await supabase.rpc('br_sales_lines', {
          p_store_id: store.id,
          p_from: effectiveSalesFrom,
          p_to: effectiveSalesTo,
        });

        if (linesErr) setError(linesErr.message);

        const salesLinesList = (lines || []) as unknown as Array<{ item_id: string | null; grams: number; matched_by: string }>;
        setUnmatched(salesLinesList.filter(l => l.matched_by === 'none' || l.matched_by === 'no_flavour').length);

        const numDays = Math.max(1, Math.round((new Date(effectiveSalesTo + 'T00:00:00Z').getTime() - new Date(effectiveSalesFrom + 'T00:00:00Z').getTime()) / 86400000) + 1);

        const summaries = (salesSummaries || []).filter(s => s.entry_date >= effectiveSalesFrom && s.entry_date <= effectiveSalesTo);
        const salesDaysCount = summaries.filter(s => s.has_items || Number(s.net_sales) > 0).length;
        const totalNetSales = summaries.reduce((t, s) => t + (Number(s.net_sales) || 0), 0);
        const hasAnySales = summaries.some(s => s.has_items);

        type FlvItem = {
          id: string;
          name: string;
          code: string | null;
          tasting_allowance_grams?: number;
          item_categories: { name: string; sort_order: number };
        };

        const flvItems = (flvRows || []) as unknown as FlvItem[];

        let totReceivedGrams = 0;
        let totReceivedBoxes = 0;
        let totSoldGrams = 0;
        let totWastedGrams = 0;

        const calculatedPeriodRows: BRPeriodReportRow[] = flvItems.map(f => {
          const itemCounts = counts.filter(c => c.item_id === f.id);
          const rawStartC = findStartCount(itemCounts, activeFrom);
          const rawEndC = findEndCount(itemCounts, activeTo);

          // Determine the exact completed business-day window [effFrom, effTo] bounded by startC and endC:
          // - An 'opening' count on day D is weighed BEFORE day D's deliveries/sales.
          // - A 'closing' count on day D is weighed AFTER day D's deliveries/sales.
          const effFrom = rawStartC
            ? (rawStartC.session === 'opening' ? rawStartC.count_date : addDays(rawStartC.count_date, 1))
            : activeFrom;
          const effTo = rawEndC
            ? (rawEndC.session === 'opening' ? addDays(rawEndC.count_date, -1) : rawEndC.count_date)
            : activeTo;

          const hasCompletedWindow = Boolean(rawStartC && rawEndC && effFrom <= effTo);
          const startC = rawStartC;
          const endC = hasCompletedWindow ? rawEndC : null;

          const delivs = (deliveries || []).filter(d =>
            d.item_id === f.id &&
            (hasCompletedWindow
              ? (d.entry_date >= effFrom && d.entry_date <= effTo)
              : (d.entry_date >= activeFrom && d.entry_date <= activeTo))
          );
          const receivedGrams = delivs.reduce((sum, d) => sum + (d.movement === 'transfer_out' ? -Number(d.quantity || 0) : Number(d.quantity || 0)), 0);
          const receivedBoxes = delivs.reduce((sum, d) => sum + (d.movement === 'transfer_out' ? -Number(d.boxes || 0) : Number(d.boxes || 0)), 0);

          const wasts = (wastages || []).filter(w =>
            w.item_id === f.id &&
            (hasCompletedWindow
              ? (w.entry_date >= effFrom && w.entry_date <= effTo)
              : (w.entry_date >= activeFrom && w.entry_date <= activeTo))
          );
          const wastedGrams = wasts.reduce((sum, w) => sum + Number(w.quantity_wasted || 0), 0);

          const soldGrams = hasCompletedWindow
            ? salesLinesList.filter(l => l.item_id === f.id).reduce((sum, l) => sum + Number(l.grams || 0), 0)
            : 0;

          totReceivedGrams += receivedGrams;
          totReceivedBoxes += receivedBoxes;
          totSoldGrams += soldGrams;
          totWastedGrams += wastedGrams;

          const startGrams = startC ? Number(startC.grams) : null;
          const endGrams = endC ? Number(endC.grams) : null;
          const isCounted = startGrams !== null && endGrams !== null;

          const used = isCounted ? startGrams + receivedGrams - endGrams : null;
          const expected = startGrams !== null ? startGrams + receivedGrams - soldGrams - wastedGrams : null;
          const gap = used !== null ? used - soldGrams - wastedGrams : null;

          const allowDaily = Number(f.tasting_allowance_grams || 0);
          const allowance = allowDaily > 0 ? allowDaily * numDays : Math.round(soldGrams * 0.05);
          const netShortage = (gap ?? 0) - allowance;
          const isOver = isCounted && netShortage >= 50;
          const shortageGrams = isOver ? netShortage : 0;

          const hasAnyActivity = (startGrams !== null && startGrams > 0) || (endGrams !== null && endGrams > 0) || receivedGrams > 0 || soldGrams > 0 || wastedGrams > 0;
          const isNeverCountedBeforePeriod = itemCounts.every(c => c.count_date > activeTo);

          const status: BRPeriodReportRow['status'] = (!hasAnyActivity && isNeverCountedBeforePeriod)
            ? 'NOT_INTRODUCED'
            : !isCounted
              ? 'NOT_COUNTED'
              : !hasAnySales
                ? 'NO_SALES'
                : isOver
                  ? 'OVER'
                  : (gap ?? 0) < -allowance - 50
                    ? 'CHECK'
                    : 'OK';

          return {
            item_id: f.id,
            code: f.code,
            flavour: f.name,
            range_name: f.item_categories?.name || 'Ice Cream',
            is_gelato: /gelato/i.test(f.item_categories?.name || ''),
            opening: startGrams,
            opening_date: startC?.count_date ?? null,
            opening_session: startC?.session ?? null,
            opening_unopened_boxes: startC ? Number(startC.unopened_boxes) || 0 : 0,
            opening_open_box_gross: startC ? Number(startC.open_box_gross) || 0 : 0,
            received: receivedGrams,
            received_boxes: receivedBoxes,
            closing: endGrams,
            closing_date: endC?.count_date ?? null,
            closing_session: endC?.session ?? null,
            closing_unopened_boxes: endC ? Number(endC.unopened_boxes) || 0 : 0,
            closing_open_box_gross: endC ? Number(endC.open_box_gross) || 0 : 0,
            used,
            sold: soldGrams,
            wasted: wastedGrams,
            expected_closing: expected,
            gap,
            allowance,
            shortageGrams,
            status,
          };
        });

        setPeriodRows(calculatedPeriodRows);
        setPeriodMeta({
          totalDays: numDays,
          salesDaysCount,
          totalNetSales,
          totalReceivedGrams: totReceivedGrams,
          totalReceivedBoxes: totReceivedBoxes,
          totalSoldGrams: totSoldGrams,
          totalWastedGrams: totWastedGrams,
          hasAnySales,
        });

        // Live inventory
        const latestByItem: Record<string, {
          count_date: string; session: string; unopened_boxes: number; open_box_gross: number; grams: number; staff_name: string;
        }> = {};

        (recentCounts || []).forEach(c => {
          if (!latestByItem[c.item_id]) {
            latestByItem[c.item_id] = {
              count_date: c.count_date,
              session: c.session,
              unopened_boxes: Number(c.unopened_boxes) || 0,
              open_box_gross: Number(c.open_box_gross) || 0,
              grams: Number(c.grams) || 0,
              staff_name: (c as unknown as { staff_members?: { name: string } }).staff_members?.name || '',
            };
          }
        });

        const invList: InventoryItem[] = flvItems
          .map(f => {
            const c = latestByItem[f.id];
            return {
              item_id: f.id,
              name: f.name,
              range_name: f.item_categories?.name || 'Ice Cream',
              unopened_boxes: c?.unopened_boxes ?? 0,
              open_box_gross: c?.open_box_gross ?? 0,
              net_grams: c?.grams ?? 0,
              last_session: c?.session ?? 'none',
              last_date: c?.count_date ?? '',
              staff_name: c?.staff_name ?? '',
            };
          })
          .sort((a, b) => b.net_grams - a.net_grams || a.name.localeCompare(b.name));

        setInventory(invList);
      }
    } catch (err) {
      console.error(err);
      setError('Could not load data: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setLoading(false);
    }
  }, [supabase, store, period, date, activeFrom, activeTo]);

  useEffect(() => { load(); }, [load]);

  // Calculations for Single Day
  const effectiveAllowance = (r: BRReportRow) => (r.allowance > 0 ? r.allowance : Math.round(r.sold * 0.05));
  const rowsWithCalc = rows.map(r => {
    const allow = effectiveAllowance(r);
    const gap = r.gap ?? 0;
    const isCounted = r.opening !== null && r.closing !== null;
    const netShortage = gap - allow;
    const isOver = isCounted && netShortage >= 50;
    const shortageGrams = isOver ? netShortage : 0;
    return {
      ...r,
      calculatedAllowance: allow,
      shortageGrams,
      computedStatus: (!isCounted ? 'NOT_COUNTED' : isOver ? 'OVER' : gap < -allow - 50 ? 'CHECK' : 'OK') as BRReportRow['status'],
    };
  });

  const over1d = rowsWithCalc.filter(r => r.shortageGrams > 0);
  const totalShortageGrams1d = over1d.reduce((t, r) => t + r.shortageGrams, 0);
  const totalAllowanceGrams1d = rowsWithCalc.reduce((t, r) => t + r.calculatedAllowance, 0);
  const noSales1d = !shiftMeta.hasItems && rows.some(r => r.status === 'NO_SALES');
  const overnight1d = rows.filter(r => r.overnight_change !== null && r.overnight_change < -50);

  const shown1d = rowsWithCalc.filter(r => {
    if (onlyProblems && !(r.computedStatus === 'OVER' || r.computedStatus === 'CHECK' || (r.overnight_change ?? 0) < -50)) return false;
    if (searchQuery.trim() && !r.flavour.toLowerCase().includes(searchQuery.toLowerCase()) && !r.range_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });
  const totalSold1d = rows.reduce((t, r) => t + r.sold, 0);

  // Calculations for Multi-Day Period
  const overPeriod = periodRows.filter(r => r.shortageGrams > 0);
  const totalShortageGramsPeriod = overPeriod.reduce((t, r) => t + r.shortageGrams, 0);
  const totalAllowanceGramsPeriod = periodRows.reduce((t, r) => t + r.allowance, 0);

  const shownPeriod = periodRows.filter(r => {
    if (onlyProblems && !(r.status === 'OVER' || r.status === 'CHECK')) return false;
    if (searchQuery.trim() && !r.flavour.toLowerCase().includes(searchQuery.toLowerCase()) && !r.range_name.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  });

  // Current inventory totals
  const totalBoxes = inventory.reduce((t, i) => t + i.unopened_boxes, 0);
  const totalInventoryGrams = inventory.reduce((t, i) => t + i.net_grams, 0);
  const flavoursWithStock = inventory.filter(i => i.net_grams > 0).length;

  const filteredInventory = inventory.filter(i =>
    !invSearch.trim() || i.name.toLowerCase().includes(invSearch.toLowerCase()) || i.range_name.toLowerCase().includes(invSearch.toLowerCase())
  );

  return (
    <div>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>🍨 Ice Cream Stock Report — {store?.name}</h1>
          <p className={styles.subtitle}>
            1 packed box = {FULL_BOX_GRAMS} g · Empty box tare = {EMPTY_BOX_GRAMS} g (auto-deducted).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href={`/store/eod-report?date=${date}`} className={styles.secondaryButton} style={{ textDecoration: 'none' }}>
            🖨️ Full Day Summary ({shortDate(date)})
          </Link>
        </div>
      </div>

      {/* Main Navigation Tabs */}
      <div className={styles.tabBar}>
        <button
          className={activeTab === 'reconciliation' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('reconciliation')}
        >
          📊 Reconciliation (Daily &amp; Period Audit)
        </button>
        <button
          className={activeTab === 'inventory' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('inventory')}
        >
          📦 Live Freezer Inventory ({flavoursWithStock}/{inventory.length})
        </button>
      </div>

      {/* TAB 1: RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <>
          {/* Period Selector & Navigation Card */}
          <div className={styles.card} style={{ marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
                  Reconciliation Analysis Window
                </div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  {period === '1d' ? (
                    <>
                      <span>📅 Shift: {displayDate(date)}</span>
                      {date === activeShiftDate && isLateNight && (
                        <span style={{ fontSize: '0.76rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255,214,0,0.12)', color: 'var(--warning)', border: '1px solid rgba(255,214,0,0.3)' }}>
                          🌙 Post-midnight closing active
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <span>🗓️ Period: {shortDate(activeFrom)} – {shortDate(activeTo)}</span>
                      <span style={{ fontSize: '0.8rem', padding: '0.15rem 0.5rem', borderRadius: '6px', background: 'rgba(255,107,53,0.15)', color: 'var(--accent-primary)', fontWeight: 700 }}>
                        {periodMeta.totalDays} Days
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* 1-Tap Period Filter Pills */}
              <div className={styles.periodPills}>
                <button
                  type="button"
                  className={`${styles.periodPill} ${period === '1d' ? styles.periodPillActive : ''}`}
                  onClick={() => setPeriod('1d')}
                >
                  📅 1 Day (Shift)
                </button>
                <button
                  type="button"
                  className={`${styles.periodPill} ${period === '7d' ? styles.periodPillActive : ''}`}
                  onClick={() => setPeriod('7d')}
                >
                  ⚡ Last 7 Days
                </button>
                <button
                  type="button"
                  className={`${styles.periodPill} ${period === '15d' ? styles.periodPillActive : ''}`}
                  onClick={() => setPeriod('15d')}
                >
                  📊 15 Days
                </button>
                <button
                  type="button"
                  className={`${styles.periodPill} ${period === '30d' ? styles.periodPillActive : ''}`}
                  onClick={() => setPeriod('30d')}
                >
                  🗓️ 30 Days (Month)
                </button>
                <button
                  type="button"
                  className={`${styles.periodPill} ${period === 'custom' ? styles.periodPillActive : ''}`}
                  onClick={() => setPeriod('custom')}
                >
                  ⚙️ Custom
                </button>
              </div>
            </div>

            {/* Sub-controls depending on period mode */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', paddingTop: '0.5rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
              {period === '1d' ? (
                <div className={styles.reconciliationControls}>
                  <button
                    type="button"
                    className={date === prevShiftDate ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => setDate(prevShiftDate)}
                  >
                    ⏮️ Yesterday ({shortDate(prevShiftDate)})
                  </button>
                  <button
                    type="button"
                    className={date === activeShiftDate ? styles.primaryButton : styles.secondaryButton}
                    onClick={() => setDate(activeShiftDate)}
                  >
                    📅 Active Shift ({shortDate(activeShiftDate)})
                  </button>
                  <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, -1))} title="Previous day">‹</button>
                  <input type="date" className={styles.searchInput} value={date} max={activeShiftDate} onChange={e => e.target.value && setDate(e.target.value)} />
                  <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, 1))} disabled={date >= activeShiftDate} title="Next day">›</button>
                </div>
              ) : period === 'custom' ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>From:</label>
                  <input type="date" className={styles.searchInput} value={customFrom} max={customTo} onChange={e => e.target.value && setCustomFrom(e.target.value)} />
                  <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>To:</label>
                  <input type="date" className={styles.searchInput} value={customTo} max={activeShiftDate} onChange={e => e.target.value && setCustomTo(e.target.value)} />
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>Ending on:</span>
                  <button
                    type="button"
                    className={date === prevShiftDate ? styles.primaryButton : styles.secondaryButton}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => setDate(prevShiftDate)}
                  >
                    ⏮️ Yesterday
                  </button>
                  <button
                    type="button"
                    className={date === activeShiftDate ? styles.primaryButton : styles.secondaryButton}
                    style={{ fontSize: '0.8rem', padding: '0.3rem 0.6rem' }}
                    onClick={() => setDate(activeShiftDate)}
                  >
                    📅 Today
                  </button>
                  <button className={styles.secondaryButton} style={{ padding: '0.3rem 0.6rem' }} onClick={() => setDate(d => addDays(d, -1))} title="Previous day">‹</button>
                  <input type="date" className={styles.searchInput} value={date} max={activeShiftDate} onChange={e => e.target.value && setDate(e.target.value)} />
                  <button className={styles.secondaryButton} style={{ padding: '0.3rem 0.6rem' }} onClick={() => setDate(d => addDays(d, 1))} disabled={date >= activeShiftDate} title="Next day">›</button>
                </div>
              )}

              {/* Admin Clear Sales Helper (Only visible for 1d) */}
              {period === '1d' && !noSales1d && (profile?.role === 'super_admin' || profile?.role === 'admin') && (
                <button
                  className={styles.secondaryButton}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem', color: 'var(--danger)', borderColor: 'rgba(255,23,68,0.3)' }}
                  onClick={async () => {
                    if (!store) return;
                    if (!confirm(`Are you sure you want to remove all uploaded sales data for ${store.name} on ${date}? This will delete test dump records so you can re-upload clean files.`)) return;
                    setLoading(true);
                    try {
                      const { error } = await supabase.rpc('delete_sales_data', { p_store_id: store.id, p_date: date });
                      if (error) throw error;
                      await load();
                    } catch (err) {
                      console.error(err);
                      alert('Could not clear sales data: ' + (err instanceof Error ? err.message : String(err)));
                    } finally {
                      setLoading(false);
                    }
                  }}
                  title="Delete uploaded sales data for this date"
                >
                  🗑️ Clear Sales
                </button>
              )}
            </div>
          </div>

          {/* 4 STAT CARDS: Varies cleanly between 1 Day vs Multi-Day */}
          {period === '1d' ? (
            <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
              <div className={styles.statCard} style={{ borderLeft: `4px solid ${shiftMeta.openingCount >= rows.length && rows.length > 0 ? 'var(--success)' : 'var(--warning)'}` }}>
                <div className={styles.statLabel}>🌅 1. Opening Weigh ({shortDate(date)})</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: shiftMeta.openingCount >= rows.length && rows.length > 0 ? 'var(--success)' : undefined }}>
                  {shiftMeta.openingCount} / {rows.length} weighed
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {shiftMeta.openingTime ? (
                    <>🕒 Recorded: <strong>{shiftMeta.openingTime}</strong>{shiftMeta.openingStaff ? ` · by ${shiftMeta.openingStaff}` : ''}</>
                  ) : (
                    '⏳ Opening weigh not entered yet'
                  )}
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: `4px solid ${shiftMeta.closingCount >= rows.length && rows.length > 0 ? 'var(--success)' : 'var(--warning)'}` }}>
                <div className={styles.statLabel}>🌙 2. Closing Weigh ({shortDate(date)})</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: shiftMeta.closingCount >= rows.length && rows.length > 0 ? 'var(--success)' : undefined }}>
                  {shiftMeta.closingCount} / {rows.length} weighed
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {shiftMeta.closingTime ? (
                    <>🕒 Recorded: <strong>{shiftMeta.closingTime}</strong>{shiftMeta.closingStaff ? ` · by ${shiftMeta.closingStaff}` : ''}</>
                  ) : (
                    '⏳ Closing weigh pending (weighed after last bill)'
                  )}
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: `4px solid ${shiftMeta.hasItems ? 'var(--success)' : 'var(--warning)'}` }}>
                <div className={styles.statLabel}>📄 3. Rista POS Sales ({shortDate(date)})</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: shiftMeta.hasItems ? 'var(--success)' : undefined }}>
                  {shiftMeta.salesNet !== null ? inr(shiftMeta.salesNet) : shiftMeta.hasItems ? grams(totalSold1d) : 'Pending Upload'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {shiftMeta.hasItems ? (
                    <>Sold: <strong>{(totalSold1d / 1000).toFixed(2)} kg</strong>{shiftMeta.salesTime ? ` · 🕒 ${shiftMeta.salesTime}` : ''}</>
                  ) : (
                    '⏳ Upload Sales Summary + Sales By Items'
                  )}
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: `4px solid ${noSales1d ? 'var(--border-color)' : totalShortageGrams1d > 0 ? 'var(--danger)' : 'var(--success)'}` }}>
                <div className={styles.statLabel}>⚖️ 4. Shift Shortage (After 5% Allowance)</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: noSales1d ? 'var(--text-secondary)' : totalShortageGrams1d > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {noSales1d
                    ? 'Pending Sales'
                    : totalShortageGrams1d > 0
                      ? totalShortageGrams1d >= 1000
                        ? `${(totalShortageGrams1d / 1000).toFixed(2)} kg`
                        : `${Math.round(totalShortageGrams1d)} g`
                      : '0 g (None)'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {noSales1d
                    ? 'Awaiting Sales By Items upload'
                    : over1d.length > 0
                      ? `${over1d.length} flavour${over1d.length > 1 ? 's' : ''} over 5% allowance (${grams(totalAllowanceGrams1d)} allow.)`
                      : `All flavours within 5% allowance (${grams(totalAllowanceGrams1d)})`}
                </div>
              </div>
            </div>
          ) : (
            <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
              <div className={styles.statCard} style={{ borderLeft: '4px solid var(--accent-primary)' }}>
                <div className={styles.statLabel}>📦 Inward Deliveries Received</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem' }}>
                  {periodMeta.totalReceivedBoxes} boxes
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {(periodMeta.totalReceivedGrams / 1000).toFixed(2)} kg total bulk stock added
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: `4px solid ${periodMeta.salesDaysCount > 0 ? 'var(--success)' : 'var(--warning)'}` }}>
                <div className={styles.statLabel}>📄 Rista POS Sales ({periodMeta.salesDaysCount}/{periodMeta.totalDays} Days)</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: periodMeta.salesDaysCount > 0 ? 'var(--success)' : undefined }}>
                  {(periodMeta.totalSoldGrams / 1000).toFixed(2)} kg
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {periodMeta.totalNetSales > 0 ? `${inr(periodMeta.totalNetSales)} net revenue` : 'Upload Sales By Items'}
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: '4px solid var(--border-color)' }}>
                <div className={styles.statLabel}>🗑️ Logged Wastage</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem' }}>
                  {periodMeta.totalWastedGrams >= 1000 ? `${(periodMeta.totalWastedGrams / 1000).toFixed(2)} kg` : `${Math.round(periodMeta.totalWastedGrams)} g`}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  Damages, drops, or expired stock logged
                </div>
              </div>

              <div className={styles.statCard} style={{ borderLeft: `4px solid ${!periodMeta.hasAnySales ? 'var(--border-color)' : totalShortageGramsPeriod > 0 ? 'var(--danger)' : 'var(--success)'}` }}>
                <div className={styles.statLabel}>⚖️ Period Net Shortage ({periodMeta.totalDays} Days)</div>
                <div className={styles.statValue} style={{ fontSize: '1.35rem', color: !periodMeta.hasAnySales ? 'var(--text-secondary)' : totalShortageGramsPeriod > 0 ? 'var(--danger)' : 'var(--success)' }}>
                  {!periodMeta.hasAnySales
                    ? 'Pending Sales'
                    : totalShortageGramsPeriod > 0
                      ? totalShortageGramsPeriod >= 1000
                        ? `${(totalShortageGramsPeriod / 1000).toFixed(2)} kg`
                        : `${Math.round(totalShortageGramsPeriod)} g`
                      : '0 g (None)'}
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                  {!periodMeta.hasAnySales
                    ? 'Upload Sales By Items'
                    : overPeriod.length > 0
                      ? `${overPeriod.length} flavour${overPeriod.length > 1 ? 's' : ''} over 5% allowance (${grams(totalAllowanceGramsPeriod)} allow.)`
                      : `All flavours within 5% allowance (${grams(totalAllowanceGramsPeriod)})`}
                </div>
              </div>
            </div>
          )}

          {/* SHORTAGE BIFURCATION CARD */}
          {((period === '1d' && !noSales1d && over1d.length > 0) || (period !== '1d' && periodMeta.hasAnySales && overPeriod.length > 0)) && (
            <div className={styles.card} style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,23,68,0.3)', background: 'rgba(255,23,68,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--danger)', fontSize: '1.15rem' }}>
                    🚨 {period === '1d' ? 'Shift Shortage Bifurcation' : `Cumulative ${periodMeta.totalDays}-Day Shortage Bifurcation`} ({grams(period === '1d' ? totalShortageGrams1d : totalShortageGramsPeriod)} total)
                  </h3>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Consumption exceeded POS sales + 5% tasting allowance. Ranked by highest loss (grams &amp; kg):
                  </p>
                </div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th className={styles.stickyCol}>Flavour</th>
                      <th className={styles.alignRight}>Used from Tub</th>
                      <th className={styles.alignRight}>Sold (POS)</th>
                      <th className={styles.alignRight}>5% Allowance</th>
                      <th className={styles.alignRight}>Wasted</th>
                      <th className={styles.alignRight}>Shortage (g)</th>
                      <th className={styles.alignRight}>Shortage (kg)</th>
                      <th className={styles.alignCenter}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(period === '1d' ? over1d : overPeriod).sort((a, b) => b.shortageGrams - a.shortageGrams).map(r => (
                      <tr key={r.item_id} style={{ background: 'rgba(255,23,68,0.05)' }}>
                        <td className={styles.stickyCol} style={{ fontWeight: 600 }}>
                          {r.flavour}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div>
                        </td>
                        <td className={styles.alignRight}>{grams(r.used)}</td>
                        <td className={styles.alignRight}>{grams(r.sold)}</td>
                        <td className={styles.alignRight}>{grams('calculatedAllowance' in r ? r.calculatedAllowance : r.allowance)}</td>
                        <td className={styles.alignRight}>{r.wasted ? grams(r.wasted) : '—'}</td>
                        <td className={styles.alignRight} style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '1.05rem' }}>
                          +{grams(r.shortageGrams)}
                        </td>
                        <td className={styles.alignRight} style={{ fontWeight: 700, color: 'var(--danger)' }}>
                          +{(r.shortageGrams / 1000).toFixed(3)} kg
                        </td>
                        <td className={styles.alignCenter}>
                          <span className={styles.badgeDanger}>⚠ OVER LIMIT</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {error && <div className={styles.card} style={{ color: 'var(--danger)' }}>Could not load: {error}</div>}
          {period === '1d' && noSales1d && (
            <div className={styles.card} style={{ color: 'var(--warning)' }}>
              ⚠ Sales By Items is not uploaded for {fmtDate(date)} — sold is 0, so flavour sales consumption is pending.
            </div>
          )}
          {period !== '1d' && !periodMeta.hasAnySales && (
            <div className={styles.card} style={{ color: 'var(--warning)' }}>
              ⚠ No Sales By Items files uploaded for this period window — upload daily sales to compute sold consumption.
            </div>
          )}
          {unmatched > 0 && (
            <div className={styles.card}>
              ⚠ {unmatched} Rista sales line(s) aren&apos;t matched to a flavour + size.{' '}
              <Link href="/super-admin/items?brand=br&tab=matching" className={styles.secondaryButton}>Match them in Items</Link>
            </div>
          )}
          {period === '1d' && overnight1d.length > 0 && (
            <div className={styles.card}>
              🌙 Overnight drop (today&apos;s opening lower than last night&apos;s closing): {overnight1d.map(r => `${r.flavour} ${signedGrams(r.overnight_change)}`).join(', ')}
            </div>
          )}

          {/* Filter Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', margin: '0.5rem 0 1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flex: 1 }}>
              <input
                type="text"
                className={styles.searchInput}
                style={{ minWidth: 200, maxWidth: 320 }}
                placeholder="Search flavour…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
              />
              <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', fontSize: '0.88rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only show problems
              </label>
            </div>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Formula: <strong>Expected</strong> = Start + Received − Sold − Wasted · <strong>Gap</strong> = Used − Sold − Wasted
            </span>
          </div>

          {loading ? (
            <div className={styles.loading}>Loading reconciliation…</div>
          ) : period === '1d' ? (
            /* 1-DAY SHIFT TABLE */
            <div className={styles.card} style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Flavour</th>
                    <th className={styles.alignRight}>
                      🌅 Opening
                      {shiftMeta.openingTime && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)' }}>{shiftMeta.openingTime}</div>}
                    </th>
                    <th className={styles.alignRight}>Received</th>
                    <th className={styles.alignRight}>
                      🌙 Closing
                      {shiftMeta.closingTime && <div style={{ fontSize: '0.7rem', fontWeight: 400, color: 'var(--text-secondary)' }}>{shiftMeta.closingTime}</div>}
                    </th>
                    <th className={styles.alignRight}>Used</th>
                    <th className={styles.alignRight}>Sold (POS)</th>
                    <th className={styles.alignRight}>Wasted</th>
                    <th className={styles.alignRight}>Gap</th>
                    <th className={styles.alignRight}>Allowance (5%)</th>
                    <th className={styles.alignRight}>Overnight</th>
                    <th className={styles.alignCenter}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown1d.map(r => {
                    const st = BR_STATUS[r.computedStatus] || { label: r.computedStatus, cls: 'badgeDefault', help: '' };
                    const isOver = r.computedStatus === 'OVER';
                    return (
                      <tr key={r.item_id} className={isOver ? styles.tableRowOver : undefined}>
                        <td className={styles.stickyCol} style={{ fontWeight: 600 }}>
                          {r.flavour}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div>
                        </td>
                        <td className={styles.alignRight}>
                          <div className={styles.countCell}>
                            <span>{r.opening !== null ? grams(r.opening) : '—'}</span>
                            <button
                              className={styles.editCellBtn}
                              onClick={() => openEditModal(r.item_id, r.flavour, 'opening')}
                              title="Edit opening count"
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        </td>
                        <td className={styles.alignRight}>{r.received ? grams(r.received) : '—'}</td>
                        <td className={styles.alignRight}>
                          <div className={styles.countCell}>
                            <span>{r.closing !== null ? grams(r.closing) : <span style={{ color: 'var(--text-secondary)' }}>Pending weigh</span>}</span>
                            <button
                              className={styles.editCellBtn}
                              onClick={() => openEditModal(r.item_id, r.flavour, 'closing')}
                              title="Edit closing count"
                            >
                              ✏️ Edit
                            </button>
                          </div>
                        </td>
                        <td className={styles.alignRight}>{r.used !== null ? grams(r.used) : '—'}</td>
                        <td className={styles.alignRight}>{grams(r.sold)}</td>
                        <td className={styles.alignRight}>{r.wasted ? grams(r.wasted) : '—'}</td>
                        <td className={styles.alignRight} style={{ fontWeight: 600, color: isOver ? 'var(--danger)' : undefined }}>
                          {signedGrams(r.gap)}
                        </td>
                        <td className={styles.alignRight}>{grams(r.calculatedAllowance)}</td>
                        <td className={styles.alignRight} style={{ color: (r.overnight_change ?? 0) < -50 ? 'var(--warning)' : undefined }}>
                          {signedGrams(r.overnight_change)}
                        </td>
                        <td className={styles.alignCenter}>
                          <span className={styles[st.cls]} title={st.help}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* MULTI-DAY PERIOD TABLE (7d / 15d / 30d / Custom) */
            <div className={styles.card} style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Flavour</th>
                    <th className={styles.alignRight}>Starting Stock</th>
                    <th className={styles.alignRight}>Received (+)</th>
                    <th className={styles.alignRight}>Sold (POS) (-)</th>
                    <th className={styles.alignRight}>Wasted (-)</th>
                    <th className={styles.alignRight}>Expected</th>
                    <th className={styles.alignRight}>Actual Closing</th>
                    <th className={styles.alignRight}>Gap (Shortage)</th>
                    <th className={styles.alignRight}>Allowance (5%)</th>
                    <th className={styles.alignCenter}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shownPeriod.map(r => {
                    const st = BR_STATUS[r.status] || { label: r.status, cls: 'badgeDefault', help: '' };
                    const isOver = r.status === 'OVER';
                    return (
                      <tr key={r.item_id} className={isOver ? styles.tableRowOver : undefined}>
                        <td className={styles.stickyCol} style={{ fontWeight: 600 }}>
                          {r.flavour}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div>
                        </td>
                        <td className={styles.alignRight}>
                          <div className={styles.countCell}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{r.opening !== null ? grams(r.opening) : '—'}</div>
                              {r.opening !== null && r.opening_date && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                  {shortDate(r.opening_date)} {r.opening_session === 'opening' ? '🌅' : '🌙'}
                                </div>
                              )}
                            </div>
                            {r.opening_date && (
                              <button
                                className={styles.editCellBtn}
                                onClick={() => openEditModal(
                                  r.item_id,
                                  r.flavour,
                                  (r.opening_session as 'opening' | 'closing') || 'opening',
                                  r.opening_date!,
                                  r.opening_unopened_boxes,
                                  r.opening_open_box_gross
                                )}
                                title={`Edit opening count for ${r.flavour} on ${r.opening_date}`}
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={styles.alignRight}>
                          {r.received > 0 ? (
                            <>
                              <div style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>+{grams(r.received)}</div>
                              <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                {r.received_boxes ? `${r.received_boxes} box${r.received_boxes > 1 ? 'es' : ''}` : boxesLabel(r.received)}
                              </div>
                            </>
                          ) : '—'}
                        </td>
                        <td className={styles.alignRight}>
                          <div style={{ fontWeight: 600 }}>{grams(r.sold)}</div>
                          {r.sold > 0 && <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>{(r.sold / 1000).toFixed(2)} kg</div>}
                        </td>
                        <td className={styles.alignRight}>{r.wasted ? grams(r.wasted) : '—'}</td>
                        <td className={styles.alignRight} style={{ fontWeight: 600 }}>
                          {r.expected_closing !== null ? grams(r.expected_closing) : '—'}
                        </td>
                        <td className={styles.alignRight}>
                          <div className={styles.countCell}>
                            <div>
                              <div style={{ fontWeight: 600 }}>{r.closing !== null ? grams(r.closing) : '—'}</div>
                              {r.closing !== null && r.closing_date && (
                                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                                  {shortDate(r.closing_date)} {r.closing_session === 'closing' ? '🌙' : '🌅'}
                                </div>
                              )}
                            </div>
                            {r.closing_date && (
                              <button
                                className={styles.editCellBtn}
                                onClick={() => openEditModal(
                                  r.item_id,
                                  r.flavour,
                                  (r.closing_session as 'opening' | 'closing') || 'closing',
                                  r.closing_date!,
                                  r.closing_unopened_boxes,
                                  r.closing_open_box_gross
                                )}
                                title={`Edit closing count for ${r.flavour} on ${r.closing_date}`}
                              >
                                ✏️
                              </button>
                            )}
                          </div>
                        </td>
                        <td className={styles.alignRight} style={{ fontWeight: 700, color: isOver ? 'var(--danger)' : undefined }}>
                          {signedGrams(r.gap)}
                        </td>
                        <td className={styles.alignRight}>{grams(r.allowance)}</td>
                        <td className={styles.alignCenter}>
                          <span className={styles[st.cls]} title={st.help}>{st.label}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* TAB 2: CURRENT INVENTORY ON HAND */}
      {activeTab === 'inventory' && (
        <>
          <div className={styles.statGrid} style={{ marginBottom: '1.5rem' }}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Total Ice Cream in Store</div>
              <div className={styles.statValue}>{(totalInventoryGrams / 1000).toFixed(2)} kg</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Total Packed (Sealed) Boxes</div>
              <div className={styles.statValue}>{totalBoxes} boxes</div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Flavours in Stock</div>
              <div className={styles.statValue}>{flavoursWithStock} / {inventory.length}</div>
            </div>
          </div>

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              type="text"
              className={styles.searchInput}
              style={{ flex: 1, maxWidth: 350 }}
              placeholder="Search flavour or category…"
              value={invSearch}
              onChange={e => setInvSearch(e.target.value)}
            />
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Showing {filteredInventory.length} flavours
            </span>
          </div>

          {loading ? (
            <div className={styles.loading}>Loading inventory…</div>
          ) : (
            <div className={styles.card} style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.stickyCol}>Flavour</th>
                    <th className={styles.alignRight}>Packed Boxes ({FULL_BOX_GRAMS}g)</th>
                    <th className={styles.alignRight}>Scale Gross</th>
                    <th className={styles.alignRight}>Open Box Net</th>
                    <th className={styles.alignRight}>Total Stock (g)</th>
                    <th className={styles.alignRight}>Total Stock (kg)</th>
                    <th>Last Counted (Shift Date)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map(i => {
                    const openNet = i.open_box_gross > EMPTY_BOX_GRAMS ? i.open_box_gross - EMPTY_BOX_GRAMS : 0;
                    return (
                      <tr key={i.item_id}>
                        <td className={styles.stickyCol} style={{ fontWeight: 600 }}>
                          {i.name}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{i.range_name}</div>
                        </td>
                        <td className={styles.alignRight}>{i.unopened_boxes ? `${i.unopened_boxes} box${i.unopened_boxes > 1 ? 'es' : ''}` : '0'}</td>
                        <td className={styles.alignRight}>{i.open_box_gross ? `${i.open_box_gross.toLocaleString('en-IN')} g` : '—'}</td>
                        <td className={styles.alignRight}>{openNet > 0 ? `${openNet.toLocaleString('en-IN')} g` : '—'}</td>
                        <td className={styles.alignRight} style={{ fontWeight: 700, color: i.net_grams > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {i.net_grams.toLocaleString('en-IN')} g
                        </td>
                        <td className={styles.alignRight} style={{ fontWeight: 700, color: i.net_grams > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
                          {(i.net_grams / 1000).toFixed(2)} kg
                        </td>
                        <td style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                          {i.last_date ? (
                            <>
                              {i.last_date === activeShiftDate ? `Active Shift (${fmtDate(i.last_date)})` : fmtDate(i.last_date)}{' '}
                              {i.last_session === 'opening' ? '🌅 Opening' : '🌙 Closing'}
                              {i.staff_name ? ` by ${i.staff_name}` : ''}
                            </>
                          ) : (
                            'Never weighed'
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* EDIT MODAL FOR 1D SHIFT */}
      {editModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
        }}>
          <div className={styles.card} style={{ width: '100%', maxWidth: 440, padding: '1.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>
              ✏️ Edit {editModal.session === 'opening' ? 'Opening' : 'Closing'} Count
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
              Flavour: <strong>{editModal.flavour}</strong> · Date: <strong>{displayDate(editModal.count_date)}</strong>
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.25rem' }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Unopened Sealed Boxes (2,250 g each):
                </label>
                <input
                  type="number"
                  min="0"
                  className={styles.searchInput}
                  style={{ width: '100%' }}
                  value={editModal.unopened_boxes}
                  onChange={e => setEditModal({ ...editModal, unopened_boxes: parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0 })}
                  onWheel={e => e.currentTarget.blur()}
                  onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault(); }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Open Box on Scale (Scale Gross Weight):
                </label>
                <input
                  type="number"
                  min="0"
                  max="2500"
                  className={styles.searchInput}
                  style={{ width: '100%' }}
                  value={editModal.open_box_gross}
                  onChange={e => setEditModal({ ...editModal, open_box_gross: parseInt(e.target.value.replace(/[^0-9]/g, ''), 10) || 0 })}
                  onWheel={e => e.currentTarget.blur()}
                  onKeyDown={e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault(); }}
                />
                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem', display: 'block' }}>
                  Empty box tare of {EMPTY_BOX_GRAMS} g is deducted automatically.
                </span>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={() => setEditModal(null)}
                disabled={savingEdit}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primaryButton}
                onClick={handleSaveEdit}
                disabled={savingEdit}
              >
                {savingEdit ? 'Saving…' : 'Save Correction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
