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
  can_edit?: boolean;
}

type NavLink = { href: string; label: string; icon: string; also?: string[] };

// Store staff: four screens
const storeLinks: NavLink[] = [
  { href: '/store', label: 'Tonight', icon: '📋' },
  { href: '/store/cash-tally', label: 'Cash', icon: '💰' },
  { href: '/store/count', label: 'Stock', icon: '📦', also: ['/store/deliveries', '/store/wastage'] },
  { href: '/store/upload', label: 'Upload Rista Files', icon: '📄' },
];
const daySummaryLink: NavLink = { href: '/store/eod-report', label: 'Day Summary', icon: '🖨️' };

// Owner: five screens
const overviewLinks: NavLink[] = [
  { href: '/super-admin', label: 'All Stores', icon: '🏬' },
  { href: '/super-admin/stock-report', label: 'Stock Report', icon: '📊' },
  { href: '/analytics/sales', label: 'Sales', icon: '💹', also: ['/analytics/trends'] },
];
const itemsLink: NavLink = { href: '/super-admin/items', label: 'Items & Products', icon: '🧾', also: ['/super-admin/flavours'] };
const usersLink: NavLink = { href: '/super-admin/users', label: 'Staff & Logins', icon: '👤' };

function groupsForRole(role: Profile['role'], canEdit: boolean) {
  if (role === 'super_admin') {
    return [
      { group: 'Overview', links: overviewLinks },
      { group: 'Store Work', links: storeLinks },
      { group: 'Settings', links: [itemsLink, usersLink] },
    ];
  }
  if (role === 'admin') {
    return [
      { group: 'Overview', links: overviewLinks },
      // View-only admins can read the Day Summary but not enter store data
      { group: 'Store Work', links: canEdit ? storeLinks : [daySummaryLink] },
      { group: 'Settings', links: [itemsLink] },
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
        .select('id, role, full_name, can_edit')
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
  const menuGroups = profile ? groupsForRole(profile.role, Boolean(profile.can_edit)) : [];

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
                  className={`${styles.navLink} ${pathname === link.href || link.also?.includes(pathname) ? styles.navLinkActive : ''}`}
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