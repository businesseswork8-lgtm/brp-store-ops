'use client';

import { istDate, addDays, displayDate, shortDate } from '@/lib/dates';
import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../analytics.module.css';

interface Store {
  id: string;
  name: string;
  code: string;
  brands?: { name: string };
}

interface DailySalesSummary {
  id: string;
  entry_date: string;
  store_id: string;
  stores?: { name: string; code: string; brands?: { name: string } };
  gross_sales: number;
  net_sales: number;
  total_discount: number;
  total_tax: number;
  total_orders: number;
  cash_amount: number;
  upi_amount: number;
  card_amount: number;
  swiggy_amount: number;
  zomato_amount: number;
  other_online_amount: number;
}

interface SalesItem {
  id: string;
  item_name: string;
  quantity_sold: number;
  total_price: number;
}

export default function SalesAnalyticsPage() {
  const supabase = createClient();
  const activeShiftDate = istDate();
  const yesterdayShiftDate = addDays(activeShiftDate, -1);

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(activeShiftDate);
  
  const [salesData, setSalesData] = useState<DailySalesSummary[]>([]);
  const [topItems, setTopItems] = useState<SalesItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const d = params.get('date');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        setSelectedDate(d);
      }
    }
    fetchStores();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedStore, selectedDate]);

  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('id, name, code, brands(name)').eq('is_active', true).order('name');
    if (data) setStores(data as any);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('daily_sales_summary')
        .select(`
          *,
          stores:store_id (name, code, brands(name))
        `)
        .order('entry_date', { ascending: false });
        
      if (selectedDate) {
        query = query.eq('entry_date', selectedDate);
      }

      if (selectedStore !== 'all') {
        query = query.eq('store_id', selectedStore);
      }
      
      const { data, error } = await query;
      if (!error && data) {
        // Days with only a Sales By Items upload have no money split — leave them out of totals
        setSalesData((data as any[]).filter(d => d.has_summary !== false));

        // Fetch top selling itemized products if summary exists
        if (data.length > 0) {
          const summaryIds = data.map(d => d.id);
          const { data: itemData } = await supabase
            .from('daily_sales_items')
            .select('id, item_name, quantity_sold, total_price, item_type')
            .in('sales_summary_id', summaryIds);

          // Combine the same product across stores; combo contents ("Option") are not products sold
          const byName = new Map<string, SalesItem>();
          (itemData || []).filter(i => (i.item_type || 'Item') !== 'Option').forEach(i => {
            const cur = byName.get(i.item_name) || { id: i.item_name, item_name: i.item_name, quantity_sold: 0, total_price: 0 };
            cur.quantity_sold += Number(i.quantity_sold || 0);
            cur.total_price += Number(i.total_price || 0);
            byName.set(i.item_name, cur);
          });
          setTopItems(Array.from(byName.values()).sort((a, b) => b.quantity_sold - a.quantity_sold).slice(0, 10));
        } else {
          setTopItems([]);
        }
      } else {
        setSalesData([]);
        setTopItems([]);
      }
    } catch (error) {
      console.error('Error fetching sales data:', error);
      setSalesData([]);
      setTopItems([]);
    } finally {
      setLoading(false);
    }
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  // Summary Totals
  const totalNet = salesData.reduce((acc, curr) => acc + Number(curr.net_sales || 0), 0);
  const totalGross = salesData.reduce((acc, curr) => acc + Number(curr.gross_sales || 0), 0);
  const totalDiscount = salesData.reduce((acc, curr) => acc + Number(curr.total_discount || 0), 0);
  const totalSwiggy = salesData.reduce((acc, curr) => acc + Number(curr.swiggy_amount || 0), 0);
  const totalZomato = salesData.reduce((acc, curr) => acc + Number(curr.zomato_amount || 0), 0);
  const totalCash = salesData.reduce((acc, curr) => acc + Number(curr.cash_amount || 0), 0);
  const totalUpi = salesData.reduce((acc, curr) => acc + Number(curr.upi_amount || 0), 0);
  const totalCard = salesData.reduce((acc, curr) => acc + Number(curr.card_amount || 0), 0);
  const grandChannelTotal = totalSwiggy + totalZomato + totalCash + totalUpi + totalCard || 1;
  const upiPct = Math.round((totalUpi / grandChannelTotal) * 100);
  const cardPct = Math.round((totalCard / grandChannelTotal) * 100);

  const swiggyPct = Math.round((totalSwiggy / grandChannelTotal) * 100);
  const zomatoPct = Math.round((totalZomato / grandChannelTotal) * 100);
  const cashPct = Math.round((totalCash / grandChannelTotal) * 100);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sales — {displayDate(selectedDate)}</h1>
          <p className={styles.subtitle}>Daily sales by store and payment channel (matched to the Shift Operating Date).</p>
        </div>
        <Link href="/analytics/trends" className={styles.primaryButton}>
          📈 See trends over time
        </Link>
      </div>

      {/* Unified Store & Sales Day Filter Bar */}
      <div className={styles.card} style={{
        marginBottom: '1.5rem',
        padding: '1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        background: 'linear-gradient(90deg, rgba(95,107,255,0.10), rgba(0,200,83,0.05))',
        border: '1px solid rgba(95,107,255,0.3)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: '#9aa4ff', marginRight: '0.25rem' }}>
              🏬 Store:
            </span>
            <button
              type="button"
              onClick={() => setSelectedStore('all')}
              style={{
                padding: '0.4rem 0.85rem',
                borderRadius: '8px',
                border: selectedStore === 'all' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: selectedStore === 'all' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: selectedStore === 'all' ? '#fff' : 'var(--text-primary)',
                fontWeight: selectedStore === 'all' ? 700 : 500,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              All Stores ({stores.length})
            </button>
            {stores.map(s => {
              const active = selectedStore === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSelectedStore(s.id)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: '8px',
                    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    background: active ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    fontWeight: active ? 700 : 500,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                  }}
                >
                  {s.name}
                </button>
              );
            })}
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setSelectedDate(yesterdayShiftDate)}
              style={{
                padding: '0.42rem 0.85rem',
                borderRadius: '8px',
                border: selectedDate === yesterdayShiftDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: selectedDate === yesterdayShiftDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: selectedDate === yesterdayShiftDate ? '#fff' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              ⏮️ Yesterday ({shortDate(yesterdayShiftDate)})
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(activeShiftDate)}
              style={{
                padding: '0.42rem 0.85rem',
                borderRadius: '8px',
                border: selectedDate === activeShiftDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: selectedDate === activeShiftDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: selectedDate === activeShiftDate ? '#fff' : 'var(--text-primary)',
                fontWeight: 600,
                fontSize: '0.84rem',
                cursor: 'pointer',
              }}
            >
              📅 Active Shift ({shortDate(activeShiftDate)})
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(addDays(selectedDate, -1))}
              style={{ padding: '0.42rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
              title="Previous Day"
            >
              ‹
            </button>
            <input
              type="date"
              value={selectedDate}
              max={activeShiftDate}
              onChange={e => e.target.value && setSelectedDate(e.target.value)}
              className={styles.searchInput}
              style={{ width: 'auto', padding: '0.42rem 0.75rem' }}
            />
            <button
              type="button"
              onClick={() => selectedDate < activeShiftDate && setSelectedDate(addDays(selectedDate, 1))}
              disabled={selectedDate >= activeShiftDate}
              style={{ padding: '0.42rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', opacity: selectedDate >= activeShiftDate ? 0.4 : 1 }}
              title="Next Day"
            >
              ›
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.statsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Total Net Revenue</div>
          <div className={styles.statValue} style={{ color: 'var(--success)' }}>
            {formatCurrency(totalNet)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Gross Revenue</div>
          <div className={styles.statValue}>
            {formatCurrency(totalGross)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Total Discounts</div>
          <div className={styles.statValue} style={{ color: 'var(--warning)' }}>
            {formatCurrency(totalDiscount)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>🛵 Swiggy Revenue</div>
          <div className={styles.statValue} style={{ color: '#fc8019' }}>
            {formatCurrency(totalSwiggy)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>🔴 Zomato Revenue</div>
          <div className={styles.statValue} style={{ color: '#cb202d' }}>
            {formatCurrency(totalZomato)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>🏬 Walk-In Cash</div>
          <div className={styles.statValue} style={{ color: 'var(--success)' }}>
            {formatCurrency(totalCash)}
          </div>
        </div>
      </div>

      {/* Visual Channel Distribution Progress Bar */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 0.75rem 0' }}>How customers paid</h3>
        
        <div style={{ display: 'flex', height: '24px', borderRadius: '12px', overflow: 'hidden', background: 'var(--bg-secondary)', marginBottom: '1rem' }}>
          <div style={{ width: `${swiggyPct}%`, background: '#fc8019', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {swiggyPct > 5 ? `${swiggyPct}%` : ''}
          </div>
          <div style={{ width: `${zomatoPct}%`, background: '#cb202d', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {zomatoPct > 5 ? `${zomatoPct}%` : ''}
          </div>
          <div style={{ width: `${cashPct}%`, background: 'var(--success)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {cashPct > 5 ? `${cashPct}%` : ''}
          </div>
          <div style={{ width: `${upiPct}%`, background: '#5f6bff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {upiPct > 5 ? `${upiPct}%` : ''}
          </div>
          <div style={{ width: `${cardPct}%`, background: '#9e9eb8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 700, color: '#fff' }}>
            {cardPct > 5 ? `${cardPct}%` : ''}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', fontSize: '0.9rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#fc8019', display: 'inline-block' }}></span>
            <span>Swiggy: <strong>{formatCurrency(totalSwiggy)} ({swiggyPct}%)</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#cb202d', display: 'inline-block' }}></span>
            <span>Zomato: <strong>{formatCurrency(totalZomato)} ({zomatoPct}%)</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: 'var(--success)', display: 'inline-block' }}></span>
            <span>Cash: <strong>{formatCurrency(totalCash)} ({cashPct}%)</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#5f6bff', display: 'inline-block' }}></span>
            <span>UPI: <strong>{formatCurrency(totalUpi)} ({upiPct}%)</strong></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#9e9eb8', display: 'inline-block' }}></span>
            <span>Card: <strong>{formatCurrency(totalCard)} ({cardPct}%)</strong></span>
          </div>
        </div>
      </div>

      {/* Top Selling Itemized Products */}
      {topItems.length > 0 && (
        <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>Top Selling POS Items</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>POS Product Name</th>
                <th>Units Sold</th>
                <th>Total Sales Value</th>
              </tr>
            </thead>
            <tbody>
              {topItems.map((item, idx) => (
                <tr key={idx}>
                  <td style={{ fontWeight: 600 }}>{item.item_name}</td>
                  <td style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{item.quantity_sold} pcs</td>
                  <td>{formatCurrency(item.total_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Sales Summary Data Table */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading daily sales records...
        </div>
      ) : (
        <div className={styles.card}>
          <h3>Daily Sales Reports ({selectedDate})</h3>
          <table className={styles.table} style={{ width: '100%' }}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Store</th>
                <th>Net Sales</th>
                <th>Gross Sales</th>
                <th>Discounts</th>
                <th>Swiggy</th>
                <th>Zomato</th>
                <th>Walk-In Cash</th>
                <th>Total Orders</th>
              </tr>
            </thead>
            <tbody>
              {salesData.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                    No sales reports uploaded for this date.
                    <br />
                    <Link href="/store/upload" style={{ color: 'var(--accent-primary)', marginTop: '0.5rem', display: 'inline-block' }}>
                      Click here to upload Rista POS CSV report
                    </Link>
                  </td>
                </tr>
              ) : (
                salesData.map(row => (
                  <tr key={row.id}>
                    <td style={{ fontWeight: 600 }}>{row.entry_date}</td>
                    <td>
                      <span className={styles.badge}>
                        {row.stores?.name || 'Store'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>
                      {formatCurrency(row.net_sales)}
                    </td>
                    <td>{formatCurrency(row.gross_sales)}</td>
                    <td style={{ color: 'var(--warning)' }}>{formatCurrency(row.total_discount)}</td>
                    <td style={{ color: '#fc8019' }}>{formatCurrency(row.swiggy_amount)}</td>
                    <td style={{ color: '#cb202d' }}>{formatCurrency(row.zomato_amount)}</td>
                    <td>{formatCurrency(row.cash_amount)}</td>
                    <td>{row.total_orders}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
