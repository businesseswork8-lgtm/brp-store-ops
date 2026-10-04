'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import styles from './Sidebar.module.css';

interface Profile {
  id: string;
  role: 'store' | 'admin' | 'super_admin';
  full_name: string | null;
}

type NavLink = { href: string; label: string; icon: string };

const storeLinks: NavLink[] = [
  { href: '/store', label: 'Today', icon: '📋' },
  { href: '/store/cash-tally', label: 'Cash Count', icon: '💰' },
  { href: '/store/stock-entry', label: 'Stock Count', icon: '📦' },
  { href: '/store/wastage', label: 'Wastage', icon: '🗑️' },
  { href: '/store/sales-upload', label: 'Upload Sales Report', icon: '📄' },
  { href: '/store/eod-report', label: 'Day Summary', icon: '🖨️' },
];

const analyticsLinks: NavLink[] = [
  { href: '/analytics/sales', label: 'Sales', icon: '📊' },
  { href: '/analytics/trends', label: 'Trends', icon: '📈' },
];

const reviewLinks: NavLink[] = [
  { href: '/super-admin', label: 'All Stores Today', icon: '🏬' },
  { href: '/super-admin/variance', label: 'Stock Variance', icon: '🔍' },
];

const flavourLink: NavLink = { href: '/super-admin/flavours', label: 'Ice Cream Flavours', icon: '🍨' };

const settingsLinks: NavLink[] = [
  flavourLink,
  { href: '/super-admin/items', label: 'Items', icon: '🧾' },
  { href: '/super-admin/recipes', label: 'Recipes', icon: '📝' },
  { href: '/super-admin/variance/thresholds', label: 'Alert Limits', icon: '⚙️' },
  { href: '/super-admin/users', label: 'Staff & Logins', icon: '👤' },
];

function groupsForRole(role: Profile['role']) {
  if (role === 'super_admin') {
    return [
      { group: 'Overview', links: reviewLinks },
      { group: 'Sales', links: analyticsLinks },
      { group: 'Store Work', links: storeLinks },
      { group: 'Settings', links: settingsLinks },
    ];
  }
  if (role === 'admin') {
    return [
      { group: 'Overview', links: reviewLinks },
      { group: 'Sales', links: analyticsLinks },
      { group: 'Store Work', links: storeLinks },
      { group: 'Settings', links: [flavourLink] },
    ];
  }
  return [{ group: 'Store Work', links: storeLinks }];
}

const roleLabel: Record<Profile['role'], string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  store: 'Store',
};

export function Sidebar() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const [supabase] = useState(() => createClient());

  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('profiles')
        .select('id, role, full_name')
        .eq('id', user.id)
        .single();
      if (data) setProfile(data as Profile);
    };
    fetchProfile();
  }, [supabase]);

  // Mobile: header hamburger toggles the sidebar
  useEffect(() => {
    const toggle = () => setOpen(o => !o);
    window.addEventListener('toggleSidebar', toggle);
    return () => window.removeEventListener('toggleSidebar', toggle);
  }, []);

  // Close after navigating
  useEffect(() => { setOpen(false); }, [pathname]);

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  // Show nothing role-specific until we know the role
  const menuGroups = profile ? groupsForRole(profile.role) : [];

  return (
    <>
      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''}`}>
        <div className={styles.logoArea}>
          <h1 className={styles.logoTitle}>BRP</h1>
          <p className={styles.logoSubtitle}>Store Operations</p>
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
          {profile && (
            <div className={styles.userInfo}>
              <span className={styles.userName}>{profile.full_name || 'User'}</span>
              <span className={styles.userRole}>{roleLabel[profile.role]}</span>
            </div>
          )}
          <button onClick={handleLogout} className={styles.logoutBtn}>
            <span className={styles.icon}>🚪</span> Logout
          </button>
        </div>
      </aside>
    </>
  );
}
