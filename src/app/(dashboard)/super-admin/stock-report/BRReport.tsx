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
  const { supabase, store } = useActiveStore();
  const [activeTab, setActiveTab] = useState<'inventory' | 'reconciliation'>('inventory');
  const [date, setDate] = useState(istDate());
  const [rows, setRows] = useState<BRReportRow[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [invSearch, setInvSearch] = useState('');

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
      setUnmatched(((lines || []) as { matched_by: string; quantity: number }[]).filter(l => l.matched_by === 'none').length);

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

  const counted = rows.filter(r => r.status !== 'NOT_COUNTED');
  const over = rows.filter(r => r.status === 'OVER');
  const overGrams = over.reduce((t, r) => t + Math.max(0, (r.gap || 0) - r.allowance), 0);
  const noSales = rows.some(r => r.status === 'NO_SALES');
  const overnight = rows.filter(r => r.overnight_change !== null && r.overnight_change < -50);
  const shown = onlyProblems ? rows.filter(r => r.status === 'OVER' || r.status === 'CHECK' || (r.overnight_change ?? 0) < -50) : rows;
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
                    <th>Packed Boxes ({FULL_BOX_GRAMS}g each)</th>
                    <th>Open Box on Scale (with box)</th>
                    <th>Open Box Net (less {EMPTY_BOX_GRAMS}g)</th>
                    <th>Total Stock (g)</th>
                    <th>Total Stock (kg)</th>
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
                        <td>{i.unopened_boxes ? `${i.unopened_boxes} box${i.unopened_boxes > 1 ? 'es' : ''}` : '0'}</td>
                        <td>{i.open_box_gross ? `${i.open_box_gross.toLocaleString('en-IN')} g` : '—'}</td>
                        <td>{openNet > 0 ? `${openNet.toLocaleString('en-IN')} g` : '—'}</td>
                        <td style={{ fontWeight: 700, color: i.net_grams > 0 ? 'var(--text-primary)' : 'var(--text-secondary)' }}>
                          {i.net_grams.toLocaleString('en-IN')} g
                        </td>
                        <td style={{ fontWeight: 700, color: i.net_grams > 0 ? 'var(--success)' : 'var(--text-secondary)' }}>
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
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, -1))}>‹</button>
              <input type="date" className={styles.searchInput} value={date} max={istDate()} onChange={e => e.target.value && setDate(e.target.value)} />
              <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, 1))} disabled={date >= istDate()}>›</button>
            </div>
          </div>

          <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
            <div className={styles.statCard}><div className={styles.statLabel}>Flavours with Opening Count</div><div className={styles.statValue}>{rows.filter(r => r.opening !== null).length} / {rows.length}</div></div>
            <div className={styles.statCard}><div className={styles.statLabel}>Flavours with Closing Count</div><div className={styles.statValue}>{rows.filter(r => r.closing !== null).length} / {rows.length}</div></div>
            <div className={styles.statCard}><div className={styles.statLabel}>Sold (from Sales By Items)</div><div className={styles.statValue}>{grams(totalSold)}</div></div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Flavours over allowance</div>
              <div className={styles.statValue} style={{ color: over.length ? 'var(--danger)' : undefined }}>
                {over.length}
                {overGrams > 0 && (
                  <span style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--danger)', marginLeft: '0.5rem' }}>
                    ({grams(overGrams)} shortage)
                  </span>
                )}
              </div>
            </div>
          </div>

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
                    <th>Flavour</th><th>Opening</th><th>Received</th><th>Closing</th><th>Used</th>
                    <th>Sold</th><th>Wasted</th><th>Gap</th><th>Allowance</th><th>Overnight</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => {
                    const st = BR_STATUS[r.status] || { label: r.status, cls: 'badgeDefault', help: '' };
                    return (
                      <tr key={r.item_id}>
                        <td style={{ fontWeight: 600 }}>{r.flavour}<div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div></td>
                        <td>{r.opening !== null ? grams(r.opening) : '—'}</td>
                        <td>{r.received ? grams(r.received) : '—'}</td>
                        <td>{r.closing !== null ? grams(r.closing) : <span style={{ color: 'var(--text-secondary)' }}>Pending night weigh</span>}</td>
                        <td>{r.used !== null ? grams(r.used) : '—'}</td>
                        <td>{grams(r.sold)}</td>
                        <td>{r.wasted ? grams(r.wasted) : '—'}</td>
                        <td style={{ fontWeight: 600, color: r.status === 'OVER' ? 'var(--danger)' : undefined }}>{signedGrams(r.gap)}</td>
                        <td>{grams(r.allowance)}</td>
                        <td style={{ color: (r.overnight_change ?? 0) < -50 ? 'var(--warning)' : undefined }}>{signedGrams(r.overnight_change)}</td>
                        <td><span className={styles[st.cls]} title={st.help}>{st.label}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
