'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { BR_STATUS, BRReportRow, grams, signedGrams, toReportRows } from '@/lib/br';
import styles from '../super-admin.module.css';

const fmtDate = (ymd: string) =>
  new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });

/** Baskin Robbins: per-flavour daily check (opening + received − closing vs sold + wasted + tasting allowance). */
export function BRReport() {
  const { supabase, store } = useActiveStore();
  const [date, setDate] = useState(addDays(istDate(), -1));
  const [rows, setRows] = useState<BRReportRow[]>([]);
  const [unmatched, setUnmatched] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data, error: e }, { data: lines }] = await Promise.all([
      supabase.rpc('br_daily_report', { p_store_id: store.id, p_date: date }),
      supabase.rpc('br_sales_lines', { p_store_id: store.id, p_from: date, p_to: date }),
    ]);
    setError(e ? e.message : null);
    setRows(e ? [] : toReportRows(data));
    setUnmatched(((lines || []) as { matched_by: string; quantity: number }[]).filter(l => l.matched_by === 'none').length);
    setLoading(false);
  }, [supabase, store, date]);

  useEffect(() => { load(); }, [load]);

  const counted = rows.filter(r => r.status !== 'NOT_COUNTED');
  const over = rows.filter(r => r.status === 'OVER');
  const overGrams = over.reduce((t, r) => t + Math.max(0, (r.gap || 0) - r.allowance), 0);
  const noSales = rows.some(r => r.status === 'NO_SALES');
  const overnight = rows.filter(r => r.overnight_change !== null && r.overnight_change < -50);
  const shown = onlyProblems ? rows.filter(r => r.status === 'OVER' || r.status === 'CHECK' || (r.overnight_change ?? 0) < -50) : rows;
  const totalSold = rows.reduce((t, r) => t + r.sold, 0);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ice Cream Report — {store?.name}</h1>
          <p className={styles.subtitle}>
            Per flavour: <strong>used</strong> = opening + received − closing. <strong>Gap</strong> = used − sold − wasted.
            Over the flavour&apos;s tasting allowance → <strong>Over</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, -1))}>‹</button>
          <input type="date" className={styles.searchInput} value={date} max={istDate()} onChange={e => e.target.value && setDate(e.target.value)} />
          <button className={styles.secondaryButton} onClick={() => setDate(d => addDays(d, 1))} disabled={date >= istDate()}>›</button>
        </div>
      </div>

      <div className={styles.statGrid} style={{ marginBottom: '1.25rem' }}>
        <div className={styles.statCard}><div className={styles.statLabel}>Flavours weighed (open + close)</div><div className={styles.statValue}>{counted.length} / {rows.length}</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}>Sold (from Sales By Items)</div><div className={styles.statValue}>{grams(totalSold)}</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}>Flavours over</div>
          <div className={styles.statValue} style={{ color: over.length ? 'var(--danger)' : undefined }}>{over.length}</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}>Missing beyond allowance</div>
          <div className={styles.statValue} style={{ color: overGrams ? 'var(--danger)' : undefined }}>{grams(overGrams)}</div></div>
      </div>

      {error && <div className={styles.card} style={{ color: 'var(--danger)' }}>Could not load: {error}</div>}
      {noSales && <div className={styles.card}>⚠ Sales By Items is not uploaded for {fmtDate(date)} — sold is 0, so no flavour can be checked yet.</div>}
      {unmatched > 0 && (
        <div className={styles.card}>
          ⚠ {unmatched} Rista sales line(s) on this day aren&apos;t matched to a flavour + size, so their grams are not counted.{' '}
          <Link href="/super-admin/flavours" className={styles.secondaryButton}>Match them</Link>
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
                const st = BR_STATUS[r.status];
                return (
                  <tr key={r.item_id}>
                    <td style={{ fontWeight: 600 }}>{r.flavour}<div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{r.range_name}</div></td>
                    <td>{grams(r.opening)}</td>
                    <td>{r.received ? grams(r.received) : '—'}</td>
                    <td>{grams(r.closing)}</td>
                    <td>{grams(r.used)}</td>
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
    </div>
  );
}
