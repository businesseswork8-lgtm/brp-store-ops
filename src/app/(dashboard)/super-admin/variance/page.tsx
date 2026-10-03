'use client';

import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../super-admin.module.css';

interface Store {
  id: string;
  name: string;
  brand: string;
}

interface StockEntry {
  id: string;
  date: string;
  store: { name: string; brand: string };
  item: { name: string };
  opening_qty: number;
  closing_qty: number;
  consumption_qty: number;
  submitted_by: { full_name: string };
  created_at: string;
}

interface CashTally {
  id: string;
  date: string;
  store: { name: string; brand: string };
  shift_type: string;
  total_amount: number;
  submitted_by: { full_name: string };
}

interface WastageEntry {
  id: string;
  date: string;
  store: { name: string; brand: string };
  item: { name: string };
  quantity: number;
  reason: string;
  submitted_by: { full_name: string };
}

export default function VarianceOverviewPage() {
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  
  const [stockEntries, setStockEntries] = useState<StockEntry[]>([]);
  const [cashTallies, setCashTallies] = useState<CashTally[]>([]);
  const [wastageEntries, setWastageEntries] = useState<WastageEntry[]>([]);
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
      // Fetch Stock Entries
      let stockQuery = supabase
        .from('stock_entries')
        .select(`
          id, date, opening_qty, closing_qty, consumption_qty, created_at,
          store:stores(name, brand),
          item:inventory_items(name),
          submitted_by:profiles(full_name)
        `)
        .eq('date', selectedDate)
        .order('created_at', { ascending: false });
        
      if (selectedStore !== 'all') stockQuery = stockQuery.eq('store_id', selectedStore);
      const { data: stockData } = await stockQuery;
      
      // Fetch Cash Tallies
      let cashQuery = supabase
        .from('cash_tallies')
        .select(`
          id, date, shift_type, total_amount,
          store:stores(name, brand),
          submitted_by:profiles(full_name)
        `)
        .eq('date', selectedDate)
        .order('created_at', { ascending: false });
        
      if (selectedStore !== 'all') cashQuery = cashQuery.eq('store_id', selectedStore);
      const { data: cashData } = await cashQuery;
      
      // Fetch Wastage
      let wastageQuery = supabase
        .from('wastage_entries')
        .select(`
          id, date, quantity, reason,
          store:stores(name, brand),
          item:inventory_items(name),
          submitted_by:profiles(full_name)
        `)
        .eq('date', selectedDate)
        .order('created_at', { ascending: false });
        
      if (selectedStore !== 'all') wastageQuery = wastageQuery.eq('store_id', selectedStore);
      const { data: wastageData } = await wastageQuery;

      setStockEntries((stockData as any) || []);
      setCashTallies((cashData as any) || []);
      setWastageEntries((wastageData as any) || []);
    } catch (error) {
      console.error('Error fetching data:', error);
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
      maximumFractionDigits: 2,
    }).format(amount);
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
          <h1 className={styles.title}>Super Admin Overview</h1>
          <p style={{ color: 'var(--text-secondary)' }}>View operations data across all stores</p>
        </div>
      </div>

      <div className={styles.banner}>
        🚧 Full variance analysis coming in Phase 2 — data collection is active!
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

      <div className={styles.statsRow}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Stock Entries Today</span>
          <span className={styles.statValue}>{stockEntries.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Cash Tallies Today</span>
          <span className={styles.statValue}>{cashTallies.length}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Wastage Logged Today</span>
          <span className={styles.statValue}>{wastageEntries.length}</span>
        </div>
      </div>

      {loading ? (
        <div className={styles.loading}>Loading data...</div>
      ) : (
        <>
          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Stock Entries</h2>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Item</th>
                    <th>Opening</th>
                    <th>Closing</th>
                    <th>Consumption</th>
                    <th>Staff</th>
                    <th>Submitted At</th>
                  </tr>
                </thead>
                <tbody>
                  {stockEntries.length === 0 ? (
                    <tr><td colSpan={8} className={styles.emptyState}>No stock entries found for this date.</td></tr>
                  ) : (
                    stockEntries.map(entry => (
                      <tr key={entry.id}>
                        <td>{formatDate(entry.date)}</td>
                        <td>{getStoreBadge(entry.store.brand, entry.store.name)}</td>
                        <td>{entry.item?.name || 'Unknown'}</td>
                        <td>{entry.opening_qty}</td>
                        <td>{entry.closing_qty}</td>
                        <td>{entry.consumption_qty}</td>
                        <td>{entry.submitted_by?.full_name || 'System'}</td>
                        <td>{new Date(entry.created_at).toLocaleTimeString('en-IN')}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Cash Tallies</h2>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Type</th>
                    <th>Total Amount</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {cashTallies.length === 0 ? (
                    <tr><td colSpan={5} className={styles.emptyState}>No cash tallies found for this date.</td></tr>
                  ) : (
                    cashTallies.map(tally => (
                      <tr key={tally.id}>
                        <td>{formatDate(tally.date)}</td>
                        <td>{getStoreBadge(tally.store.brand, tally.store.name)}</td>
                        <td style={{ textTransform: 'capitalize' }}>{tally.shift_type}</td>
                        <td style={{ color: 'var(--success)', fontWeight: 'bold' }}>{formatCurrency(tally.total_amount)}</td>
                        <td>{tally.submitted_by?.full_name || 'System'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Recent Wastage Entries</h2>
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Store</th>
                    <th>Item</th>
                    <th>Qty</th>
                    <th>Reason</th>
                    <th>Staff</th>
                  </tr>
                </thead>
                <tbody>
                  {wastageEntries.length === 0 ? (
                    <tr><td colSpan={6} className={styles.emptyState}>No wastage entries found for this date.</td></tr>
                  ) : (
                    wastageEntries.map(wastage => (
                      <tr key={wastage.id}>
                        <td>{formatDate(wastage.date)}</td>
                        <td>{getStoreBadge(wastage.store.brand, wastage.store.name)}</td>
                        <td>{wastage.item?.name || 'Unknown'}</td>
                        <td style={{ color: 'var(--danger)', fontWeight: 'bold' }}>{wastage.quantity}</td>
                        <td>{wastage.reason}</td>
                        <td>{wastage.submitted_by?.full_name || 'System'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
