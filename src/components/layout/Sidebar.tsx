'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './Sidebar.module.css';

interface Profile {
  id: string;
  role: string;
  full_name: string | null;
}

export function Sidebar() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.id)
          .single();
        if (data) setProfile(data);
      }
    };
    fetchProfile();
  }, [supabase]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  const getLinksForRole = (role: string) => {
    const storeLinks = [
      { href: '/store', label: 'Daily Checklist', icon: '📋' },
      { href: '/store/stock-entry', label: 'Stock Entry', icon: '📦' },
      { href: '/store/cash-tally', label: 'Cash Tally', icon: '💰' },
      { href: '/store/wastage', label: 'Wastage Log', icon: '🗑️' },
    ];

    const adminLinks = [
      { href: '/analytics/sales', label: 'Sales Analytics', icon: '📊' },
    ];

    const superAdminLinks = [
      { href: '/super-admin/variance', label: 'Variance', icon: '🔍' },
      { href: '/super-admin/variance/thresholds', label: 'Thresholds', icon: '⚙️' },
      { href: '/super-admin/recipes', label: 'Recipes', icon: '📝' },
      { href: '/super-admin/items', label: 'Items', icon: '📦' },
      { href: '/super-admin/users', label: 'Users', icon: '👤' },
    ];

    if (role === 'super_admin') {
      return [
        { group: 'Administration', links: superAdminLinks },
        { group: 'Analytics', links: adminLinks },
        { group: 'Store Ops', links: storeLinks },
      ];
    } else if (role === 'admin') {
      return [
        { group: 'Analytics', links: adminLinks },
        { group: 'Store Ops', links: storeLinks },
      ];
    } else {
      return [
        { group: 'Store Tasks', links: storeLinks },
      ];
    }
  };

  const menuGroups = profile ? getLinksForRole(profile.role) : [];

  return (
    <aside className={`${styles.sidebar} ${isMobileOpen ? styles.sidebarOpen : ''}`}>
      <div className={styles.logoArea}>
        <h1 className={styles.logoTitle}>BRP</h1>
        <p className={styles.logoSubtitle}>Store Ops</p>
      </div>

      <nav className={styles.nav}>
        {menuGroups.map((group, i) => (
          <div key={group.group} className={styles.navGroup}>
            <div className={styles.navGroupTitle}>{group.group}</div>
            {group.links.map(link => (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.navLink} ${pathname === link.href ? styles.navLinkActive : ''}`}
              >
                <span className={styles.icon}>{link.icon}</span>
                {link.label}
              </Link>
            ))}
            {i < menuGroups.length - 1 && <div className={styles.divider} />}
          </div>
        ))}
      </nav>

      <div className={styles.footer}>
        <div className={styles.userInfo}>
          <span className={styles.userName}>{profile?.full_name || 'Loading...'}</span>
          <span className={styles.userRole}>{profile?.role?.replace('_', ' ') || '...'}</span>
        </div>
        <button onClick={handleLogout} className={styles.logoutBtn}>
          <span className={styles.icon}>🚪</span> Logout
        </button>
      </div>
    </aside>
  );
}
