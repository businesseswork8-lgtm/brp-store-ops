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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [posSales, setPosSales] = useState<any>(null);
  const [morningCash, setMorningCash] = useState<number | null>(null);
  const [eveningCash, setEveningCash] = useState<number | null>(null);
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

    const [{ data: salesData }, { data: cash }, { data: wastage }, { data: rpcData, error: rpcErr }] = await Promise.all([
      supabase.from('daily_sales_summary').select('*').eq('store_id', storeId).eq('entry_date', selectedDate).maybeSingle(),
      supabase.from('daily_cash_tally').select('tally_type, total_amount').eq('store_id', storeId).eq('entry_date', selectedDate),
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

  // Cash check: morning cash + cash sales should equal evening cash
  const expectedCash = morningCash !== null && posSales ? morningCash + Number(posSales.cash_amount || 0) : null;
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

            <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
              {cashDiff === null ? (
                <span style={{ color: 'var(--text-secondary)' }}>
                  Cash check needs: morning count, evening count and the Sales Summary upload.
                </span>
              ) : (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Morning {formatCurrency(morningCash)} + cash sales {formatCurrency(posSales.cash_amount)} = expected {formatCurrency(expectedCash)}
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.25rem',
                    color: Math.abs(cashDiff) < 1 ? 'var(--success)' : cashDiff < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {Math.abs(cashDiff) < 1 ? '✓ Cash matches'
                      : cashDiff < 0 ? `⚠ Short by ${formatCurrency(-cashDiff)}` : `Extra ${formatCurrency(cashDiff)}`}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    Note: cash paid out or deposited during the day is not tracked yet.
                  </div>
                </>
              )}
            </div>
            <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)' }}>Wastage entries: {wastageCount}</div>
          </div>

          {/* Section 3 (Baskin Robbins): ice cream per flavour */}
          {brRows && (() => {
            const counted = brRows.filter(r => r.status !== 'NOT_COUNTED').length;
            const bad = brRows.filter(r => r.status === 'OVER' || r.status === 'CHECK');
            const noSales = brRows.some(r => r.status === 'NO_SALES');
            return (
              <div className={styles.card}>
                <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>3. Ice Cream</h3>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                  {counted} of {brRows.length} flavours weighed at opening and closing.
                </div>
                {noSales ? (
                  <div style={{ color: 'var(--warning)' }}>⚠ Sales By Items not uploaded for {selectedDate} — flavours can&apos;t be checked yet.</div>
                ) : counted === 0 ? null : bad.length === 0 ? (
                  <div style={{ color: 'var(--success)' }}>✓ Every weighed flavour is within its tasting allowance.</div>
                ) : (
                  <table className={styles.table}>
                    <thead><tr><th>Flavour</th><th>Used</th><th>Sold</th><th>Wasted</th><th>Gap</th><th>Allowance</th><th>Status</th></tr></thead>
                    <tbody>
                      {bad.map(r => (
                        <tr key={r.item_id} style={{ background: r.status === 'OVER' ? 'rgba(255,23,68,0.08)' : undefined }}>
                          <td style={{ fontWeight: 600 }}>{r.flavour}</td>
                          <td>{grams(r.used)}</td><td>{grams(r.sold)}</td><td>{r.wasted ? grams(r.wasted) : '—'}</td>
                          <td style={{ fontWeight: 700, color: r.status === 'OVER' ? 'var(--danger)' : undefined }}>{signedGrams(r.gap)}</td>
                          <td>{grams(r.allowance)}</td>
                          <td><span className={r.status === 'OVER' ? styles.badgeDanger : styles.badge}>{r.status === 'OVER' ? '⚠ Over' : 'Check count'}</span></td>
                        </tr>
                      ))}
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
