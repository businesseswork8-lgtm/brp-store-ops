'use client';

import { istDate } from '@/lib/dates';
import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from './super-admin.module.css';

type StoreSummary = {
  id: string;
  name: string;
  code: string;
  brand_name: string;
  hasOpeningStock: boolean;
  hasClosingStock: boolean;
  hasPOSUpload: boolean;
  hasCashTally: boolean;
  alertsCount: number;
};

export default function SuperAdminOverviewPage() {
  const [supabase] = useState(() => createClient());
  const todayDate = istDate();

  const [storeSummaries, setStoreSummaries] = useState<StoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalDiscounts, setTotalDiscounts] = useState(0);
  const [totalAlerts, setTotalAlerts] = useState(0);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      const [{ data: prof }, { data: stores }, { data: salesSummaries }] = await Promise.all([
        supabase.from('profiles').select('role').eq('id', user?.id || '').maybeSingle(),
        supabase.from('stores').select('id, name, code, brands(name)').eq('is_active', true).order('name'),
        supabase.from('daily_sales_summary').select('store_id, net_sales, total_discount, has_summary').eq('entry_date', todayDate),
      ]);
      setIsSuperAdmin(prof?.role === 'super_admin');

      const real = (salesSummaries || []).filter(s => s.has_summary !== false);
      setTotalRevenue(real.reduce((t, s) => t + Number(s.net_sales || 0), 0));
      setTotalDiscounts(real.reduce((t, s) => t + Number(s.total_discount || 0), 0));

      const summaries: StoreSummary[] = await Promise.all((stores || []).map(async store => {
        const [{ data: stock }, { data: tally }, { data: rpcData }] = await Promise.all([
          supabase.from('daily_stock_entries').select('closing_stock').eq('store_id', store.id).eq('entry_date', todayDate),
          supabase.from('daily_cash_tally').select('tally_type').eq('store_id', store.id).eq('entry_date', todayDate),
          supabase.rpc('calculate_daily_variance', { p_store_id: store.id, p_date: todayDate }),
        ]);
        const rows = (rpcData || []) as { status: string }[];
        return {
          id: store.id,
          name: store.name,
          code: store.code,
          brand_name: (store as unknown as { brands?: { name: string } }).brands?.name || store.code,
          hasOpeningStock: Boolean(stock && stock.length > 0),
          hasClosingStock: Boolean(stock && stock.length > 0 && stock.every(s => s.closing_stock !== null)),
          hasPOSUpload: real.some(s => s.store_id === store.id),
          // Both morning and evening counts done
          hasCashTally: Boolean(tally?.some(t => t.tally_type === 'morning') && tally?.some(t => t.tally_type === 'evening')),
          alertsCount: rows.filter(r => r.status === 'EXCEEDED' || r.status === 'CHECK').length,
        };
      }));

      setStoreSummaries(summaries);
      setTotalAlerts(summaries.reduce((t, s) => t + s.alertsCount, 0));
      setLoading(false);
    };
    load();
  }, [supabase, todayDate]);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Super Admin Executive Control Center</h1>
          <p className={styles.subtitle}>
            Multi-store operational status, revenue audit, stock variance alerts, and master data management
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.statGrid} style={{ marginBottom: '1.5rem' }}>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Today's Total Net Revenue</div>
          <div className={styles.statValue} style={{ color: 'var(--success)' }}>
            ₹ {totalRevenue.toLocaleString('en-IN')}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Today's Total Discounts</div>
          <div className={styles.statValue} style={{ color: 'var(--warning)' }}>
            ₹ {totalDiscounts.toLocaleString('en-IN')}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Active Stock Discrepancy Alerts</div>
          <div className={styles.statValue} style={{ color: totalAlerts > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {totalAlerts} {totalAlerts > 0 ? '⚠ Alerts' : '✓ All Clean'}
          </div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Total Active Stores</div>
          <div className={styles.statValue}>{storeSummaries.length} Stores</div>
        </div>
      </div>

      {/* Admin Module Navigation Cards */}
      <h3 style={{ margin: '1.5rem 0 1rem 0', color: 'var(--text-primary)' }}>Management Modules</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '2rem' }}>
        <Link href="/super-admin/variance" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Stock Variance Audit</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Audit physical stock vs POS theoretical consumption per store & date.
          </p>
        </Link>

        {isSuperAdmin && (
        <Link href="/super-admin/recipes" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📝</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Recipe BOM Builder</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Map POS products to exact raw material consumption in grams/ml/pcs.
          </p>
        </Link>
        )}

        {isSuperAdmin && (
        <Link href="/super-admin/items" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📦</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Item Master Catalog</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage raw material ingredients, UOMs, and daily tracking flags.
          </p>
        </Link>
        )}

        {isSuperAdmin && (
        <Link href="/super-admin/variance/thresholds" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚙️</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Audit Thresholds</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Configure default and item/category specific tolerance % triggers.
          </p>
        </Link>
        )}

        {isSuperAdmin && (
        <Link href="/super-admin/users" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>User & Staff Management</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage staff profiles, store access permissions, and roles.
          </p>
        </Link>
        )}

        <Link href="/analytics/sales" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📊</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Sales Revenue Analytics</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Analyze Swiggy, Zomato, and Walk-In cash sales trends across stores.
          </p>
        </Link>
      </div>

      {/* Multi-Store Operations Status Table */}
      <h3 style={{ margin: '1.5rem 0 1rem 0', color: 'var(--text-primary)' }}>
        Today's Multi-Store Operations Status ({todayDate})
      </h3>

      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading store operations matrix...
        </div>
      ) : (
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Store Name</th>
                <th>Brand</th>
                <th>Opening Stock</th>
                <th>POS Sales Upload</th>
                <th>Cash Tally</th>
                <th>Closing Stock</th>
                <th>Audit Variance Status</th>
              </tr>
            </thead>
            <tbody>
              {storeSummaries.map(s => (
                <tr key={s.id}>
                  <td style={{ fontWeight: 600 }}>{s.name}</td>
                  <td>
                    <span className={styles.badgeDefault}>{s.brand_name}</span>
                  </td>
                  <td>
                    <span className={s.hasOpeningStock ? styles.badgeSuccess : styles.badgeDefault}>
                      {s.hasOpeningStock ? '✓ Done' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={s.hasPOSUpload ? styles.badgeSuccess : styles.badgeDefault}>
                      {s.hasPOSUpload ? '✓ Uploaded' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={s.hasCashTally ? styles.badgeSuccess : styles.badgeDefault}>
                      {s.hasCashTally ? '✓ Done' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={s.hasClosingStock ? styles.badgeSuccess : styles.badgeDefault}>
                      {s.hasClosingStock ? '✓ Done' : 'Pending'}
                    </span>
                  </td>
                  <td>
                    <span className={s.alertsCount > 0 ? styles.badgeDanger : styles.badgeSuccess}>
                      {s.alertsCount > 0 ? `⚠ ${s.alertsCount} Alerts` : '✓ OK'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
