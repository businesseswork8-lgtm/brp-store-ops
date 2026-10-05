'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from '@/app/(dashboard)/store/store.module.css';

/** Count / Received / Wasted: three tabs of one "Stock" screen. */
const TABS = [
  { href: '/store/count', label: '📦 Count' },
  { href: '/store/deliveries', label: '🚚 Received' },
  { href: '/store/wastage', label: '🗑️ Wasted' },
];

export function StockTabs() {
  const path = usePathname();
  return (
    <div className={styles.tabs} style={{ marginBottom: '1.25rem' }}>
      {TABS.map(t => (
        <Link key={t.href} href={t.href} className={`${styles.tab} ${path === t.href ? styles.active : ''}`}
          style={{ textAlign: 'center', textDecoration: 'none' }}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}
