'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { istDate, addDays, displayDate, shortDate, formatDateTime, isLateNightShift } from '@/lib/dates';
import { Frequency, isDue } from '@/lib/stock/schedule';
import styles from './super-admin.module.css';
import { BR_BRAND_ID, grams, repairLateNightBRCounts } from '@/lib/br';

type StoreRow = {
  id: string;
  name: string;
  brand: string;
  is_active: boolean;
  morningCash: number | null;
  morningCashTime: string | null;
  eveningCash: number | null;
  eveningCashTime: string | null;
  posCashSales: number | null;
  cashExpenses: number;
  cashDeposits: number;
  expectedCash: number | null;
  cashDiff: number | null;
  cashStatus: 'MATCH' | 'SHORT' | 'EXTRA' | 'PENDING';
  due: number;
  counted: number;
  countedTime: string | null;
  prevCountDate: string | null;
  salesUploaded: boolean;
  salesTime: string | null;
  netSales: number | null;
  usageUploaded: boolean;
  usageTime: string | null;
  short: number;
  excess: number;
  problems: number;
  br?: {
    flavours: number;
    opened: number;
    openedTime: string | null;
    closed: number;
    closedTime: string | null;
    itemsUploaded: boolean;
    over: number;
    shortageGrams: number;
    checked: boolean;
    totalKg?: number;
  };
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const RELIABLE = new Set(['SHORT', 'EXCESS', 'OK', 'CHECK_RECEIVED']);

export default function AllStoresPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showPilotManager, setShowPilotManager] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const activeShiftDate = istDate();
  const prevShiftDate = addDays(activeShiftDate, -1);
  const [selectedDate, setSelectedDate] = useState<string>(activeShiftDate);
  const isLateNight = isLateNightShift();

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsSuperAdmin(prof?.role === 'super_admin');
    }

    const { data: stores } = await supabase.from('stores').select('id, name, brand_id, is_active, brands(name)').order('name');
    const out = await Promise.all((stores || []).map(async st => {
      if (st.brand_id === BR_BRAND_ID) {
        await repairLateNightBRCounts(supabase, st.id);
      }

      const [
        { data: cash },
        { data: sales },
        { data: usage },
        { data: items },
        { data: counts },
        { data: report },
        { data: cashTxs },
      ] = await Promise.all([
        supabase.from('daily_cash_tally').select('tally_type, total_amount, created_at').eq('store_id', st.id).eq('entry_date', selectedDate),
        supabase.from('daily_sales_summary').select('net_sales, cash_amount, has_summary, has_items, created_at').eq('store_id', st.id).eq('entry_date', selectedDate).maybeSingle(),
        supabase.from('rista_consumption_uploads').select('id, created_at').eq('store_id', st.id).lte('date_from', selectedDate).gte('date_to', selectedDate).order('created_at', { ascending: false }).limit(1),
        supabase.from('items').select('id, count_frequency, item_categories!inner(brand_id)')
          .eq('is_active', true).eq('item_categories.brand_id', st.brand_id).neq('count_frequency', 'none'),
        supabase.from('stock_counts').select('item_id, count_date, created_at, updated_at').eq('store_id', st.id)
          .lte('count_date', selectedDate).gte('count_date', addDays(selectedDate, -62)).order('count_date', { ascending: false }).limit(5000),
        supabase.rpc('stock_variance_report', { p_store_id: st.id, p_from: null, p_to: selectedDate }),
        supabase.from('daily_cash_transactions').select('tx_type, amount').eq('store_id', st.id).eq('entry_date', selectedDate),
      ]);

      let br: StoreRow['br'];
      if (st.brand_id === BR_BRAND_ID) {
        const [{ data: repDay }, { data: weighed }] = await Promise.all([
          supabase.rpc('br_daily_report', { p_store_id: st.id, p_date: selectedDate }),
          supabase.from('br_flavour_counts').select('session, grams, created_at, updated_at').eq('store_id', st.id).eq('count_date', selectedDate),
        ]);

        const rep = (repDay || []) as {
          opening: number | null;
          closing: number | null;
          sold: number;
          gap: number | null;
          allowance: number;
          status: string;
        }[];

        const openWeighed = (weighed || []).filter(w => w.session === 'opening');
        const closeWeighed = (weighed || []).filter(w => w.session === 'closing');

        const latestOpenIso = openWeighed.reduce<string | null>((latest, w) => {
          const t = w.updated_at || w.created_at;
          return !latest || (t && t > latest) ? t : latest;
        }, null);

        const latestCloseIso = closeWeighed.reduce<string | null>((latest, w) => {
          const t = w.updated_at || w.created_at;
          return !latest || (t && t > latest) ? t : latest;
        }, null);

        const closingGrams = closeWeighed.reduce((sum, w) => sum + Number(w.grams || 0), 0);
        const openingGrams = openWeighed.reduce((sum, w) => sum + Number(w.grams || 0), 0);
        const activeGrams = closingGrams > 0 ? closingGrams : openingGrams;

        let overCount = 0;
        let totalShortageGrams = 0;
        rep.forEach(r => {
          const isCounted = r.opening !== null && r.closing !== null;
          const allow = Math.max(20, Number(r.allowance) > 0 ? Number(r.allowance) : Math.round(Number(r.sold || 0) * 0.05));
          const gap = Number(r.gap || 0);
          const netShortage = gap - allow;
          if (isCounted && netShortage >= 50) {
            overCount += 1;
            totalShortageGrams += netShortage;
          }
        });

        br = {
          flavours: rep.length,
          opened: openWeighed.length,
          openedTime: latestOpenIso ? formatDateTime(latestOpenIso) : null,
          closed: closeWeighed.length,
          closedTime: latestCloseIso ? formatDateTime(latestCloseIso) : null,
          itemsUploaded: Boolean(sales?.has_items),
          over: overCount,
          shortageGrams: totalShortageGrams,
          checked: Boolean(sales?.has_items) && rep.some(x => x.opening !== null && x.closing !== null),
          totalKg: activeGrams > 0 ? Math.round(activeGrams / 1000) : undefined,
        };
      }

      const last: Record<string, string> = {};
      let latestCountIso: string | null = null;
      let prevDate: string | null = null;
      (counts || []).forEach(c => {
        if (!last[c.item_id]) last[c.item_id] = c.count_date;
        if (c.count_date === selectedDate) {
          const t = c.updated_at || c.created_at;
          if (t && (!latestCountIso || t > latestCountIso)) latestCountIso = t;
        } else if (!prevDate || c.count_date > prevDate) {
          prevDate = c.count_date;
        }
      });

      const due = (items || []).filter(i => isDue(i.count_frequency as Frequency, last[i.id] || null, selectedDate));
      const rep = (report || []) as { status: string; variance_amount: number }[];
      const okRows = rep.filter(r => RELIABLE.has(r.status));
      const mCash = cash?.find(c => c.tally_type === 'morning');
      const eCash = cash?.find(c => c.tally_type === 'evening');
      const morningAmt = mCash ? Number(mCash.total_amount) : null;
      const eveningAmt = eCash ? Number(eCash.total_amount) : null;
      const posCashAmt = sales && sales.cash_amount !== null && sales.cash_amount !== undefined ? Number(sales.cash_amount) : null;
      const expTotal = (cashTxs || []).filter(t => t.tx_type === 'expense').reduce((sum, t) => sum + Number(t.amount || 0), 0);
      const depTotal = (cashTxs || []).filter(t => t.tx_type === 'bank_deposit').reduce((sum, t) => sum + Number(t.amount || 0), 0);

      const expectedEveningCash = morningAmt !== null && posCashAmt !== null
        ? morningAmt + posCashAmt - expTotal - depTotal
        : null;
      const cashDiff = expectedEveningCash !== null && eveningAmt !== null
        ? eveningAmt - expectedEveningCash
        : null;

      let cashStatus: StoreRow['cashStatus'] = 'PENDING';
      if (cashDiff !== null) {
        if (Math.abs(cashDiff) < 1) cashStatus = 'MATCH';
        else if (cashDiff < 0) cashStatus = 'SHORT';
        else cashStatus = 'EXTRA';
      }

      return {
        id: st.id,
        name: st.name,
        brand: (st as unknown as { brands?: { name: string } }).brands?.name || '',
        is_active: Boolean(st.is_active),
        morningCash: morningAmt,
        morningCashTime: mCash?.created_at ? formatDateTime(mCash.created_at) : null,
        eveningCash: eveningAmt,
        eveningCashTime: eCash?.created_at ? formatDateTime(eCash.created_at) : null,
        posCashSales: posCashAmt,
        cashExpenses: expTotal,
        cashDeposits: depTotal,
        expectedCash: expectedEveningCash,
        cashDiff,
        cashStatus,
        due: due.length,
        counted: due.filter(i => last[i.id] === selectedDate).length,
        countedTime: latestCountIso ? formatDateTime(latestCountIso) : null,
        prevCountDate: prevDate,
        salesUploaded: Boolean(sales && sales.has_summary !== false),
        salesTime: sales?.created_at ? formatDateTime(sales.created_at) : null,
        netSales: sales && sales.has_summary !== false ? Number(sales.net_sales) : null,
        usageUploaded: Boolean(usage?.length),
        usageTime: usage?.[0]?.created_at ? formatDateTime(usage[0].created_at) : null,
        short: okRows.filter(r => Number(r.variance_amount) < 0).reduce((t, r) => t + Number(r.variance_amount), 0),
        excess: okRows.filter(r => Number(r.variance_amount) > 0).reduce((t, r) => t + Number(r.variance_amount), 0),
        problems: rep.filter(r => r.status === 'CHECK_RECEIVED').length,
        br,
      } as StoreRow;
    }));
    setRows(out);
    setLoading(false);
  }, [supabase, selectedDate]);

  useEffect(() => { load(); }, [load]);

  const toggleStoreActive = async (storeId: string, currentActive: boolean) => {
    setTogglingId(storeId);
    const next = !currentActive;
    const { error } = await supabase.from('stores').update({ is_active: next }).eq('id', storeId);
    if (error) {
      alert('Could not update store status: ' + error.message);
    } else {
      window.dispatchEvent(new Event('storeChange'));
      setRows(prev => prev.map(r => r.id === storeId ? { ...r, is_active: next } : r));
    }
    setTogglingId(null);
  };

  const activeStores = rows.filter(r => r.is_active);
  const visibleRows = showInactive ? rows : activeStores;

  const totalSales = visibleRows.reduce((t, r) => t + (r.netSales || 0), 0);
  const totalShort = visibleRows.reduce((t, r) => t + (r.br ? 0 : r.short), 0);
  const totalCashShort = visibleRows.reduce((t, r) => t + (r.cashDiff !== null && r.cashDiff < -0.99 ? r.cashDiff : 0), 0);
  const storesWithCashShort = visibleRows.filter(r => r.cashDiff !== null && r.cashDiff < -0.99).length;
  const ok = (b: boolean) => <span className={b ? styles.badgeSuccess : styles.badgeDefault}>{b ? '✓' : 'Pending'}</span>;

  const selectStoreInStorage = (storeId: string) => {
    try {
      localStorage.setItem('selectedStore', storeId);
      window.dispatchEvent(new Event('storeChange'));
    } catch { /* ignore */ }
  };

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>All Stores — Shift Overview</h1>
          <p className={styles.subtitle}>
            Every store&apos;s Opening, Closing (including post-midnight 12 AM – 6 AM entries), Cash, and Rista Sales matched to the same <strong>Sales Day</strong>.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isSuperAdmin && (
            <button
              className={showPilotManager ? styles.primaryButton : styles.secondaryButton}
              onClick={() => setShowPilotManager(v => !v)}
            >
              ⚙️ Pilot Stores ({activeStores.length} Active)
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.88rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            Show paused stores
          </label>
        </div>
      </div>

      {/* Unified Sales Day / Shift Date Navigation Bar */}
      <div className={styles.card} style={{ marginBottom: '1.25rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
            Selected Sales Day (Operating Shift Date)
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span>📅 {displayDate(selectedDate)}</span>
            {selectedDate === activeShiftDate && isLateNight && (
              <span style={{ fontSize: '0.78rem', fontWeight: 600, padding: '0.2rem 0.6rem', borderRadius: '6px', background: 'rgba(255,214,0,0.12)', color: 'var(--warning)', border: '1px solid rgba(255,214,0,0.3)' }}>
                🌙 Post-midnight closing active (12 AM – 6 AM entries record here)
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={selectedDate === prevShiftDate ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setSelectedDate(prevShiftDate)}
          >
            ⏮️ Yesterday ({shortDate(prevShiftDate)})
          </button>
          <button
            type="button"
            className={selectedDate === activeShiftDate ? styles.primaryButton : styles.secondaryButton}
            onClick={() => setSelectedDate(activeShiftDate)}
          >
            📅 Active Shift ({shortDate(activeShiftDate)})
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setSelectedDate(d => addDays(d, -1))}
            title="Previous day"
          >
            ‹
          </button>
          <input
            type="date"
            className={styles.searchInput}
            style={{ width: 'auto' }}
            value={selectedDate}
            max={activeShiftDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
          />
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => setSelectedDate(d => addDays(d, 1))}
            disabled={selectedDate >= activeShiftDate}
            title="Next day"
          >
            ›
          </button>
        </div>
      </div>

      {/* Pilot Store Switcher Panel */}
      {showPilotManager && (
        <div className={styles.card} style={{ marginBottom: '1.5rem', border: '1px solid var(--accent-primary)', background: 'rgba(255,107,53,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>⚙️ Pilot Rollout: Switch Stores On / Off</h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Turn on only the stores currently participating in the pilot. Switched-off stores will be hidden from data entry, header selectors, and stock reports.
              </p>
            </div>
            <button className={styles.secondaryButton} onClick={() => setShowPilotManager(false)}>✕ Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {rows.map(st => (
              <div
                key={st.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.85rem 1rem', borderRadius: '8px',
                  background: st.is_active ? 'rgba(0,200,83,0.08)' : 'var(--bg-secondary)',
                  border: st.is_active ? '1px solid var(--success)' : '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{st.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{st.brand}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleStoreActive(st.id, st.is_active)}
                  disabled={togglingId === st.id}
                  style={{
                    padding: '0.4rem 0.85rem', borderRadius: '20px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                    background: st.is_active ? 'var(--success)' : 'var(--bg-card)',
                    color: st.is_active ? '#000' : 'var(--text-secondary)',
                    border: st.is_active ? 'none' : '1px solid var(--border-color)',
                  }}
                >
                  {togglingId === st.id ? 'Saving…' : st.is_active ? '🟢 Active (Pilot)' : '⚪ Paused (Off)'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div className={styles.loading}>Loading stores for {displayDate(selectedDate)}…</div> : (
        <>
          <div className={styles.statGrid} style={{ marginBottom: '1.5rem' }}>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Net Sales ({shortDate(selectedDate)})</div>
              <div className={styles.statValue} style={{ color: totalSales > 0 ? 'var(--success)' : undefined }}>
                {totalSales > 0 ? inr(totalSales) : 'Pending upload'}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Closing Stock Completed ({shortDate(selectedDate)})</div>
              <div className={styles.statValue}>
                {visibleRows.filter(r => r.br ? r.br.flavours > 0 && r.br.closed >= r.br.flavours : r.due > 0 && r.counted >= r.due).length} / {visibleRows.length} stores
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>99 Pancakes Stock Short ({shortDate(selectedDate)})</div>
              <div className={styles.statValue} style={{ color: totalShort < 0 ? 'var(--danger)' : undefined }}>
                {inr(totalShort)}
              </div>
            </div>
            <div className={styles.statCard}>
              <div className={styles.statLabel}>Cash Shortage ({shortDate(selectedDate)})</div>
              <div className={styles.statValue} style={{ color: totalCashShort < 0 ? 'var(--danger)' : 'var(--success)' }}>
                {totalCashShort < 0 ? `-${inr(Math.abs(totalCashShort))} (${storesWithCashShort} st)` : '✓ ₹0 Short'}
              </div>
            </div>
          </div>

          <div className={styles.card} style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>🌅 Opening (Cash &amp; Stock)</th>
                  <th>🌙 Closing (Cash &amp; Stock)</th>
                  <th>📄 Rista Files ({shortDate(selectedDate)})</th>
                  <th>⚖️ Variance / Shortage</th>
                  <th>Quick View ({shortDate(selectedDate)})</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.6 }}>
                    <td style={{ fontWeight: 600 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                        <span>{r.br ? '🍨' : '🥞'} {r.name}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                        {r.brand} · {r.is_active ? '🟢 Active' : '⚪ Paused'}
                      </div>
                    </td>

                    {/* OPENING COLUMN */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.84rem' }}>
                        <div>
                          💰 Cash: {r.morningCash !== null ? (
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              {inr(r.morningCash)} <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({r.morningCashTime})</span>
                            </span>
                          ) : <span className={styles.badgeDefault}>Pending</span>}
                        </div>
                        {r.br ? (
                          <div>
                            🍨 Weigh: {r.br.opened >= r.br.flavours && r.br.flavours > 0 ? (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                ✓ {r.br.opened}/{r.br.flavours} <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({r.br.openedTime})</span>
                              </span>
                            ) : (
                              <span className={styles.badgeDefault}>
                                {r.br.opened}/{r.br.flavours} {r.br.openedTime ? `(${r.br.openedTime})` : ''}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                            📦 Opening baseline: {r.prevCountDate ? `Prev close (${shortDate(r.prevCountDate)})` : 'First count'}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* CLOSING COLUMN */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', fontSize: '0.84rem' }}>
                        <div>
                          💰 Cash: {r.eveningCash !== null ? (
                            <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                              {inr(r.eveningCash)} <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({r.eveningCashTime})</span>
                            </span>
                          ) : <span className={styles.badgeDefault}>Pending</span>}
                        </div>
                        {r.cashStatus === 'MATCH' && (
                          <div>
                            <span className={styles.badgeSuccess} title={`Counted: ${inr(r.eveningCash!)}, Expected: ${inr(r.expectedCash!)}`}>
                              ✓ Cash matched
                            </span>
                          </div>
                        )}
                        {r.cashStatus === 'SHORT' && r.cashDiff !== null && (
                          <div>
                            <Link
                              href={`/store/cash-tally?date=${selectedDate}`}
                              onClick={() => selectStoreInStorage(r.id)}
                              className={styles.badgeDanger}
                              style={{ textDecoration: 'none' }}
                              title={`Counted: ${inr(r.eveningCash!)}, Expected: ${inr(r.expectedCash!)} (Short by ${inr(Math.abs(r.cashDiff))})`}
                            >
                              ⚠ Cash Short: -{inr(Math.abs(r.cashDiff))}
                            </Link>
                          </div>
                        )}
                        {r.cashStatus === 'EXTRA' && r.cashDiff !== null && (
                          <div>
                            <Link
                              href={`/store/cash-tally?date=${selectedDate}`}
                              onClick={() => selectStoreInStorage(r.id)}
                              className={styles.badgeWarning}
                              style={{ textDecoration: 'none' }}
                              title={`Counted: ${inr(r.eveningCash!)}, Expected: ${inr(r.expectedCash!)} (Extra by ${inr(r.cashDiff)})`}
                            >
                              Extra Cash: +{inr(r.cashDiff)}
                            </Link>
                          </div>
                        )}
                        {r.br ? (
                          <div>
                            🍨 Weigh: {r.br.closed >= r.br.flavours && r.br.flavours > 0 ? (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                ✓ {r.br.closed}/{r.br.flavours} <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({r.br.closedTime})</span>
                              </span>
                            ) : (
                              <span className={styles.badgeDefault}>
                                {r.br.closed}/{r.br.flavours} {r.br.closedTime ? `(${r.br.closedTime})` : 'Pending'}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div>
                            📦 Stock: {r.due === 0 ? (
                              <span className={styles.badgeDefault}>Nothing due</span>
                            ) : r.counted >= r.due ? (
                              <span style={{ color: 'var(--success)', fontWeight: 600 }}>
                                ✓ {r.counted}/{r.due} <span style={{ fontSize: '0.74rem', color: 'var(--text-secondary)', fontWeight: 400 }}>({r.countedTime})</span>
                              </span>
                            ) : (
                              <span className={styles.badgeDefault}>
                                {r.counted}/{r.due} {r.countedTime ? `(${r.countedTime})` : 'Pending'}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* RISTA FILES COLUMN (SAME SALES DAY) */}
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.84rem' }}>
                        <div>
                          Summary {ok(r.salesUploaded)}{' '}
                          {r.netSales !== null && <strong style={{ color: 'var(--success)', marginLeft: '0.25rem' }}>{inr(r.netSales)}</strong>}
                        </div>
                        <div>
                          {r.br ? (
                            <>Sales By Items {ok(r.br.itemsUploaded)}</>
                          ) : (
                            <>Consumption Usage {ok(r.usageUploaded)}</>
                          )}
                        </div>
                        {(r.salesTime || r.usageTime) && (
                          <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)' }}>
                            🕒 {r.salesTime || r.usageTime}
                          </div>
                        )}
                      </div>
                    </td>

                    {/* VARIANCE COLUMN */}
                    <td>
                      {r.br ? (
                        !r.br.checked ? (
                          <span className={styles.badgeDefault}>Awaiting weigh &amp; sales</span>
                        ) : r.br.over > 0 ? (
                          <div>
                            <span className={styles.badgeDanger}>
                              ⚠ {grams(r.br.shortageGrams)} short ({r.br.over} flv)
                            </span>
                          </div>
                        ) : (
                          <span className={styles.badgeSuccess}>✓ 0 g shortage</span>
                        )
                      ) : (
                        <div>
                          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{inr(r.short)}</span>
                          {' / '}
                          <span style={{ color: 'var(--success)' }}>{inr(r.excess)}</span>
                          {r.problems > 0 && (
                            <div style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>
                              {r.problems} delivery not entered?
                            </div>
                          )}
                        </div>
                      )}
                      {r.cashStatus === 'SHORT' && r.cashDiff !== null && (
                        <div style={{ marginTop: '0.35rem' }}>
                          <Link
                            href={`/store/cash-tally?date=${selectedDate}`}
                            onClick={() => selectStoreInStorage(r.id)}
                            className={styles.badgeDanger}
                            style={{ textDecoration: 'none', display: 'inline-block' }}
                            title="Click to view denomination count and shift expenses"
                          >
                            💵 Cash: -{inr(Math.abs(r.cashDiff))}
                          </Link>
                        </div>
                      )}
                      {r.cashStatus === 'MATCH' && (
                        <div style={{ marginTop: '0.35rem' }}>
                          <span className={styles.badgeSuccess} style={{ fontSize: '0.74rem' }}>
                            ✓ Cash OK
                          </span>
                        </div>
                      )}
                    </td>

                    {/* QUICK ACTIONS */}
                    <td>
                      <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap' }}>
                        <Link
                          href={`/store/cash-tally?date=${selectedDate}`}
                          className={styles.secondaryButton}
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', textDecoration: 'none' }}
                          onClick={() => selectStoreInStorage(r.id)}
                          title="View or edit cash drawer & expenses"
                        >
                          💰 Cash
                        </Link>
                        <Link
                          href={`/super-admin/stock-report?date=${selectedDate}`}
                          className={styles.primaryButton}
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', textDecoration: 'none' }}
                          onClick={() => selectStoreInStorage(r.id)}
                        >
                          📊 Stock Report
                        </Link>
                        <Link
                          href={`/store/eod-report?date=${selectedDate}`}
                          className={styles.secondaryButton}
                          style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem', textDecoration: 'none' }}
                          onClick={() => selectStoreInStorage(r.id)}
                        >
                          🖨️ Day Summary
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
