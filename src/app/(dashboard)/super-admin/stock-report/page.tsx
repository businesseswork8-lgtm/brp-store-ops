'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatDateTime } from '@/lib/dates';
import { FREQUENCY_LABEL, Frequency } from '@/lib/stock/schedule';
import { displayUnit, toDisplay } from '@/lib/stock/units';
import styles from '../super-admin.module.css';
import { CompanyTally } from './CompanyTally';
import { BRReport } from './BRReport';
import { isBRStore } from '@/lib/br';

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

/** Baskin Robbins stores get the per-flavour ice cream report; 99 Pancakes gets the general stock variance report. */
export default function StockReportPage() {
  const { store, stores, selectStore, loading } = useActiveStore();
  if (loading) return <div className={styles.loading}>Loading…</div>;

  return (
    <div>
      {/* 1-Click Store Switcher Bar across all stores (BR & 99 Pancakes) */}
      {stores.length > 1 && (
        <div style={{
          maxWidth: '1400px',
          margin: '1rem auto 0',
          padding: '0.65rem 1.25rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>
              🏬 Switch Store:
            </span>
            {stores.map(s => {
              const active = store?.id === s.id;
              const isBR = isBRStore(s);
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectStore(s.id)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: '8px',
                    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    background: active ? 'var(--accent-primary)' : 'var(--bg-card)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    fontWeight: active ? 700 : 500,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>{isBR ? '🍨' : '🥞'}</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <Link href="/super-admin" className={styles.secondaryButton} style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem', textDecoration: 'none' }}>
              ← All Stores
            </Link>
            <Link href="/store/eod-report" className={styles.secondaryButton} style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem', textDecoration: 'none' }}>
              🖨️ Day Summary
            </Link>
          </div>
        </div>
      )}

      {isBRStore(store) ? <BRReport /> : <GeneralStockReport />}
    </div>
  );
}

function GeneralStockReport() {
  const { supabase, store, profile } = useActiveStore();
  const activeShiftDate = istDate();
  const yesterdayShiftDate = addDays(activeShiftDate, -1);

  const [showTally, setShowTally] = useState(false);
  const [mode, setMode] = useState<'latest' | 'range'>('latest');
  const [from, setFrom] = useState(addDays(activeShiftDate, -30));
  const [to, setTo] = useState(activeShiftDate);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [onlyCountedOnDay, setOnlyCountedOnDay] = useState(false);

  // Shift activity metadata for the selected Sales Day (`to`)
  const [shiftMeta, setShiftMeta] = useState<{
    closingCountItems: number;
    closingCountTime: string | null;
    prevClosingDate: string | null;
    prevClosingTime: string | null;
    hasSales: boolean;
    netSales: number | null;
    salesTime: string | null;
    hasUsage: boolean;
    usageTime: string | null;
  } | null>(null);

  // Support ?date=YYYY-MM-DD from All Stores links
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const d = params.get('date');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        setTo(d);
      }
    }
  }, []);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    setError(null);

    const [
      { data, error: e },
      { data: dayCounts },
      { data: prevCounts },
      { data: salesRow },
      { data: usageRows },
    ] = await Promise.all([
      supabase.rpc('stock_variance_report', {
        p_store_id: store.id, p_from: mode === 'range' ? from : null, p_to: to,
      }),
      supabase.from('stock_counts').select('item_id, created_at').eq('store_id', store.id).eq('entry_date', to),
      supabase.from('stock_counts').select('entry_date, created_at').eq('store_id', store.id).lt('entry_date', to).order('entry_date', { ascending: false }).limit(20),
      supabase.from('daily_sales_summary').select('has_summary, net_sales, created_at').eq('store_id', store.id).eq('entry_date', to).maybeSingle(),
      supabase.from('rista_consumption_uploads').select('date_from, date_to, uploaded_at').eq('store_id', store.id).lte('date_from', to).gte('date_to', to),
    ]);

    if (e) {
      setError(e.message);
      setRows([]);
    } else {
      setRows(((data || []) as Row[]).map(r => ({
        ...r,
        opening: Number(r.opening), received: Number(r.received), wastage: Number(r.wastage), used: Number(r.used),
        system_closing: Number(r.system_closing), actual_closing: Number(r.actual_closing),
        variance: Number(r.variance), variance_amount: Number(r.variance_amount),
      })));
    }

    const latestCloseTime = (dayCounts || []).reduce<string | null>((acc, c: any) => {
      return !acc || (c.created_at && c.created_at > acc) ? c.created_at : acc;
    }, null);

    const prevDate = prevCounts && prevCounts.length > 0 ? (prevCounts[0] as any).entry_date : null;
    const prevTime = prevCounts && prevCounts.length > 0
      ? (prevCounts as any[]).filter(c => c.entry_date === prevDate).reduce<string | null>((acc, c) => !acc || (c.created_at && c.created_at > acc) ? c.created_at : acc, null)
      : null;

    const latestUsageTime = (usageRows || []).reduce<string | null>((acc, u: any) => {
      return !acc || (u.uploaded_at && u.uploaded_at > acc) ? u.uploaded_at : acc;
    }, null);

    setShiftMeta({
      closingCountItems: (dayCounts || []).length,
      closingCountTime: latestCloseTime,
      prevClosingDate: prevDate,
      prevClosingTime: prevTime,
      hasSales: Boolean(salesRow && salesRow.has_summary !== false),
      netSales: salesRow && salesRow.has_summary !== false ? Number(salesRow.net_sales || 0) : null,
      salesTime: salesRow?.created_at || null,
      hasUsage: (usageRows || []).length > 0,
      usageTime: latestUsageTime,
    });

    setLoading(false);
  }, [supabase, store, mode, from, to]);

  useEffect(() => { load(); }, [load]);

  // Filter rows
  const baseRows = onlyCountedOnDay ? rows.filter(r => r.closing_date === to) : rows;
  const shown = onlyProblems ? baseRows.filter(r => r.status !== 'OK') : baseRows;

  // Totals like the audit summary (only rows we can trust)
  const totals = GROUPS.map(g => {
    const rs = baseRows.filter(r => groupKey(r.stock_group) === g && RELIABLE.has(r.status));
    return {
      g,
      excess: rs.filter(r => r.variance_amount > 0).reduce((t, r) => t + r.variance_amount, 0),
      short: rs.filter(r => r.variance_amount < 0).reduce((t, r) => t + r.variance_amount, 0),
    };
  });
  const totalExcess = totals.reduce((t, x) => t + x.excess, 0);
  const totalShort = totals.reduce((t, x) => t + x.short, 0);
  const notReliable = baseRows.filter(r => !RELIABLE.has(r.status)).length;
  const countedOnSelectedDayCount = rows.filter(r => r.closing_date === to).length;
  const d = (r: Row, q: number) => toDisplay(q, r.rista_unit, r.uom);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🥞 Stock Report{store ? ` — ${store.name}` : ''}</h1>
          <p className={styles.subtitle}>
            Expected stock = Opening (previous closing count) + Received − Wastage − Used by sales (Rista). Variance = Actual Closing − Expected.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className={showTally ? styles.primaryButton : styles.secondaryButton} onClick={() => setShowTally(v => !v)}>🏢 Company audit</button>
          <button className={styles.secondaryButton} onClick={() => window.print()}>🖨️ Print</button>
        </div>
      </div>

      {/* Unified Sales Day (Operating Shift Date) Navigation Bar */}
      <div className={styles.card} style={{
        marginBottom: '1rem',
        padding: '1rem 1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        background: 'linear-gradient(90deg, rgba(95,107,255,0.10), rgba(0,200,83,0.05))',
        border: '1px solid rgba(95,107,255,0.3)',
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#9aa4ff', fontWeight: 700 }}>
            📅 Viewing Sales Day / Closing Shift
          </div>
          <div style={{ fontSize: '1.2rem', fontWeight: 700, marginTop: '0.15rem' }}>
            {displayDate(to)}
            {to === activeShiftDate && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,83,0.18)', color: '#69f0ae', fontWeight: 600 }}>
                Active Shift
              </span>
            )}
            {to === yesterdayShiftDate && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,214,0,0.16)', color: '#ffd740', fontWeight: 600 }}>
                Yesterday&apos;s Shift
              </span>
            )}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.2rem' }}>
            For <strong>99 Pancakes</strong>, yesterday&apos;s closing count is today&apos;s opening stock. Counts entered after midnight (up to 6:00 AM) belong to the same Sales Day.
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={to === yesterdayShiftDate ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setTo(yesterdayShiftDate)}
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
          >
            ⏮️ Yesterday ({shortDate(yesterdayShiftDate)})
          </button>
          <button
            type="button"
            className={to === activeShiftDate ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setTo(activeShiftDate)}
            style={{ padding: '0.45rem 0.85rem', fontSize: '0.85rem' }}
          >
            📅 Active Shift ({shortDate(activeShiftDate)})
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => setTo(addDays(to, -1))}
              title="Previous Day"
              style={{ padding: '0.45rem 0.7rem' }}
            >
              ‹
            </button>
            <input
              type="date"
              className={styles.input}
              value={to}
              max={activeShiftDate}
              onChange={e => e.target.value && setTo(e.target.value)}
              style={{ width: 'auto' }}
            />
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => to < activeShiftDate && setTo(addDays(to, 1))}
              disabled={to >= activeShiftDate}
              title="Next Day"
              style={{ padding: '0.45rem 0.7rem', opacity: to >= activeShiftDate ? 0.4 : 1 }}
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* 4-Box Shift Activity & Exact Timestamps Banner */}
      {shiftMeta && (
        <div className={styles.card} style={{
          marginBottom: '1rem',
          padding: '0.9rem 1.1rem',
          background: 'rgba(95,107,255,0.06)',
          border: '1px solid rgba(95,107,255,0.22)',
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: '0.75rem',
        }}>
          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
              🌅 Opening Baseline (Prev Close)
            </div>
            <div style={{ fontWeight: 700, marginTop: '0.2rem', color: shiftMeta.prevClosingDate ? '#69f0ae' : 'var(--warning)' }}>
              {shiftMeta.prevClosingDate
                ? `✓ From ${shortDate(shiftMeta.prevClosingDate)} closing`
                : '⚠ No prior count before this date'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {shiftMeta.prevClosingTime
                ? `🕒 Recorded ${formatDateTime(shiftMeta.prevClosingTime)}`
                : 'Previous closing count = Today’s opening'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
              🌙 Closing Stock Count ({shortDate(to)})
            </div>
            <div style={{ fontWeight: 700, marginTop: '0.2rem', color: shiftMeta.closingCountItems > 0 ? '#69f0ae' : 'var(--warning)' }}>
              {shiftMeta.closingCountItems > 0
                ? `✓ ${shiftMeta.closingCountItems} items counted on ${shortDate(to)}`
                : `⏳ Not counted on ${shortDate(to)} yet`}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {shiftMeta.closingCountTime
                ? `🕒 Entered ${formatDateTime(shiftMeta.closingCountTime)}`
                : 'Showing latest count on or before this date'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
              📄 Rista Sales &amp; Usage ({shortDate(to)})
            </div>
            <div style={{ fontWeight: 700, marginTop: '0.2rem', color: shiftMeta.hasUsage && shiftMeta.hasSales ? '#69f0ae' : 'var(--warning)' }}>
              {shiftMeta.hasUsage ? '✓ Usage Uploaded' : '⚠ Usage Missing'}
              {' · '}
              {shiftMeta.hasSales ? `Net ${inr(shiftMeta.netSales || 0)}` : '⚠ Sales Missing'}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              {shiftMeta.usageTime
                ? `🕒 Uploaded ${formatDateTime(shiftMeta.usageTime)}`
                : 'Upload Consumption Variance + Sales Summary'}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase', fontWeight: 700 }}>
              ⚖️ Net Stock Variance
            </div>
            <div style={{ fontWeight: 700, marginTop: '0.2rem', color: totalExcess + totalShort < 0 ? 'var(--danger)' : 'var(--success)' }}>
              Net: {inr(totalExcess + totalShort)}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.1rem' }}>
              Short: <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{inr(totalShort)}</span> · Excess: <span style={{ color: 'var(--success)', fontWeight: 600 }}>{inr(totalExcess)}</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter & Period Controls */}
      <div className={styles.card} style={{ marginBottom: '1rem', display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <div className={styles.fieldGroup}>
            <label>Comparison Period</label>
            <select className={styles.selectFilter} value={mode} onChange={e => setMode(e.target.value as 'latest' | 'range')}>
              <option value="latest">Each item&apos;s previous count → {shortDate(to)} (Shift-to-Shift)</option>
              <option value="range">Custom starting date → {shortDate(to)}</option>
            </select>
          </div>
          {mode === 'range' && (
            <div className={styles.fieldGroup}>
              <label>Opening count on/before</label>
              <input type="date" className={styles.input} value={from} max={to} onChange={e => setFrom(e.target.value)} />
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.88rem' }}>
            <input type="checkbox" checked={onlyCountedOnDay} onChange={e => setOnlyCountedOnDay(e.target.checked)} />
            Only items counted on {shortDate(to)} ({countedOnSelectedDayCount})
          </label>
          <label style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '0.88rem' }}>
            <input type="checkbox" checked={onlyProblems} onChange={e => setOnlyProblems(e.target.checked)} />
            Only problems (Short / Excess)
          </label>
        </div>
      </div>

      {showTally && store && (
        <CompanyTally supabase={supabase} store={store}
          canEdit={profile?.role === 'super_admin' || (profile?.role === 'admin' && Boolean(profile?.can_edit))} />
      )}

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
            ⚠ {notReliable} item(s) are left out of the ₹ totals because their Rista usage or SKU link isn&apos;t complete yet (see the Status column).
          </p>
        )}
      </div>

      <div className={styles.card} style={{ overflowX: 'auto' }}>
        {loading ? <p>Loading…</p> : shown.length === 0 ? (
          <p className={styles.subtitle}>
            {onlyCountedOnDay
              ? `No items have a closing count saved specifically on ${displayDate(to)}. Uncheck "Only items counted on ${shortDate(to)}" to see all items up to this date.`
              : 'No items have two counts in this period yet. An item needs an opening baseline count and a closing count before it can be checked.'}
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Unit</th>
                <th>Shift Period (Open → Close)</th>
                <th>Opening (Prev Close)</th>
                <th>Received</th>
                <th>Wastage</th>
                <th>Used (Rista)</th>
                <th>Expected Close</th>
                <th>Actual Close</th>
                <th>Variance</th>
                <th>Var %</th>
                <th>Variance ₹</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => {
                const st = STATUS[r.status] || { label: r.status, cls: 'badgeDefault' as const, help: '' };
                const countedOnTargetDay = r.closing_date === to;
                return (
                  <tr key={r.item_id} style={{ background: r.status === 'SHORT' || r.status === 'CHECK_RECEIVED' ? 'rgba(255,23,68,0.06)' : undefined }}>
                    <td style={{ fontWeight: 600 }}>
                      {r.item_name}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.stock_group} · {FREQUENCY_LABEL[r.count_frequency] || ''}</div>
                    </td>
                    <td>{displayUnit(r.rista_unit, r.uom)}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <span style={{ fontWeight: 600 }}>{fmt(r.opening_date)} → {fmt(r.closing_date)}</span>
                      <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                        {r.days} day{r.days === 1 ? '' : 's'}
                        {r.days_with_sales_data < r.days && (
                          <span style={{ color: 'var(--warning)', marginLeft: '0.35rem' }}>
                            · Rista: {r.days_with_sales_data}/{r.days}d
                          </span>
                        )}
                      </div>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d(r, r.opening)}</div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>({fmt(r.opening_date)})</div>
                    </td>
                    <td>{d(r, r.received)}</td>
                    <td>{d(r, r.wastage)}</td>
                    <td>{d(r, r.used)}</td>
                    <td>{d(r, r.system_closing)}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{d(r, r.actual_closing)}</div>
                      <div style={{ fontSize: '0.72rem', color: countedOnTargetDay ? '#69f0ae' : 'var(--text-secondary)' }}>
                        ({fmt(r.closing_date)})
                      </div>
                    </td>
                    <td style={{ fontWeight: 700, color: r.variance < 0 ? 'var(--danger)' : r.variance > 0 ? 'var(--success)' : undefined }}>
                      {r.variance > 0 ? '+' : ''}{d(r, r.variance)}
                    </td>
                    <td>{r.variance_percent === null ? '—' : `${r.variance_percent}%`}</td>
                    <td style={{ fontWeight: 700, color: r.variance_amount < 0 ? 'var(--danger)' : r.variance_amount > 0 ? 'var(--success)' : undefined }}>
                      {r.rate ? inr(r.variance_amount) : 'no rate'}
                    </td>
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

