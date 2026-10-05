'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import styles from '../super-admin.module.css';

type VarianceRow = {
  item_id: string;
  item_name: string;
  category_name: string;
  uom: string;
  opening_stock: number;
  purchases: number;
  closing_stock: number;
  actual_consumption: number;
  theoretical_consumption: number;
  wastage: number;
  tasting: number;
  variance: number;
  variance_percent: number | null;
  threshold_percent: number;
  status: string;
};

type SoldItem = { item_name: string; sku: string | null; quantity_sold: number; item_type: string | null };
type Recipe = { id: string; product_name: string; rista_sku: string | null };
type Breakdown = { posItem: string; qtySold: number; recipeQty: number; totalConsumed: number };

const recipeMatches = (r: Recipe, si: SoldItem) =>
  r.rista_sku ? r.rista_sku === si.sku : r.product_name.trim().toLowerCase() === si.item_name.trim().toLowerCase();

export default function VarianceDashboardPage() {
  const { supabase, store, profile } = useActiveStore();
  const [selectedDate, setSelectedDate] = useState<string>(addDays(istDate(), -1));
  const [varianceData, setVarianceData] = useState<VarianceRow[]>([]);
  const [unmatched, setUnmatched] = useState<SoldItem[]>([]);
  const [hasSales, setHasSales] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItemDetail, setSelectedItemDetail] = useState<VarianceRow | null>(null);
  const [posBreakdown, setPosBreakdown] = useState<Breakdown[]>([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  const loadSoldItems = useCallback(async (): Promise<SoldItem[]> => {
    if (!store) return [];
    const { data: day } = await supabase.from('daily_sales_summary').select('id')
      .eq('store_id', store.id).eq('entry_date', selectedDate).maybeSingle();
    if (!day) return [];
    const { data } = await supabase.from('daily_sales_items')
      .select('item_name, sku, quantity_sold, item_type').eq('sales_summary_id', day.id);
    return (data || []) as SoldItem[];
  }, [supabase, store, selectedDate]);

  const calculateVariance = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    setError(null);

    // Single source of truth: the database function (no hidden fallback)
    const [{ data, error: rpcErr }, sold, { data: recipes }] = await Promise.all([
      supabase.rpc('calculate_daily_variance', { p_store_id: store.id, p_date: selectedDate }),
      loadSoldItems(),
      supabase.from('recipes').select('id, product_name, rista_sku').eq('brand_id', store.brand_id),
    ]);

    if (rpcErr) {
      console.error(rpcErr);
      setError('Could not calculate variance: ' + rpcErr.message);
      setVarianceData([]);
    } else {
      setVarianceData((data || []) as VarianceRow[]);
    }

    setHasSales(sold.length > 0);
    const recs = (recipes || []) as Recipe[];
    setUnmatched(sold.filter(si => !recs.some(r => recipeMatches(r, si))));
    setLoading(false);
  }, [supabase, store, selectedDate, loadSoldItems]);

  useEffect(() => { calculateVariance(); }, [calculateVariance]);

  async function openDrillDownModal(row: VarianceRow) {
    setSelectedItemDetail(row);
    setBreakdownLoading(true);

    const sold = await loadSoldItems();
    const { data: recipeIng } = await supabase
      .from('recipe_ingredients')
      .select('quantity, recipes!inner(id, product_name, rista_sku, brand_id)')
      .eq('item_id', row.item_id)
      .eq('recipes.brand_id', store!.brand_id);

    const breakdown: Breakdown[] = [];
    (recipeIng || []).forEach(ri => {
      const rec = ri.recipes as unknown as Recipe;
      sold.filter(si => recipeMatches(rec, si)).forEach(si => {
        breakdown.push({
          posItem: si.item_name,
          qtySold: si.quantity_sold,
          recipeQty: ri.quantity,
          totalConsumed: si.quantity_sold * ri.quantity,
        });
      });
    });

    setPosBreakdown(breakdown);
    setBreakdownLoading(false);
  }

  // Summary KPIs
  const alertsCount = varianceData.filter(r => r.status === 'EXCEEDED' || r.status === 'CHECK').length;
  const noItemSales = varianceData.some(r => r.status === 'NO_SALES_DATA');

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Recipe Variance{store ? ` — ${store.name}` : ''}</h1>
          <p className={styles.subtitle}>
            Stock actually used vs. what sales say should have been used. Change store from the top bar.
          </p>
        </div>
        {profile?.role === 'super_admin' && (
          <Link href="/super-admin/variance/thresholds" className={styles.secondaryButton} style={{ textDecoration: 'none' }}>
          ⚙️ Alert Limits
        </Link>
        )}
      </div>

      {/* Control Bar */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className={styles.fieldGroup} style={{ marginBottom: 0, minWidth: '180px' }}>
            <label>Date</label>
            <input
              type="date"
              value={selectedDate}
              max={istDate()}
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>

          <div style={{ alignSelf: 'flex-end' }}>
            <button className={styles.primaryButton} onClick={calculateVariance}>
              🔄 Refresh
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Items checked</div>
          <div className={styles.statValue}>{varianceData.filter(r => r.status !== 'INFO').length}</div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Items over limit</div>
          <div className={styles.statValue} style={{ color: alertsCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {alertsCount} {alertsCount > 0 ? '⚠' : '✓'}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Sales report</div>
          <div className={styles.statValue} style={{ color: hasSales ? 'var(--success)' : 'var(--warning)' }}>
            {hasSales ? '✓ Uploaded' : 'Missing'}
          </div>
        </div>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Products with no recipe</div>
          <div className={styles.statValue} style={{ color: unmatched.length > 0 ? 'var(--warning)' : 'var(--success)' }}>
            {unmatched.length}
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.card} style={{ marginBottom: '1.5rem', color: 'var(--danger)' }}>{error}</div>
      )}

      {unmatched.length > 0 && (
        <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0, color: 'var(--warning)' }}>⚠ Sold products with no recipe ({unmatched.length})</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            These were sold but no recipe is linked, so their ingredients are not counted. Stock used for them will show as missing.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
            {unmatched.map((u, i) => (
              <span key={i} className={styles.badgeDanger} title={u.sku ? `SKU ${u.sku}` : ''}>
                {u.item_name} × {u.quantity_sold}{u.sku ? ` (SKU ${u.sku})` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {noItemSales && (
        <div className={styles.card} style={{ marginBottom: '1rem', color: 'var(--text-secondary)' }}>
          ℹ️ Sales By Items is not uploaded for {selectedDate}, so usage can&apos;t be compared with sales. Only &quot;Check count&quot; (stock went up with no delivery) is flagged.
          Upload Sales By Items for this day to see the full check.
        </div>
      )}

      {varianceData.some(r => r.status === 'INFO') && (
        <div className={styles.card} style={{ marginBottom: '1.5rem', color: 'var(--text-secondary)' }}>
          🍨 Ice cream is checked as one total (&quot;All ice cream&quot;) against scoops and packs sold.
          Each flavour shows how much was used, without an alert, until the sales report tells us which flavour went into each scoop.
        </div>
      )}

      {/* Main Table */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Calculating store variance against POS theoretical recipes...
        </div>
      ) : (
        <div className={styles.card}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Raw Material</th>
                <th>Category</th>
                <th>Opening</th>
                <th>Received</th>
                <th>Closing</th>
                <th>Actual Used</th>
                <th>POS Theo Target</th>
                <th>Wastage</th>
                <th>Variance</th>
                <th>Variance %</th>
                <th>Status</th>
                <th>Audit</th>
              </tr>
            </thead>
            <tbody>
              {varianceData.length === 0 ? (
                <tr>
                  <td colSpan={12} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No completed stock count (opening + closing) for {store?.name || 'this store'} on {selectedDate}.
                  </td>
                </tr>
              ) : (
                varianceData.map(row => (
                  <tr
                    key={row.item_id}
                    style={{
                      background: row.status === 'EXCEEDED' || row.status === 'CHECK' ? 'rgba(255, 23, 68, 0.08)' : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>{row.item_name}</td>
                    <td>{row.category_name}</td>
                    <td>{row.opening_stock}</td>
                    <td>{Number(row.purchases) ? row.purchases : '–'}</td>
                    <td>{row.closing_stock}</td>
                    <td style={{ fontWeight: 600 }}>{row.actual_consumption} {row.uom}</td>
                    <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {row.theoretical_consumption} {row.uom}
                    </td>
                    <td>{row.wastage}</td>
                    <td
                      style={row.status === 'INFO' || row.status === 'NO_SALES_DATA' ? { color: 'var(--text-secondary)' } : {
                        fontWeight: 700,
                        color: Number(row.variance) > 0 ? 'var(--danger)' : Number(row.variance) < 0 ? 'var(--success)' : 'inherit',
                      }}
                    >
                      {row.status === 'NO_SALES_DATA' ? '–' : <>{Number(row.variance) > 0 ? `+${row.variance}` : row.variance} {row.uom}</>}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {row.status === 'INFO' || row.status === 'NO_SALES_DATA' ? '–' : row.variance_percent === null
                        ? (Number(row.variance) > 0 ? 'No sales to explain' : Number(row.variance) < 0 ? 'Stock went up' : '–')
                        : Number(row.variance_percent) > 0 ? `+${row.variance_percent}%` : `${row.variance_percent}%`}
                    </td>
                    <td>
                      <span className={row.status === 'EXCEEDED' || row.status === 'CHECK' ? styles.badgeDanger
                        : row.status === 'INFO' || row.status === 'NO_SALES_DATA' ? styles.badgeDefault : styles.badgeSuccess}>
                        {row.status === 'EXCEEDED' ? '⚠ Used too much'
                          : row.status === 'CHECK' ? '⚠ Check count'
                          : row.status === 'INFO' ? 'Usage only'
                          : row.status === 'NO_SALES_DATA' ? 'No item sales' : '✓ OK'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => openDrillDownModal(row)}
                      >
                        Details
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Drill-Down Breakdown Modal */}
      {selectedItemDetail && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0,0,0,0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
          }}
        >
          <div className={styles.card} style={{ width: '90%', maxWidth: '650px', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2>Audit Drill Down: {selectedItemDetail.item_name}</h2>
              <button
                className={styles.secondaryButton}
                onClick={() => setSelectedItemDetail(null)}
              >
                ✕ Close
              </button>
            </div>

            <p style={{ color: 'var(--text-secondary)' }}>
              Breakdown of POS products sold on {selectedDate} that consumed <strong>{selectedItemDetail.item_name}</strong> based on recipe BOM rules.
            </p>

            {breakdownLoading ? (
              <p>Loading sales breakdown...</p>
            ) : posBreakdown.length === 0 ? (
              <p style={{ color: 'var(--warning)', padding: '1rem 0' }}>
                No POS sold products linked to recipes for this raw material on this date.
              </p>
            ) : (
              <table className={styles.table} style={{ marginTop: '1rem' }}>
                <thead>
                  <tr>
                    <th>POS Product Sold</th>
                    <th>Qty Sold</th>
                    <th>Recipe BOM Rate</th>
                    <th>Total Theoretical Consumption</th>
                  </tr>
                </thead>
                <tbody>
                  {posBreakdown.map((b, i) => (
                    <tr key={i}>
                      <td>{b.posItem}</td>
                      <td>{b.qtySold}</td>
                      <td>{b.recipeQty} {selectedItemDetail.uom}</td>
                      <td style={{ fontWeight: 600, color: 'var(--accent-primary)' }}>
                        {b.totalConsumed} {selectedItemDetail.uom}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
