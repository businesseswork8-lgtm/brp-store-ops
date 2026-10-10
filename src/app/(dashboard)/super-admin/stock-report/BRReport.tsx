'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatDateTime, isLateNightShift } from '@/lib/dates';
import { BR_STATUS, BRReportRow, grams, signedGrams, toReportRows, repairLateNightBRCounts } from '@/lib/br';
import { EMPTY_BOX_GRAMS, FULL_BOX_GRAMS } from '@/lib/icecream';
import styles from '../super-admin.module.css';

const fmtDate = (ymd: string) =>
  new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

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

/** Baskin Robbins: Daily shift reconciliation report + Current inventory on hand. */
export function BRReport() {
  const { supabase, store, profile } = useActiveStore();
  const activeShiftDate = istDate();
  const prevShiftDate = addDays(activeShiftDate, -1);
  const isLateNight = isLateNightShift();

  // Default to Daily Shift Reconciliation so admin immediately sees Opening vs Closing vs Sales
  const [activeTab, setActiveTab] = useState<'reconciliation' | 'inventory'>('reconciliation');
  const [date, setDate] = useState(activeShiftDate);
  const [rows, setRows] = useState<BRReportRow[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
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
        setActiveTab('reconciliation');
      }
    }
  }, []);

  const openEditModal = (item_id: string, flavour: string, session: 'opening' | 'closing') => {
    const existing = countsForDate[item_id]?.[session] || { unopened_boxes: 0, open_box_gross: 0 };
    setEditModal({
      item_id,
      flavour,
      session,
      unopened_boxes: existing.unopened_boxes,
      open_box_gross: existing.open_box_gross,
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
        count_date: date,
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

      // Build current inventory on hand from the latest count of each flavour
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
    } catch (err) {
      console.error(err);
      setError('Could not load data.');
    } finally {
      setLoading(false);
    }
  }, [supabase, store, date]);

  useEffect(() => { load(); }, [load]);

  const effectiveAllowance = (r: BRReportRow) => (r.allowance > 0 ? r.allowance : Math.round(r.sold * 0.05));

  const rowsWithCalc = rows.map(r => {
    const allow = effectiveAllowance(r);
    const gap = r.gap ?? 0;
    const isCounted = r.opening !== null && r.closing !== null;
    const netShortage = gap - allow;
    // Require a practical minimum threshold of 50g (less than 1 small scoop) to trigger an OVER LIMIT shortage alert
    const isOver = isCounted && netShortage >= 50;
    const shortageGrams = isOver ? netShortage : 0;
    return {
      ...r,
      calculatedAllowance: allow,
      shortageGrams,
      computedStatus: (!isCounted ? 'NOT_COUNTED' : isOver ? 'OVER' : gap < -allow - 50 ? 'CHECK' : 'OK') as BRReportRow['status'],
    };
  });

  const over = rowsWithCalc.filter(r => r.shortageGrams > 0);
  const totalShortageGrams = over.reduce((t, r) => t + r.shortageGrams, 0);
  const totalAllowanceGrams = rowsWithCalc.reduce((t, r) => t + r.calculatedAllowance, 0);
  const noSales = !shiftMeta.hasItems && rows.some(r => r.status === 'NO_SALES');
  const overnight = rows.filter(r => r.overnight_change !== null && r.overnight_change < -50);
  const shown = onlyProblems ? rowsWithCalc.filter(r => r.computedStatus === 'OVER' || r.computedStatus === 'CHECK' || (r.overnight_change ?? 0) < -50) : rowsWithCalc;
  const totalSold = rows.reduce((t, r) => t + r.sold, 0);

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
            1 packed box = {FULL_BOX_GRAMS} g · Empty box tare = {EMPTY_BOX_GRAMS} g (automatically deducted).
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <Link href={`/store/eod-report?date=${date}`} className={styles.secondaryButton} style={{ textDecoration: 'none' }}>
            🖨️ Full Day Summary ({shortDate(date)})
          </Link>
        </div>
      </div>

      {/* Main Tabs: Daily Shift Report first so admin immediately sees Opening + Closing + Sales */}
      <div className={styles.tabBar}>
        <button
          className={activeTab === 'reconciliation' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('reconciliation')}
        >
          📊 Daily Shift Report (Opening vs Closing vs Sales)
        </button>
        <button
          className={activeTab === 'inventory' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '0.95rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('inventory')}
        >
          📦 Live Freezer Inventory ({flavoursWithStock}/{inventory.length})
        </button>
      </div>

      {/* TAB 1: DAILY SHIFT RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <>
          {/* Clear Sales Day Navigation Bar */}
          <div className={styles.card} style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
            <div>
              <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
                Viewing Sales Day / Shift Operating Date
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                <span>📅 {displayDate(date)}</span>
                {date === activeShiftDate && isLateNight && (
                  <span style={{ fontSize: '0.76rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: '6px', background: 'rgba(255,214,0,0.12)', color: 'var(--warning)', border: '1px solid rgba(255,214,0,0.3)' }}>
                    🌙 Post-midnight closing shift active
                  </span>
                )}
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                Opening weigh, post-midnight Closing weigh, and Rista POS Sales for this shift are all matched together below.
              </div>
            </div>

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
              {!noSales && (profile?.role === 'super_admin' || profile?.role === 'admin') && (
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

          {/* 4-Box Shift Activity & Exact Timestamps Banner */}
          <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
            {/* Box 1: Opening Weigh */}
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

            {/* Box 2: Closing Weigh */}
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

            {/* Box 3: Rista POS Sales */}
            <div className={styles.statCard} style={{ borderLeft: `4px solid ${shiftMeta.hasItems ? 'var(--success)' : 'var(--warning)'}` }}>
              <div className={styles.statLabel}>📄 3. Rista POS Sales ({shortDate(date)})</div>
              <div className={styles.statValue} style={{ fontSize: '1.35rem', color: shiftMeta.hasItems ? 'var(--success)' : undefined }}>
                {shiftMeta.salesNet !== null ? inr(shiftMeta.salesNet) : shiftMeta.hasItems ? grams(totalSold) : 'Pending Upload'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {shiftMeta.hasItems ? (
                  <>Sold: <strong>{(totalSold / 1000).toFixed(2)} kg</strong>{shiftMeta.salesTime ? ` · 🕒 ${shiftMeta.salesTime}` : ''}</>
                ) : (
                  '⏳ Upload Sales Summary + Sales By Items'
                )}
              </div>
            </div>

            {/* Box 4: Overall Shortage */}
            <div className={styles.statCard} style={{ borderLeft: `4px solid ${noSales ? 'var(--border-color)' : totalShortageGrams > 0 ? 'var(--danger)' : 'var(--success)'}` }}>
              <div className={styles.statLabel}>⚖️ 4. Shift Shortage (After 5% Allowance)</div>
              <div className={styles.statValue} style={{ fontSize: '1.35rem', color: noSales ? 'var(--text-secondary)' : totalShortageGrams > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {noSales
                  ? 'Pending Sales'
                  : totalShortageGrams > 0
                    ? totalShortageGrams >= 1000
                      ? `${(totalShortageGrams / 1000).toFixed(2)} kg`
                      : `${Math.round(totalShortageGrams)} g`
                    : '0 g (None)'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {noSales
                  ? 'Awaiting Sales By Items upload'
                  : over.length > 0
                    ? `${over.length} flavour${over.length > 1 ? 's' : ''} over 5% allowance (${grams(totalAllowanceGrams)} allow.)`
                    : `All flavours within 5% allowance (${grams(totalAllowanceGrams)})`}
              </div>
            </div>
          </div>

          {/* Detailed Shortage Bifurcation by Flavour */}
          {!noSales && over.length > 0 && (
            <div className={styles.card} style={{ marginBottom: '1.5rem', border: '1px solid rgba(255,23,68,0.3)', background: 'rgba(255,23,68,0.03)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                <div>
                  <h3 style={{ margin: 0, color: 'var(--danger)', fontSize: '1.15rem' }}>
                    🚨 Detailed Shortage Bifurcation by Flavour ({totalShortageGrams >= 1000 ? `${(totalShortageGrams / 1000).toFixed(2)} kg` : `${Math.round(totalShortageGrams)} g`} total)
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
                    {over.sort((a, b) => b.shortageGrams - a.shortageGrams).map(r => (
                      <tr key={r.item_id} style={{ background: 'rgba(255,23,68,0.05)' }}>
                        <td className={styles.stickyCol} style={{ fontWeight: 600 }}>
                          {r.flavour}
                          <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div>
                        </td>
                        <td className={styles.alignRight}>{grams(r.used)}</td>
                        <td className={styles.alignRight}>{grams(r.sold)}</td>
                        <td className={styles.alignRight}>{grams(r.calculatedAllowance)}</td>
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
          {noSales && <div className={styles.card} style={{ color: 'var(--warning)' }}>⚠ Sales By Items is not uploaded for {fmtDate(date)} — sold is 0, so flavour sales consumption is pending.</div>}
          {unmatched > 0 && (
            <div className={styles.card}>
              ⚠ {unmatched} Rista sales line(s) on this day aren&apos;t matched to a flavour + size.{' '}
              <Link href="/super-admin/items?brand=br&tab=matching" className={styles.secondaryButton}>Match them in Items</Link>
            </div>
          )}
          {overnight.length > 0 && (
            <div className={styles.card}>
              🌙 Overnight drop (today&apos;s opening lower than last night&apos;s closing): {overnight.map(r => `${r.flavour} ${signedGrams(r.overnight_change)}`).join(', ')}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem', margin: '0.5rem 0 1rem' }}>
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only show problems
            </label>
            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Formula: <strong>Used</strong> = Opening + Received − Closing · <strong>Gap</strong> = Used − Sold − Wasted
            </span>
          </div>

          {loading ? <div className={styles.loading}>Loading…</div> : (
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
                  {shown.map(r => {
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

      {editModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
        }}>
          <div className={styles.card} style={{ width: '100%', maxWidth: 440, padding: '1.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>
              ✏️ Edit {editModal.session === 'opening' ? 'Opening' : 'Closing'} Count
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
              Flavour: <strong>{editModal.flavour}</strong> · Sales Day: <strong>{displayDate(date)}</strong>
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
                  onChange={e => setEditModal({ ...editModal, unopened_boxes: parseInt(e.target.value, 10) || 0 })}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.3rem' }}>
                  Open Box Scale Weight (with box, in grams):
                </label>
                <input
                  type="number"
                  min="0"
                  className={styles.searchInput}
                  style={{ width: '100%' }}
                  placeholder="e.g. 1539 (leave 0 if no open box)"
                  value={editModal.open_box_gross || ''}
                  onChange={e => setEditModal({ ...editModal, open_box_gross: parseInt(e.target.value, 10) || 0 })}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                  130 g empty box tare will be deducted automatically.
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: 6, fontSize: '0.9rem', fontWeight: 600 }}>
                Computed Weight: {grams(
                  (editModal.unopened_boxes || 0) * FULL_BOX_GRAMS +
                  (editModal.open_box_gross > 0 ? Math.max(0, editModal.open_box_gross - EMPTY_BOX_GRAMS) : 0)
                )}
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
              <button
                className={styles.secondaryButton}
                disabled={savingEdit}
                onClick={() => setEditModal(null)}
              >
                Cancel
              </button>
              <button
                className={styles.primaryButton}
                disabled={savingEdit}
                onClick={handleSaveEdit}
              >
                {savingEdit ? 'Saving…' : '💾 Save Correction'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
