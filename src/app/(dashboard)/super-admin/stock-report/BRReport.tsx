'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { BR_STATUS, BRReportRow, grams, signedGrams, toReportRows } from '@/lib/br';
import { EMPTY_BOX_GRAMS, FULL_BOX_GRAMS } from '@/lib/icecream';
import styles from '../super-admin.module.css';

const fmtDate = (ymd: string) =>
  new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

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

/** Baskin Robbins: Current inventory on hand + daily reconciliation report. */
export function BRReport() {
  const { supabase, store, profile } = useActiveStore();
  const [activeTab, setActiveTab] = useState<'inventory' | 'reconciliation'>('inventory');
  const [date, setDate] = useState(istDate());
  const [rows, setRows] = useState<BRReportRow[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [invSearch, setInvSearch] = useState('');
  const [countsForDate, setCountsForDate] = useState<Record<string, Record<'opening' | 'closing', { unopened_boxes: number; open_box_gross: number }>>>({});
  const [editModal, setEditModal] = useState<{
    item_id: string;
    flavour: string;
    session: 'opening' | 'closing';
    unopened_boxes: number;
    open_box_gross: number;
  } | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

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
      const [
        { data: reportData, error: e },
        { data: lines },
        { data: flvRows },
        { data: recentCounts }
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
          .select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, staff_members(name)')
          .eq('store_id', store.id)
          .order('count_date', { ascending: false })
          .limit(500),
      ]);

      setError(e ? e.message : null);
      setRows(e ? [] : toReportRows(reportData));
      const countsMap: Record<string, Record<'opening' | 'closing', { unopened_boxes: number; open_box_gross: number }>> = {};
      (recentCounts || []).forEach(c => {
        if (c.count_date === date) {
          if (!countsMap[c.item_id]) countsMap[c.item_id] = { opening: { unopened_boxes: 0, open_box_gross: 0 }, closing: { unopened_boxes: 0, open_box_gross: 0 } };
          const ses = c.session as 'opening' | 'closing';
          countsMap[c.item_id][ses] = {
            unopened_boxes: Number(c.unopened_boxes) || 0,
            open_box_gross: Number(c.open_box_gross) || 0,
          };
        }
      });
      setCountsForDate(countsMap);

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

  const counted = rowsWithCalc.filter(r => r.opening !== null && r.closing !== null);
  const over = rowsWithCalc.filter(r => r.shortageGrams > 0);
  const totalShortageGrams = over.reduce((t, r) => t + r.shortageGrams, 0);
  const totalAllowanceGrams = rowsWithCalc.reduce((t, r) => t + r.calculatedAllowance, 0);
  const noSales = rows.some(r => r.status === 'NO_SALES');
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
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ice Cream Stock — {store?.name}</h1>
          <p className={styles.subtitle}>
            1 packed box = {FULL_BOX_GRAMS} g · Empty box tare = {EMPTY_BOX_GRAMS} g (automatically deducted).
          </p>
        </div>
      </div>

      {/* Main Tabs */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        <button
          className={activeTab === 'inventory' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('inventory')}
        >
          📦 Current Inventory On Hand ({flavoursWithStock}/{inventory.length})
        </button>
        <button
          className={activeTab === 'reconciliation' ? styles.primaryButton : styles.secondaryButton}
          style={{ padding: '0.65rem 1.25rem', fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          onClick={() => setActiveTab('reconciliation')}
        >
          📊 Daily Variance &amp; Consumption
        </button>
      </div>

      {/* TAB 1: CURRENT INVENTORY ON HAND */}
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

          <div style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', alignItems: 'center' }}>
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
                    <th>Flavour</th>
                    <th className={styles.alignRight}>Packed Boxes ({FULL_BOX_GRAMS}g)</th>
                    <th className={styles.alignRight}>Scale Gross</th>
                    <th className={styles.alignRight}>Open Box Net</th>
                    <th className={styles.alignRight}>Total Stock (g)</th>
                    <th className={styles.alignRight}>Total Stock (kg)</th>
                    <th>Last Counted</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredInventory.map(i => {
                    const openNet = i.open_box_gross > EMPTY_BOX_GRAMS ? i.open_box_gross - EMPTY_BOX_GRAMS : 0;
                    return (
                      <tr key={i.item_id}>
                        <td style={{ fontWeight: 600 }}>
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
                              {i.last_date === istDate() ? 'Today' : fmtDate(i.last_date)}{' '}
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

      {/* TAB 2: DAILY RECONCILIATION */}
      {activeTab === 'reconciliation' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <p className={styles.subtitle} style={{ margin: 0 }}>
                Per flavour: <strong>used</strong> = opening + received − closing. <strong>Gap</strong> = used − sold − wasted.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, -1))}>‹</button>
              <input type="date" className={styles.searchInput} value={date} max={istDate()} onChange={e => e.target.value && setDate(e.target.value)} />
              <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, 1))} disabled={date >= istDate()}>›</button>
              {date === istDate() && (
                <button
                  className={styles.secondaryButton}
                  style={{ fontSize: '0.8rem', padding: '0.35rem 0.65rem' }}
                  onClick={() => setDate(addDays(istDate(), -1))}
                >
                  ‹ Yesterday ({fmtDate(addDays(istDate(), -1))})
                </button>
              )}
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
                  🗑️ Clear Sales for {fmtDate(date)}
                </button>
              )}
            </div>
          </div>

          <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Overall Ice Cream Shortage</div>
              <div className={styles.statValue} style={{ color: noSales ? 'var(--text-secondary)' : totalShortageGrams > 0 ? 'var(--danger)' : 'var(--success)' }}>
                {noSales
                  ? 'Pending Sales'
                  : totalShortageGrams > 0
                    ? totalShortageGrams >= 1000
                      ? `${(totalShortageGrams / 1000).toFixed(2)} kg`
                      : `${Math.round(totalShortageGrams)} g`
                    : '0 g (None)'}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {noSales
                  ? 'Awaiting Sales By Items upload'
                  : over.length > 0
                    ? `${over.length} flavour${over.length > 1 ? 's' : ''} with excess loss`
                    : 'All flavours within allowance'}
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statLabel}>Sold (POS Items)</div>
              <div className={styles.statValue}>{grams(totalSold)}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                {(totalSold / 1000).toFixed(2)} kg billed in Rista
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statLabel}>Total Tasting Allowance (5%)</div>
              <div className={styles.statValue}>{grams(totalAllowanceGrams)}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                5% volume-proportional tasting
              </div>
            </div>

            <div className={styles.statCard}>
              <div className={styles.statLabel}>Counting Progress</div>
              <div className={styles.statValue}>
                {rowsWithCalc.filter(r => r.closing !== null).length} / {rows.length}
              </div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
                flavours weighed at night closing
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
                      <th>Flavour</th>
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
                        <td style={{ fontWeight: 600 }}>
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

          <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', margin: '0.5rem 0 1rem' }}>
            <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only show problems
          </label>

          {loading ? <div className={styles.loading}>Loading…</div> : (
            <div className={styles.card} style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Flavour</th>
                    <th className={styles.alignRight}>Opening</th>
                    <th className={styles.alignRight}>Received</th>
                    <th className={styles.alignRight}>Closing</th>
                    <th className={styles.alignRight}>Used</th>
                    <th className={styles.alignRight}>Sold</th>
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
                        <td style={{ fontWeight: 600 }}>
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

      {editModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999
        }}>
          <div className={styles.card} style={{ width: '100%', maxWidth: 440, padding: '1.5rem', background: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
            <h3 style={{ margin: '0 0 0.5rem' }}>
              ✏️ Edit {editModal.session === 'opening' ? 'Opening' : 'Closing'} Count
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0 0 1rem' }}>
              Flavour: <strong>{editModal.flavour}</strong> · Date: <strong>{date}</strong>
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
