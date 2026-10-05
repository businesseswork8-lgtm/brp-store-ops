'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, displayDate } from '@/lib/dates';
import styles from './store.module.css';

export default function StoreDashboardPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState({
    morningTally: false,
    openingStock: false,
    eveningTally: false,
    closingStock: false,
    salesUpload: false,
    wastageCount: 0,
  });

  const todayDate = istDate();

  const fetchStatus = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: cash }, { data: stock }, { data: sales }, { data: wastage }] = await Promise.all([
      supabase.from('daily_cash_tally').select('tally_type').eq('store_id', store.id).eq('entry_date', todayDate),
      supabase.from('daily_stock_entries').select('closing_stock').eq('store_id', store.id).eq('entry_date', todayDate),
      supabase.from('daily_sales_summary').select('id').eq('store_id', store.id).eq('entry_date', todayDate).limit(1),
      supabase.from('daily_wastage_log').select('id').eq('store_id', store.id).eq('entry_date', todayDate),
    ]);
    setStatus({
      morningTally: Boolean(cash?.some(c => c.tally_type === 'morning')),
      eveningTally: Boolean(cash?.some(c => c.tally_type === 'evening')),
      openingStock: Boolean(stock && stock.length > 0),
      closingStock: Boolean(stock && stock.length > 0 && stock.every(e => e.closing_stock !== null)),
      salesUpload: Boolean(sales && sales.length > 0),
      wastageCount: wastage?.length || 0,
    });
    setLoading(false);
  }, [supabase, store, todayDate]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;

  if (!store) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <h2>No store assigned</h2>
          <p>This login is not linked to a store yet. Please contact your manager.</p>
        </div>
      </div>
    );
  }

  const storeName = store.name;

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
      title: 'Opening Stock (Open & Close)',
      text: status.openingStock ? 'Completed for today' : 'Pending',
      status: status.openingStock ? 'completed' : 'pending',
      href: '/store/stock-entry',
      icon: status.openingStock ? '✓' : '!',
    },
    {
      id: 'stock-count',
      title: 'Stock Count',
      text: 'Count the items due tonight (at closing)',
      status: 'optional',
      href: '/store/count',
      icon: '📦',
    },
    {
      id: 'rista-usage',
      title: 'Upload Rista Usage',
      text: "Rista \"Consumption Variance\" for yesterday",
      status: 'optional',
      href: '/store/rista-usage',
      icon: '📥',
    },
    {
      id: 'deliveries',
      title: 'Stock Received',
      text: 'Add anything that arrived from the warehouse',
      status: 'optional',
      href: '/store/deliveries',
      icon: '🚚',
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
      title: 'Closing Stock (Open & Close)',
      text: status.closingStock ? 'Completed for today' : 'Pending',
      status: status.closingStock ? 'completed' : 'pending',
      href: '/store/stock-entry',
      icon: status.closingStock ? '✓' : '!',
    },
    {
      id: 'sales-upload',
      title: 'Upload Sales Summary',
      text: status.salesUpload ? 'Uploaded for today' : 'Pending — upload Rista Sales Summary at night',
      status: status.salesUpload ? 'completed' : 'pending',
      href: '/store/sales-upload',
      icon: status.salesUpload ? '✓' : '!',
    },
    {
      id: 'wastage',
      title: 'Wastage',
      text: status.wastageCount > 0 ? `${status.wastageCount} logged today` : 'Log anything wasted',
      status: 'optional',
      href: '/store/wastage',
      icon: '♻',
    },
    {
      id: 'eod-report',
      title: 'Day Summary',
      text: 'View / print today\'s summary',
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
          <p className={styles.date}>{displayDate()}</p>
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
