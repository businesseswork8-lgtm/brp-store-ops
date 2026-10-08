'use client';

import React, { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { displayUnit, toDisplay } from '@/lib/stock/units';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';
import styles from '../store.module.css';
import { isBRStore, toReportRows, BRReportRow, grams, signedGrams } from '@/lib/br';


export default function EODReportPage() {
  const { supabase, store: activeStore, loading: storeLoading } = useActiveStore();
  const todayDate = istDate();

  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [loading, setLoading] = useState(true);

  const [posSales, setPosSales] = useState<any>(null);
  const [morningCash, setMorningCash] = useState<number | null>(null);
  const [eveningCash, setEveningCash] = useState<number | null>(null);
  const [cashTransactions, setCashTransactions] = useState<any[]>([]);
  const [wastageCount, setWastageCount] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [varianceAlerts, setVarianceAlerts] = useState<any[]>([]);
  const [stockNote, setStockNote] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [brRows, setBrRows] = useState<BRReportRow[] | null>(null);

  const loadStoreData = useCallback(async () => {
    if (!activeStore) { if (!storeLoading) setLoading(false); return; }
    setLoading(true);
    const storeId = activeStore.id;

    const [
      { data: salesData },
      { data: cash },
      { data: txs },
      { data: wastage },
      { data: rpcData, error: rpcErr }
    ] = await Promise.all([
      supabase.from('daily_sales_summary').select('*').eq('store_id', storeId).eq('entry_date', selectedDate).maybeSingle(),
      supabase.from('daily_cash_tally').select('tally_type, total_amount').eq('store_id', storeId).eq('entry_date', selectedDate),
      supabase.from('daily_cash_transactions').select('*').eq('store_id', storeId).eq('entry_date', selectedDate),
      supabase.from('daily_wastage_log').select('id').eq('store_id', storeId).eq('entry_date', selectedDate),
      supabase.rpc('stock_variance_report', { p_store_id: storeId, p_from: null, p_to: selectedDate }),
    ]);

    if (isBRStore(activeStore)) {
      const { data: br, error: brErr } = await supabase.rpc('br_daily_report', { p_store_id: storeId, p_date: selectedDate });
      setBrRows(brErr ? [] : toReportRows(br));
    } else setBrRows(null);
    setPosSales(salesData && salesData.has_summary !== false ? salesData : null);
    const m = cash?.find(c => c.tally_type === 'morning');
    const e = cash?.find(c => c.tally_type === 'evening');
    setMorningCash(m ? Number(m.total_amount) : null);
    setEveningCash(e ? Number(e.total_amount) : null);
    setCashTransactions(txs || []);
    setWastageCount(wastage?.length || 0);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((rpcData as any[]) || []);
    setStockError(rpcErr ? rpcErr.message : null);
    // Items counted on this day, checked against their previous count
    const today = rows.filter(r => r.closing_date === selectedDate);
    setVarianceAlerts(today.filter(r => r.status === 'SHORT' || r.status === 'CHECK_RECEIVED'));
    const incomplete = today.filter(r => ['SALES_DATA_MISSING', 'NO_SKU', 'UNIT_MISMATCH'].includes(r.status)).length;
    setStockNote(
      rpcErr ? null
      : today.length === 0 ? 'No stock was counted on this day (or items have no earlier count yet).'
      : incomplete ? `${incomplete} item(s) can't be checked yet — Rista usage not uploaded for some days, or item not linked to Rista.`
      : null);
    setLoading(false);
  }, [supabase, activeStore, selectedDate, storeLoading]);

  useEffect(() => { loadStoreData(); }, [loadStoreData]);

  const expensesTotal = cashTransactions
    .filter(t => t.tx_type === 'expense')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const depositsTotal = cashTransactions
    .filter(t => t.tx_type === 'bank_deposit')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  // Cash check: morning cash + cash sales - expenses - bank deposits should equal evening cash
  const expectedCash = morningCash !== null && posSales
    ? morningCash + Number(posSales.cash_amount || 0) - expensesTotal - depositsTotal
    : null;
  const cashDiff = expectedCash !== null && eveningCash !== null ? eveningCash - expectedCash : null;
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return 'N/A';
    return `₹ ${Number(val).toLocaleString('en-IN')}`;
  };

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>End-Of-Day (EOD) Operations Summary</h1>
          <p className={styles.subtitle}>
            Comprehensive daily operational closing report for {activeStore ? activeStore.name : 'Selected Store'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '0.6rem 1.2rem',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🖨️ Print / Save PDF
          </button>
          <Link href="/store" className={styles.backLink}>← Back</Link>
        </div>
      </header>

      {/* Date Filter Bar */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
          <div>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Target Store</span>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
              🏬 {activeStore ? activeStore.name : 'Loading...'}
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
              Report Date
            </label>
            <input
              type="date"
              value={selectedDate}
              max={todayDate}
              onChange={e => setSelectedDate(e.target.value)}
              style={{ padding: '0.6rem 1rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            />
          </div>
        </div>
      </div>

      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Compiling End-of-Day summary...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Section 1: Sales Revenue Summary */}
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>1. Sales</h3>
            {posSales ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Net Sales</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>
                    {formatCurrency(posSales.net_sales)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gross Sales</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                    {formatCurrency(posSales.gross_sales)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Discounts</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--warning)' }}>
                    {formatCurrency(posSales.total_discount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🛵 Swiggy Revenue</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fc8019' }}>
                    {formatCurrency(posSales.swiggy_amount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🔴 Zomato Revenue</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#cb202d' }}>
                    {formatCurrency(posSales.zomato_amount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>💵 Cash</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.cash_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>📱 UPI</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.upi_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>💳 Card</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.card_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🧾 Orders</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{posSales.total_orders}</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', color: 'var(--warning)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                ⚠ Sales Summary has not been uploaded for {selectedDate} yet.
              </div>
            )}
          </div>

          {/* Section 2: Cash Denomination Tallies */}
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>2. Cash Check</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Morning cash count</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {morningCash !== null ? formatCurrency(morningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Evening cash count</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {eveningCash !== null ? formatCurrency(eveningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
              </div>
            </div>

            {/* Expenses & Deposits Summary */}
            {(expensesTotal > 0 || depositsTotal > 0) && (
              <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,23,68,0.06)', border: '1px solid rgba(255,23,68,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Daily Cash Expenses (Tea, etc.)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--danger)', marginTop: '0.2rem' }}>
                    - {formatCurrency(expensesTotal)}
                  </div>
                  {cashTransactions.filter(t => t.tx_type === 'expense').length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {cashTransactions.filter(t => t.tx_type === 'expense').map(t => `${t.category}: ₹${t.amount}`).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,214,0,0.06)', border: '1px solid rgba(255,214,0,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bank Cash Deposits</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)', marginTop: '0.2rem' }}>
                    - {formatCurrency(depositsTotal)}
                  </div>
                  {cashTransactions.filter(t => t.tx_type === 'bank_deposit').length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {cashTransactions.filter(t => t.tx_type === 'bank_deposit').map(t => `${t.category}: ₹${t.amount}`).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
              {cashDiff === null ? (
                <span style={{ color: 'var(--text-secondary)' }}>
                  Cash check needs: morning count, evening count and the Sales Summary upload.
                </span>
              ) : (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Morning {formatCurrency(morningCash)} + cash sales {formatCurrency(posSales.cash_amount)}
                    {expensesTotal > 0 ? ` − expenses ${formatCurrency(expensesTotal)}` : ''}
                    {depositsTotal > 0 ? ` − bank deposit ${formatCurrency(depositsTotal)}` : ''}
                    {' '}= expected {formatCurrency(expectedCash)}
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.25rem',
                    color: Math.abs(cashDiff) < 1 ? 'var(--success)' : cashDiff < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {Math.abs(cashDiff) < 1 ? '✓ Cash matches'
                      : cashDiff < 0 ? `⚠ Short by ${formatCurrency(-cashDiff)}` : `Extra ${formatCurrency(cashDiff)}`}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    ✓ Shift expenses &amp; bank deposits are accounted for in expected cash.
                  </div>
                </>
              )}
            </div>
            <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Wastage entries: {wastageCount}</div>
          </div>

          {/* Section 3 (Baskin Robbins): ice cream per flavour */}
          {brRows && (() => {
            const effectiveAllow = (r: BRReportRow) => (r.allowance > 0 ? r.allowance : Math.round(r.sold * 0.05));
            const counted = brRows.filter(r => r.opening !== null && r.closing !== null).length;
            const bad = brRows.filter(r => {
              const allow = effectiveAllow(r);
              const gap = r.gap ?? 0;
              return r.opening !== null && r.closing !== null && (gap > allow || gap < -allow);
            });
            const totalShortage = brRows.reduce((sum, r) => {
              const allow = effectiveAllow(r);
              const gap = r.gap ?? 0;
              return sum + (r.opening !== null && r.closing !== null && gap > allow ? gap - allow : 0);
            }, 0);
            const noSales = brRows.some(r => r.status === 'NO_SALES');
            return (
              <div className={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, color: 'var(--accent-primary)' }}>3. Ice Cream Stock &amp; Shortage</h3>
                  {totalShortage > 0 && (
                    <span style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '1.05rem' }}>
                      Overall Shortage: {totalShortage >= 1000 ? `${(totalShortage / 1000).toFixed(2)} kg` : `${Math.round(totalShortage)} g`}
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {counted} of {brRows.length} bulk flavours weighed at opening and closing. 5% tasting allowance applied proportional to sales.
                </div>
                {noSales ? (
                  <div style={{ color: 'var(--warning)' }}>⚠ Sales By Items not uploaded for {selectedDate} — flavours can&apos;t be checked yet.</div>
                ) : counted === 0 ? null : bad.length === 0 ? (
                  <div style={{ color: 'var(--success)' }}>✓ Every weighed flavour is within its 5% tasting allowance! (0 g shortage)</div>
                ) : (
                  <table className={styles.table}>
                    <thead><tr><th>Flavour</th><th>Used</th><th>Sold</th><th>Wasted</th><th>Gap</th><th>Allowance (5%)</th><th>Shortage</th><th>Status</th></tr></thead>
                    <tbody>
                      {bad.map(r => {
                        const allow = effectiveAllow(r);
                        const gap = r.gap ?? 0;
                        const shortage = gap > allow ? gap - allow : 0;
                        return (
                          <tr key={r.item_id} style={{ background: shortage > 0 ? 'rgba(255,23,68,0.08)' : undefined }}>
                            <td style={{ fontWeight: 600 }}>{r.flavour}</td>
                            <td>{grams(r.used)}</td><td>{grams(r.sold)}</td><td>{r.wasted ? grams(r.wasted) : '—'}</td>
                            <td style={{ fontWeight: 700, color: shortage > 0 ? 'var(--danger)' : undefined }}>{signedGrams(r.gap)}</td>
                            <td>{grams(allow)}</td>
                            <td style={{ fontWeight: 700, color: shortage > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                              {shortage > 0 ? `+${grams(shortage)}` : '0 g'}
                            </td>
                            <td><span className={shortage > 0 ? styles.badgeDanger : styles.badge}>{shortage > 0 ? '⚠ Over' : 'Check count'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}

          {/* Section 3: Stock Variance & Audit Highlights */}
          {!brRows && <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>3. Stock Short</h3>
            {stockError ? (
              <div style={{ color: 'var(--danger)' }}>Could not check stock: {stockError}</div>
            ) : varianceAlerts.length === 0 ? (
              <div style={{ color: stockNote ? 'var(--text-secondary)' : 'var(--success)' }}>
                {stockNote || `✓ Nothing short on ${selectedDate}.`}
              </div>) : (
              <>
              {stockNote && <p style={{ color: 'var(--text-secondary)' }}>{stockNote}</p>}
              <table className={styles.table}>
                <thead>
                  <tr><th>Item</th><th>Expected</th><th>Counted</th><th>Difference</th><th>₹</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {varianceAlerts.map(r => {
                    const u = displayUnit(r.rista_unit, r.uom);
                    const d = (q: number) => toDisplay(Number(q), r.rista_unit, r.uom);
                    return (
                      <tr key={r.item_id} style={{ background: 'rgba(255,23,68,0.08)' }}>
                        <td style={{ fontWeight: 600 }}>{r.item_name}</td>
                        <td>{d(r.system_closing)} {u}</td>
                        <td>{d(r.actual_closing)} {u}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 700 }}>{signed(d(r.variance))} {u}</td>
                        <td style={{ fontWeight: 700 }}>{r.rate ? `₹${Math.round(Number(r.variance_amount)).toLocaleString('en-IN')}` : '—'}</td>
                        <td><span className={styles.badgeDanger}>{r.status === 'CHECK_RECEIVED' ? '⚠ Delivery not entered?' : '⚠ Short'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              </>
            )}
          </div>}
        </div>
      )}
    </div>
  );
}
