'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../store.module.css';

type Store = { id: string; name: string; code: string };

export default function EODReportPage() {
  const supabase = createClient();
  const todayDate = new Date().toISOString().split('T')[0];

  const [activeStore, setActiveStore] = useState<Store | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [loading, setLoading] = useState(true);

  // Data metrics
  const [posSales, setPosSales] = useState<any>(null);
  const [morningCash, setMorningCash] = useState<number | null>(null);
  const [eveningCash, setEveningCash] = useState<number | null>(null);
  const [wastageCount, setWastageCount] = useState(0);
  const [varianceAlerts, setVarianceAlerts] = useState<any[]>([]);

  useEffect(() => {
    loadStoreData();

    const handleStoreChange = () => {
      loadStoreData();
    };

    window.addEventListener('storeChange', handleStoreChange);
    return () => window.removeEventListener('storeChange', handleStoreChange);
  }, [selectedDate]);

  async function loadStoreData() {
    setLoading(true);
    let storeId = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');

    if (!storeId) {
      const { data: stores } = await supabase.from('stores').select('id, name, code').order('name');
      if (stores && stores.length > 0) {
        storeId = stores[0].id;
      }
    }

    if (storeId) {
      localStorage.setItem('selectedStore', storeId);
      localStorage.setItem('brp_selected_store', storeId);
    }

    if (!storeId) {
      setLoading(false);
      return;
    }

    // Fetch store info
    const { data: storeData } = await supabase
      .from('stores')
      .select('id, name, code')
      .eq('id', storeId)
      .single();
    if (storeData) setActiveStore(storeData);

    // 1. Fetch POS Sales Summary
    const { data: salesData } = await supabase
      .from('daily_sales_summary')
      .select('*')
      .eq('store_id', storeId)
      .eq('entry_date', selectedDate)
      .maybeSingle();

    setPosSales(salesData);

    // 2. Fetch Cash Tallies
    const { data: mCash } = await supabase
      .from('daily_cash_tally')
      .select('total_amount')
      .eq('store_id', storeId)
      .eq('entry_date', selectedDate)
      .eq('tally_type', 'morning')
      .maybeSingle();

    setMorningCash(mCash ? mCash.total_amount : null);

    const { data: eCash } = await supabase
      .from('daily_cash_tally')
      .select('total_amount')
      .eq('store_id', storeId)
      .eq('entry_date', selectedDate)
      .eq('tally_type', 'evening')
      .maybeSingle();

    setEveningCash(eCash ? eCash.total_amount : null);

    // 3. Fetch Wastage
    const { data: wastage } = await supabase
      .from('daily_wastage_log')
      .select('id')
      .eq('store_id', storeId)
      .eq('entry_date', selectedDate);

    setWastageCount(wastage?.length || 0);

    // 4. Fetch Stock Variance
    const { data: rpcData } = await supabase.rpc('calculate_daily_variance', {
      p_store_id: storeId,
      p_date: selectedDate,
    });

    if (rpcData) {
      const alerts = (rpcData as any[]).filter(r => r.status === 'EXCEEDED');
      setVarianceAlerts(alerts);
    } else {
      setVarianceAlerts([]);
    }

    setLoading(false);
  }

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
          <a href="/store" style={{ padding: '0.6rem 1.2rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>
            ← Back to Operations
          </a>
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
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>1. POS Sales Revenue & Channel Split</h3>
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
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🏬 Walk-In Cash</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>
                    {formatCurrency(posSales.cash_amount)}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', color: 'var(--warning)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                ⚠ Rista POS Sales report has not been uploaded for {selectedDate} yet.
              </div>
            )}
          </div>

          {/* Section 2: Cash Denomination Tallies */}
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>2. Cash Register Tally Summary</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Morning Shift Opening Cash</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {morningCash !== null ? formatCurrency(morningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Evening Shift Closing Cash</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {eveningCash !== null ? formatCurrency(eveningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
              </div>
            </div>
          </div>

          {/* Section 3: Stock Variance & Audit Highlights */}
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>3. Raw Material Audit Discrepancies</h3>
            {varianceAlerts.length === 0 ? (
              <div style={{ padding: '1rem', color: 'var(--success)', background: 'rgba(0,200,83,0.1)', borderRadius: '8px' }}>
                ✓ No inventory leakage or stock consumption alerts detected for {selectedDate}.
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Item Name</th>
                    <th>Category</th>
                    <th>Actual Used</th>
                    <th>POS Theoretical</th>
                    <th>Variance</th>
                    <th>Variance %</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {varianceAlerts.map(alert => (
                    <tr key={alert.item_id} style={{ background: 'rgba(255,23,68,0.08)' }}>
                      <td style={{ fontWeight: 600 }}>{alert.item_name}</td>
                      <td>{alert.category_name}</td>
                      <td>{alert.actual_consumption} {alert.uom}</td>
                      <td style={{ color: 'var(--accent-primary)' }}>{alert.theoretical_consumption} {alert.uom}</td>
                      <td style={{ color: 'var(--danger)', fontWeight: 700 }}>+{alert.variance} {alert.uom}</td>
                      <td style={{ fontWeight: 700 }}>+{alert.variance_percent}%</td>
                      <td>
                        <span className={styles.badgeDanger}>⚠ Exceeded</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
