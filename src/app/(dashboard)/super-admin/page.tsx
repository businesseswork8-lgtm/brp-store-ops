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
  const supabase = createClient();
  const todayDate = istDate();

  const [storeSummaries, setStoreSummaries] = useState<StoreSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalRevenue, setTotalRevenue] = useState(0);
  const [totalDiscounts, setTotalDiscounts] = useState(0);
  const [totalAlerts, setTotalAlerts] = useState(0);

  useEffect(() => {
    fetchExecutiveOverview();
  }, []);

  async function fetchExecutiveOverview() {
    setLoading(true);

    // Fetch stores
    const { data: stores } = await supabase
      .from('stores')
      .select('id, name, code, brands(name)')
      .order('name');

    if (!stores) {
      setLoading(false);
      return;
    }

    // Fetch today's sales summaries
    const { data: salesSummaries } = await supabase
      .from('daily_sales_summary')
      .select('*')
      .eq('entry_date', todayDate);

    let revSum = 0;
    let discSum = 0;

    (salesSummaries || []).forEach(s => {
      revSum += Number(s.net_sales || 0);
      discSum += Number(s.total_discount || 0);
    });

    setTotalRevenue(revSum);
    setTotalDiscounts(discSum);

    // Fetch store status per store
    const summaries: StoreSummary[] = [];
    let grandAlerts = 0;

    for (const store of stores) {
      // Stock entries
      const { data: stock } = await supabase
        .from('daily_stock_entries')
        .select('id, opening_stock, closing_stock')
        .eq('store_id', store.id)
        .eq('entry_date', todayDate);

      const hasOpening = Boolean(stock && stock.length > 0);
      const hasClosing = Boolean(stock && stock.length > 0 && stock.every(s => s.closing_stock !== null));

      // POS Upload
      const hasPOS = Boolean(salesSummaries?.some(s => s.store_id === store.id));

      // Cash Tally
      const { data: tally } = await supabase
        .from('daily_cash_tally')
        .select('id')
        .eq('store_id', store.id)
        .eq('entry_date', todayDate);

      const hasCash = Boolean(tally && tally.length > 0);

      // Variance Alerts
      const { data: rpcData } = await supabase.rpc('calculate_daily_variance', {
        p_store_id: store.id,
        p_date: todayDate,
      });

      const storeAlerts = (rpcData as any[])?.filter(r => r.status === 'EXCEEDED').length || 0;
      grandAlerts += storeAlerts;

      summaries.push({
        id: store.id,
        name: store.name,
        code: store.code,
        brand_name: (store as any).brands?.name || store.code,
        hasOpeningStock: hasOpening,
        hasClosingStock: hasClosing,
        hasPOSUpload: hasPOS,
        hasCashTally: hasCash,
        alertsCount: storeAlerts,
      });
    }

    setStoreSummaries(summaries);
    setTotalAlerts(grandAlerts);
    setLoading(false);
  }

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

        <Link href="/super-admin/recipes" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📝</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Recipe BOM Builder</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Map POS products to exact raw material consumption in grams/ml/pcs.
          </p>
        </Link>

        <Link href="/super-admin/items" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📦</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Item Master Catalog</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage raw material ingredients, UOMs, and daily tracking flags.
          </p>
        </Link>

        <Link href="/super-admin/variance/thresholds" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>⚙️</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>Audit Thresholds</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Configure default and item/category specific tolerance % triggers.
          </p>
        </Link>

        <Link href="/super-admin/users" className={styles.card} style={{ textDecoration: 'none', color: 'inherit', transition: 'transform 0.2s' }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>👤</div>
          <h3 style={{ margin: '0 0 0.25rem 0' }}>User & Staff Management</h3>
          <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
            Manage staff profiles, store access permissions, and roles.
          </p>
        </Link>

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
