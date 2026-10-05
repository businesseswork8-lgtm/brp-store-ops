'use client';

import { istDate, addDays } from '@/lib/dates';
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

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(
    addDays(istDate(), -1) // the Sales Summary is uploaded at night, so yesterday is the latest full day
  );
  
  const [salesData, setSalesData] = useState<DailySalesSummary[]>([]);
  const [topItems, setTopItems] = useState<SalesItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedStore, selectedDate]);

  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('id, name, code, brands(name)').order('name');
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
          <h1 className={styles.title}>Sales Revenue & Channel Analytics</h1>
          <p className={styles.subtitle}>
            Executive sales performance, order counts, and channel revenue splits (Swiggy vs Zomato vs Walk-In Cash)
          </p>
        </div>
        <Link href="/store/sales-upload" className={styles.primaryButton}>
          + Upload POS Sales Report
        </Link>
      </div>

      {/* Filter Bar */}
      <div className={styles.filterBar} style={{ marginBottom: '1.5rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            Store Filter
          </label>
          <select
            value={selectedStore}
            onChange={e => setSelectedStore(e.target.value)}
            className={styles.selectFilter}
            style={{ width: '100%' }}
          >
            <option value="all">All Stores</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.brands?.name || s.code})
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: 1, minWidth: '180px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            Audit Date
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            className={styles.searchInput}
            style={{ width: '100%' }}
          />
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
                    <Link href="/store/sales-upload" style={{ color: 'var(--accent-primary)', marginTop: '0.5rem', display: 'inline-block' }}>
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
