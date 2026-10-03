'use client';

import { useState, useEffect } from 'react';
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

export default function SalesAnalyticsPage() {
  const supabase = createClient();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  
  const [salesData, setSalesData] = useState<DailySalesSummary[]>([]);
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
        setSalesData(data as any);
      } else {
        setSalesData([]);
      }
    } catch (error) {
      console.error('Error fetching sales data:', error);
      setSalesData([]);
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
  const totalNet = salesData.reduce((acc, curr) => acc + (curr.net_sales || 0), 0);
  const totalGross = salesData.reduce((acc, curr) => acc + (curr.gross_sales || 0), 0);
  const totalDiscount = salesData.reduce((acc, curr) => acc + (curr.total_discount || 0), 0);
  const totalSwiggy = salesData.reduce((acc, curr) => acc + (curr.swiggy_amount || 0), 0);
  const totalZomato = salesData.reduce((acc, curr) => acc + (curr.zomato_amount || 0), 0);
  const totalCash = salesData.reduce((acc, curr) => acc + (curr.cash_amount || 0), 0);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sales Analytics & Revenue Audit</h1>
          <p className={styles.subtitle}>
            Monitor store sales, channel revenue splits (Swiggy, Zomato, Walk-In Cash), and discounts
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
            Store
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
            Report Date
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

      {/* Summary KPI Cards */}
      <div className={styles.statsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Total Net Revenue</div>
          <div className={styles.statValue} style={{ color: 'var(--success)' }}>
            {formatCurrency(totalNet)}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Gross Sales</div>
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

      {/* Sales Summary Data Table */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading daily sales records...
        </div>
      ) : (
        <div className={styles.card}>
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
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {salesData.length === 0 ? (
                <tr>
                  <td colSpan={9} style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-secondary)' }}>
                    No sales reports found for the selected store/date.
                    <br />
                    <Link href="/store/sales-upload" style={{ color: 'var(--accent-primary)', marginTop: '0.5rem', display: 'inline-block' }}>
                      Click here to upload Rista POS report
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
