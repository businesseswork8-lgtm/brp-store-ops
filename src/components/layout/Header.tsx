'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './Header.module.css';

interface Store {
  id: string;
  name: string;
  code: string;
}

export function Header() {
  const pathname = usePathname();
  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStore, setSelectedStore] = useState<string>('');
  const supabase = createClient();

  useEffect(() => {
    const fetchStores = async () => {
      const { data } = await supabase
        .from('stores')
        .select('id, name, code')
        .order('name');
      
      if (data && data.length > 0) {
        setStores(data);
        const saved = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');
        if (saved && data.some(s => s.id === saved)) {
          setSelectedStore(saved);
        } else {
          setSelectedStore(data[0].id);
          localStorage.setItem('selectedStore', data[0].id);
          localStorage.setItem('brp_selected_store', data[0].id);
        }
      }
    };
    fetchStores();
  }, [supabase]);

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedStore(value);
    localStorage.setItem('selectedStore', value);
    localStorage.setItem('brp_selected_store', value);
    window.dispatchEvent(new Event('storeChange'));
  };

  const getPageTitle = (path: string) => {
    if (path === '/' || path === '/store') return 'Daily Store Operations';
    if (path === '/store/stock-entry') return 'Stock Entry (Opening & Closing)';
    if (path === '/store/cash-tally') return 'Cash Denomination Tally';
    if (path === '/store/sales-upload') return 'POS Sales Report Upload';
    if (path === '/store/wastage') return 'Wastage Log';
    if (path === '/super-admin/variance') return 'Stock Variance Audit';
    if (path === '/super-admin/variance/thresholds') return 'Variance Thresholds';
    if (path === '/super-admin/recipes') return 'Recipe BOM Builder';
    if (path === '/super-admin/items') return 'Item Master Catalog';
    if (path === '/super-admin/users') return 'User & Staff Management';
    if (path === '/analytics/sales') return 'Sales & Revenue Analytics';
    return 'BRP Operations';
  };

  const currentDate = new Date().toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  });

  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <h2 className={styles.pageTitle}>{getPageTitle(pathname)}</h2>
      </div>

      <div className={styles.rightSection}>
        <span className={styles.currentDate}>{currentDate}</span>
        {stores.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Active Store:</span>
            <select 
              className={styles.storeSelector} 
              value={selectedStore} 
              onChange={handleStoreChange}
            >
              {stores.map(store => (
                <option key={store.id} value={store.id}>
                  {store.name} ({store.code})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </header>
  );
}
