'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './store.module.css';

export default function StoreDashboardPage() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({
    morningTally: false,
    openingStock: false,
    eveningTally: false,
    closingStock: false,
  });

  const supabase = createClient();
  const todayDate = new Date().toISOString().split('T')[0];
  const displayDate = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  useEffect(() => {
    const fetchStatus = async () => {
      let storedStoreId = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');
      if (!storedStoreId) {
        const { data: stores } = await supabase.from('stores').select('id, name').order('name');
        if (stores && stores.length > 0) {
          storedStoreId = stores[0].id;
        }
      }
      if (!storedStoreId) {
        setLoading(false);
        return;
      }
      localStorage.setItem('selectedStore', storedStoreId);
      localStorage.setItem('brp_selected_store', storedStoreId);
      setStoreId(storedStoreId);

      try {
        // Get store name
        const { data: storeData } = await supabase
          .from('stores')
          .select('name')
          .eq('id', storedStoreId)
          .single();
        if (storeData) setStoreName(storeData.name);

        // Check Morning Cash Tally
        const { data: morningCash } = await supabase
          .from('daily_cash_tally')
          .select('id')
          .eq('store_id', storedStoreId)
          .eq('entry_date', todayDate)
          .eq('tally_type', 'morning')
          .limit(1);

        // Check Opening Stock
        const { data: stockEntries } = await supabase
          .from('daily_stock_entries')
          .select('id, opening_stock, closing_stock')
          .eq('store_id', storedStoreId)
          .eq('entry_date', todayDate);

        const hasOpeningStock = stockEntries && stockEntries.length > 0;
        const hasClosingStock = stockEntries && stockEntries.length > 0 && stockEntries.every(entry => entry.closing_stock !== null);

        // Check Evening Cash Tally
        const { data: eveningCash } = await supabase
          .from('daily_cash_tally')
          .select('id')
          .eq('store_id', storedStoreId)
          .eq('entry_date', todayDate)
          .eq('tally_type', 'evening')
          .limit(1);

        setStatus({
          morningTally: Boolean(morningCash && morningCash.length > 0),
          openingStock: Boolean(hasOpeningStock),
          eveningTally: Boolean(eveningCash && eveningCash.length > 0),
          closingStock: Boolean(hasClosingStock),
        });
      } catch (error) {
        console.error('Error fetching status:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStatus();
  }, [supabase, todayDate]);

  if (loading) return <div className={styles.spinner}></div>;

  if (!storeId) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <h2>No Store Selected</h2>
          <p>Please select a store from the header to view daily operations.</p>
        </div>
      </div>
    );
  }

  const tasks = [
    {
      id: 'morning-tally',
      title: 'Morning Cash Tally',
      text: status.morningTally ? 'Completed for today' : 'Pending',
      status: status.morningTally ? 'completed' : 'pending',
      href: '/store/cash-tally',
      icon: status.morningTally ? '✓' : '!',
    },
    {
      id: 'opening-stock',
      title: 'Opening Stock',
      text: status.openingStock ? 'Completed for today' : 'Pending',
      status: status.openingStock ? 'completed' : 'pending',
      href: '/store/stock-entry',
      icon: status.openingStock ? '✓' : '!',
    },
    {
      id: 'evening-tally',
      title: 'Evening Cash Tally',
      text: status.eveningTally ? 'Completed for today' : 'Pending',
      status: status.eveningTally ? 'completed' : 'pending',
      href: '/store/cash-tally',
      icon: status.eveningTally ? '✓' : '!',
    },
    {
      id: 'closing-stock',
      title: 'Closing Stock',
      text: status.closingStock ? 'Completed for today' : 'Pending',
      status: status.closingStock ? 'completed' : 'pending',
      href: '/store/stock-entry',
      icon: status.closingStock ? '✓' : '!',
    },
    {
      id: 'sales-upload',
      title: 'POS Sales Upload',
      text: 'Upload daily Rista POS CSV export',
      status: 'optional',
      href: '/store/sales-upload',
      icon: '📊',
    },
    {
      id: 'wastage',
      title: 'Wastage Log',
      text: 'Log optional wastage',
      status: 'optional',
      href: '/store/wastage',
      icon: '♻',
    },
    {
      id: 'eod-report',
      title: 'EOD Closing Summary',
      text: 'Generate End-of-Day PDF report',
      status: 'optional',
      href: '/store/eod-report',
      icon: '🖨️',
    },
  ];

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{storeName} Operations</h1>
          <p className={styles.date}>{displayDate}</p>
        </div>
      </header>

      <div className={styles.statusGrid}>
        {tasks.map(task => (
          <Link key={task.id} href={task.href} className={`${styles.statusCard} ${styles[task.status]}`}>
            <div className={styles.statusIcon}>{task.icon}</div>
            <div className={styles.statusContent}>
              <div className={styles.statusTitle}>{task.title}</div>
              <div className={styles.statusText}>{task.text}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
