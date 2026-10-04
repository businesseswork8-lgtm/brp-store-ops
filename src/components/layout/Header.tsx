'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { displayDate } from '@/lib/dates';
import styles from './Header.module.css';

const TITLES: Record<string, string> = {
  '/store': "Today's Tasks",
  '/store/stock-entry': 'Stock Count',
  '/store/cash-tally': 'Cash Count',
  '/store/sales-upload': 'Upload Sales Report',
  '/store/wastage': 'Wastage',
  '/store/eod-report': 'Day Summary',
  '/super-admin': 'All Stores Today',
  '/super-admin/variance': 'Stock Variance',
  '/super-admin/variance/thresholds': 'Alert Limits',
  '/super-admin/recipes': 'Recipes',
  '/super-admin/items': 'Items',
  '/super-admin/users': 'Staff & Logins',
  '/analytics/sales': 'Sales',
  '/analytics/trends': 'Sales Trends',
};

// Pages where the store selector doesn't apply
const NO_STORE_PICKER = ['/super-admin', '/super-admin/recipes', '/super-admin/items', '/super-admin/users',
  '/super-admin/variance/thresholds', '/analytics/sales', '/analytics/trends'];

export function Header() {
  const pathname = usePathname();
  const { profile, stores, store, selectStore } = useActiveStore();

  const showPicker = !NO_STORE_PICKER.includes(pathname);
  const singleStore = profile?.role === 'store' || stores.length <= 1;

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <button
          className={styles.menuButton}
          aria-label="Open menu"
          onClick={() => window.dispatchEvent(new Event('toggleSidebar'))}
        >
          ☰
        </button>
        <h2 className={styles.pageTitle}>{TITLES[pathname] || 'BRP Operations'}</h2>
      </div>

      <div className={styles.rightSection}>
        <span className={styles.currentDate}>{displayDate()}</span>
        {showPicker && store && (
          singleStore ? (
            <span className={styles.storeName}>🏬 {store.name}</span>
          ) : (
            <select
              className={styles.storeSelector}
              value={store.id}
              onChange={e => selectStore(e.target.value)}
              aria-label="Store"
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          )
        )}
      </div>
    </header>
  );
}
