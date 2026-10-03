'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../analytics.module.css';

interface Store {
  id: string;
  name: string;
  brand: string;
}

interface DailySalesSummary {
  id: string;
  date: string;
  store: { name: string; brand: string };
  gross_sales: number;
  net_sales: number;
  discounts: number;
  cash_sales: number;
  upi_sales: number;
  card_sales: number;
  total_orders: number;
}

export default function SalesAnalyticsPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  const [salesData, setSalesData] = useState<DailySalesSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    fetchData();
  }, [selectedStore, selectedDate]);

  const fetchStores = async () => {
    const { data } = await supabase.from('stores').select('id, name, brand');
    if (data) setStores(data);
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      let query = supabase
        .from('daily_sales_summary')
        .select(`
          id, date, gross_sales, net_sales, discounts, cash_sales, upi_sales, card_sales, total_orders,
          store:stores(name, brand)
        `)
        .eq('date', selectedDate)
        .order('date', { ascending: false });
        
      if (selectedStore !== 'all') query = query.eq('store_id', selectedStore);
      
      const { data } = await query;
      
      if (data) {
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

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-IN');
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0,
    }).format(amount || 0);
  };

  const getStoreBadge = (brand: string, name: string) => {
    const isPancakes = brand === '99 Pancakes' || name?.includes('Pancakes');
    return (
      <span className={`${styles.badge} ${isPancakes ? styles.badgePancakes : styles.badgeBR}`}>
        {name}
      </span>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Sales Analytics</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Daily sales summaries and performance</p>
        </div>
      </div>

      <div className={styles.banner}>
        📊 Sales analytics will be fully available after POS data upload is implemented in Phase 2.
      </div>

      <div className={styles.filterBar}>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Date</label>
          <input 
            type="date" 
            className={styles.input} 
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
          />
        </div>
        <div className={styles.filterGroup}>
          <label className={styles.filterLabel}>Store</label>
          <select 
            className={styles.select}
            value={selectedStore}
            onChange={(e) => setSelectedStore(e.target.value)}
          >
            <option value="all">All Stores</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>{store.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Store</th>
              <th>Gross Sales</th>
              <th>Net Sales</th>
              <th>Discounts</th>
              <th>Cash</th>
              <th>UPI</th>
              <th>Card</th>
              <th>Orders</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} style={{ textAlign: 'center', padding: '2rem' }}>Loading data...</td></tr>
            ) : salesData.length === 0 ? (
              <tr><td colSpan={9} className={styles.emptyState}>No sales data available for this date yet. Phase 2 feature.</td></tr>
            ) : (
              salesData.map(sale => (
                <tr key={sale.id}>
                  <td>{formatDate(sale.date)}</td>
                  <td>{getStoreBadge(sale.store.brand, sale.store.name)}</td>
                  <td className={styles.money}>{formatCurrency(sale.gross_sales)}</td>
                  <td className={styles.money}>{formatCurrency(sale.net_sales)}</td>
                  <td style={{ color: 'var(--danger)' }}>{formatCurrency(sale.discounts)}</td>
                  <td>{formatCurrency(sale.cash_sales)}</td>
                  <td>{formatCurrency(sale.upi_sales)}</td>
                  <td>{formatCurrency(sale.card_sales)}</td>
                  <td>{sale.total_orders}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
