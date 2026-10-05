'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { FREQUENCY_LABEL, Frequency } from '@/lib/stock/schedule';
import { displayUnit, toDisplay } from '@/lib/stock/units';
import styles from '../super-admin.module.css';

type Row = {
  item_id: string; item_name: string; stock_group: string; uom: string; rista_unit: string | null;
  count_frequency: Frequency; rista_sku: string | null; rate: number | null;
  opening_date: string; opening: number; received: number; wastage: number; used: number;
  system_closing: number; closing_date: string; actual_closing: number;
  variance: number; variance_percent: number | null; variance_amount: number;
  days: number; days_with_sales_data: number; status: string;
};

const STATUS: Record<string, { label: string; cls: 'badgeDanger' | 'badgeSuccess' | 'badgeDefault'; help: string }> = {
  SHORT: { label: 'Short', cls: 'badgeDanger', help: 'Less stock than there should be.' },
  EXCESS: { label: 'Excess', cls: 'badgeDefault', help: 'More stock than there should be.' },
  OK: { label: 'OK', cls: 'badgeSuccess', help: '' },
  CHECK_RECEIVED: { label: 'Check delivery', cls: 'badgeDanger', help: 'Expected stock is below zero — a delivery was probably not entered.' },
  SALES_DATA_MISSING: { label: 'Rista usage missing', cls: 'badgeDefault', help: 'Some days in this period have no Rista usage upload, so "Used" is too low.' },
  NO_SKU: { label: 'No Rista SKU', cls: 'badgeDefault', help: 'Link this item to its Rista SKU on the Items page.' },
  UNIT_MISMATCH: { label: 'Unit mismatch', cls: 'badgeDanger', help: 'Rista unit doesn\'t match the item unit.' },
};
const RELIABLE = new Set(['SHORT', 'EXCESS', 'OK', 'CHECK_RECEIVED']);
const GROUPS = ['Cakes & Pastries', 'Raw Material', 'Packaging', 'Other'];
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const fmt = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const groupKey = (g: string) => (GROUPS.includes(g) ? g : /pack/i.test(g) ? 'Packaging' : /cake|pastr/i.test(g) ? 'Cakes & Pastries' : /misc|other/i.test(g) ? 'Other' : 'Raw Material');

export default function StockReportPage() {
  const { supabase, store } = useActiveStore();
  const [mode, setMode] = useState<'latest' | 'range'>('latest');
  const [from, setFrom] = useState(addDays(istDate(), -30));
  const [to, setTo] = useState(istDate());
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    setError(null);
    const { data, error: e } = await supabase.rpc('stock_variance_report', {
      p_store_id: store.id, p_from: mode === 'range' ? from : null, p_to: to,
    });
    if (e) { setError(e.message); setRows([]); } else setRows(((data || []) as Row[]).map(r => ({
      ...r,
      opening: Number(r.opening), received: Number(r.received), wastage: Number(r.wastage), used: Number(r.used),
      system_closing: Number(r.system_closing), actual_closing: Number(r.actual_closing),
      variance: Number(r.variance), variance_amount: Number(r.variance_amount),
    })));
    setLoading(false);
  }, [supabase, store, mode, from, to]);

  useEffect(() => { load(); }, [load]);

  // Totals like the audit summary (only rows we can trust)
  const totals = GROUPS.map(g => {
    const rs = rows.filter(r => groupKey(r.stock_group) === g && RELIABLE.has(r.status));
    return {
      g,
      excess: rs.filter(r => r.variance_amount > 0).reduce((t, r) => t + r.variance_amount, 0),
      short: rs.filter(r => r.variance_amount < 0).reduce((t, r) => t + r.variance_amount, 0),
    };
  });
  const totalExcess = totals.reduce((t, x) => t + x.excess, 0);
  const totalShort = totals.reduce((t, x) => t + x.short, 0);
  const notReliable = rows.filter(r => !RELIABLE.has(r.status)).length;
  const shown = onlyProblems ? rows.filter(r => r.status !== 'OK') : rows;
  const d = (r: Row, q: number) => toDisplay(q, r.rista_unit, r.uom);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Stock Report{store ? ` — ${store.name}` : ''}</h1>
          <p className={styles.subtitle}>
            Expected stock = last count + received − wastage − used by sales (Rista). Variance = actual count − expected. Same method as the company audit.
          </p>
        </div>
        <button className={styles.secondaryButton} onClick={() => window.print()}>🖨️ Print</button>
      </div>

      <div className={styles.card} style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
        <div className={styles.fieldGroup}>
          <label>Period</label>
          <select className={styles.selectFilter} value={mode} onChange={e => setMode(e.target.value as 'latest' | 'range')}>
            <option value="latest">Since each item&apos;s last count</option>
            <option value="range">Between two dates (e.g. since last audit)</option>
          </select>
        </div>
        {mode === 'range' && (
          <div className={styles.fieldGroup}>
            <label>From (count on/before)</label>
            <input type="date" className={styles.input} value={from} max={to} onChange={e => setFrom(e.target.value)} />
          </div>
        )}
        <div className={styles.fieldGroup}>
          <label>To (count on/before)</label>
          <input type="date" className={styles.input} value={to} max={istDate()} onChange={e => setTo(e.target.value)} />
        </div>
        <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} /> Only problems
        </label>
      </div>

      {error && <div className={styles.card} style={{ color: 'var(--danger)', marginBottom: '1rem' }}>Could not load: {error}</div>}

      <div className={styles.card} style={{ marginBottom: '1rem', overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead><tr><th>Group</th><th>Excess</th><th>Short</th><th>Net</th></tr></thead>
          <tbody>
            {totals.map(t => (
              <tr key={t.g}><td>{t.g}</td>
                <td style={{ color: 'var(--success)' }}>{inr(t.excess)}</td>
                <td style={{ color: 'var(--danger)' }}>{inr(t.short)}</td>
                <td style={{ fontWeight: 600 }}>{inr(t.excess + t.short)}</td></tr>
            ))}
            <tr style={{ fontWeight: 700 }}><td>Total</td>
              <td style={{ color: 'var(--success)' }}>{inr(totalExcess)}</td>
              <td style={{ color: 'var(--danger)' }}>{inr(totalShort)}</td>
              <td>{inr(totalExcess + totalShort)}</td></tr>
          </tbody>
        </table>
        {notReliable > 0 && (
          <p className={styles.subtitle} style={{ marginTop: '0.75rem' }}>
            ⚠ {notReliable} item(s) are left out of the totals because their numbers aren&apos;t complete yet (see the status column).
          </p>
        )}
      </div>

      <div className={styles.card} style={{ overflowX: 'auto' }}>
        {loading ? <p>Loading…</p> : rows.length === 0 ? (
          <p className={styles.subtitle}>
            No items have two counts in this period yet. An item needs a starting count and a later count before it can be checked.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th><th>Unit</th><th>Period</th><th>Opening</th><th>Received</th><th>Wastage</th><th>Used (Rista)</th>
                <th>Expected</th><th>Actual</th><th>Variance</th><th>Var %</th><th>Variance ₹</th><th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const st = STATUS[r.status] || { label: r.status, cls: 'badgeDefault' as const, help: '' };
                return (
                  <tr key={r.item_id} style={{ background: r.status === 'SHORT' || r.status === 'CHECK_RECEIVED' ? 'rgba(255,23,68,0.06)' : undefined }}>
                    <td style={{ fontWeight: 600 }}>{r.item_name}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.stock_group} · {FREQUENCY_LABEL[r.count_frequency] || ''}</div></td>
                    <td>{displayUnit(r.rista_unit, r.uom)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>{fmt(r.opening_date)} → {fmt(r.closing_date)}
                      {r.days_with_sales_data < r.days && <div style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>Rista: {r.days_with_sales_data}/{r.days} days</div>}</td>
                    <td>{d(r, r.opening)}</td><td>{d(r, r.received)}</td><td>{d(r, r.wastage)}</td><td>{d(r, r.used)}</td>
                    <td>{d(r, r.system_closing)}</td><td>{d(r, r.actual_closing)}</td>
                    <td style={{ fontWeight: 700, color: r.variance < 0 ? 'var(--danger)' : r.variance > 0 ? 'var(--success)' : undefined }}>
                      {r.variance > 0 ? '+' : ''}{d(r, r.variance)}</td>
                    <td>{r.variance_percent === null ? '—' : `${r.variance_percent}%`}</td>
                    <td style={{ fontWeight: 700, color: r.variance_amount < 0 ? 'var(--danger)' : r.variance_amount > 0 ? 'var(--success)' : undefined }}>
                      {r.rate ? inr(r.variance_amount) : 'no rate'}</td>
                    <td><span className={styles[st.cls]} title={st.help}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
