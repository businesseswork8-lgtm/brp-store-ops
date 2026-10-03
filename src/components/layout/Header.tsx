'use client';

import React, { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './Header.module.css';

interface Store {
  id: string;
  name: string;
  store_code: string;
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
        .select('*')
        .order('name');
      
      if (data && data.length > 0) {
        setStores(data);
        const saved = localStorage.getItem('selectedStore');
        if (saved && data.find(s => s.id === saved)) {
          setSelectedStore(saved);
        } else {
          setSelectedStore(data[0].id);
          localStorage.setItem('selectedStore', data[0].id);
        }
      }
    };
    fetchStores();
  }, [supabase]);

  const handleStoreChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    setSelectedStore(value);
    localStorage.setItem('selectedStore', value);
    window.dispatchEvent(new Event('storeChange'));
  };

  const getPageTitle = (path: string) => {
    if (path === '/') return 'Dashboard';
    const segments = path.split('/').filter(Boolean);
    const lastSegment = segments[segments.length - 1];
    return lastSegment ? lastSegment.replace(/-/g, ' ') : 'Dashboard';
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
        <button className={styles.hamburgerBtn}>
          ☰
        </button>
        <h2 className={styles.pageTitle}>{getPageTitle(pathname)}</h2>
      </div>

      <div className={styles.rightSection}>
        <span className={styles.currentDate}>{currentDate}</span>
        {stores.length > 0 && (
          <select 
            className={styles.storeSelector} 
            value={selectedStore} 
            onChange={handleStoreChange}
          >
            {stores.map(store => (
              <option key={store.id} value={store.id}>
                {store.name} ({store.store_code})
              </option>
            ))}
          </select>
        )}
      </div>
    </header>
  );
}
