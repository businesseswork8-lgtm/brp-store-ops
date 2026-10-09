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
  const [isCollapsed, setIsCollapsed] = useState(false);
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

  // Load collapse state from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem('sidebar_collapsed') === 'true';
    if (stored) {
      setIsCollapsed(true);
      document.documentElement.style.setProperty('--sidebar-width', '72px');
    } else {
      document.documentElement.style.setProperty('--sidebar-width', '260px');
    }
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      document.documentElement.style.setProperty('--sidebar-width', next ? '72px' : '260px');
      return next;
    });
  };

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
  const canCollapse = profile?.role === 'super_admin' || profile?.role === 'admin';

  return (
    <>
      {open && <div className={styles.backdrop} onClick={() => setOpen(false)} />}
      <aside className={`${styles.sidebar} ${open ? styles.sidebarOpen : ''} ${isCollapsed ? styles.collapsed : ''}`}>
        <div className={styles.logoArea}>
          {!isCollapsed ? (
            <div>
              <h1 className={styles.logoTitle}>BRP</h1>
              <p className={styles.logoSubtitle}>Store Operations</p>
            </div>
          ) : (
            <h1 className={styles.logoTitleMini}>BRP</h1>
          )}

          {canCollapse && (
            <button
              onClick={toggleCollapse}
              className={styles.collapseToggle}
              title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
              aria-label={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
            >
              {isCollapsed ? '❯' : '❮'}
            </button>
          )}
        </div>

        <nav className={styles.nav}>
          {menuGroups.map((group, i) => (
            <div key={group.group} className={styles.navGroup}>
              {!isCollapsed && <div className={styles.navGroupTitle}>{group.group}</div>}
              {group.links.map(link => {
                const isActive = pathname === link.href || link.also?.includes(pathname);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={`${styles.navLink} ${isActive ? styles.navLinkActive : ''}`}
                    title={isCollapsed ? link.label : undefined}
                  >
                    <span className={styles.icon}>{link.icon}</span>
                    {!isCollapsed && <span>{link.label}</span>}
                  </Link>
                );
              })}
              {i < menuGroups.length - 1 && <div className={styles.divider} />}
            </div>
          ))}
        </nav>

        <div className={styles.footer}>
          {profile && (
            <div className={styles.userInfo}>
              {!isCollapsed ? (
                <>
                  <span className={styles.userName}>{profile.full_name || 'User'}</span>
                  <span className={styles.userRole}>{roleLabel[profile.role]}</span>
                </>
              ) : (
                <div className={styles.userAvatarMini} title={`${profile.full_name || 'User'} (${roleLabel[profile.role]})`}>
                  {(profile.full_name || 'U').charAt(0).toUpperCase()}
                </div>
              )}
            </div>
          )}
          <button
            onClick={handleLogout}
            className={styles.logoutBtn}
            title={isCollapsed ? 'Logout' : undefined}
          >
            <span className={styles.icon}>🚪</span>
            {!isCollapsed && <span>Logout</span>}
          </button>
        </div>
      </aside>
    </>
  );
}