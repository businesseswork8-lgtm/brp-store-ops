'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../super-admin.module.css';

type Store = { id: string; name: string; brand_id: string };

type VarianceRow = {
  item_id: string;
  item_name: string;
  category_name: string;
  uom: string;
  opening_stock: number;
  closing_stock: number;
  actual_consumption: number;
  theoretical_consumption: number;
  wastage: number;
  tasting: number;
  variance: number;
  variance_percent: number;
  threshold_percent: number;
  status: string;
};

export default function VarianceDashboardPage() {
  const supabase = createClient();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [varianceData, setVarianceData] = useState<VarianceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItemDetail, setSelectedItemDetail] = useState<VarianceRow | null>(null);
  const [posBreakdown, setPosBreakdown] = useState<any[]>([]);
  const [breakdownLoading, setBreakdownLoading] = useState(false);

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      calculateVariance();
    }
  }, [selectedStoreId, selectedDate]);

  async function fetchStores() {
    const { data } = await supabase.from('stores').select('*').order('name');
    if (data && data.length > 0) {
      setStores(data);
      setSelectedStoreId(data[0].id);
    }
  }

  async function calculateVariance() {
    setLoading(true);
    // 1. Try invoking Supabase RPC function calculate_daily_variance
    const { data: rpcData, error: rpcErr } = await supabase.rpc('calculate_daily_variance', {
      p_store_id: selectedStoreId,
      p_date: selectedDate,
    });

    if (!rpcErr && rpcData) {
      setVarianceData(rpcData as VarianceRow[]);
      setLoading(false);
      return;
    }

    // 2. Fallback JS calculation if RPC not executed yet
    console.log('RPC error or missing, calculating client-side fallback...', rpcErr);
    await calculateClientSide();
    setLoading(false);
  }

  async function calculateClientSide() {
    // Fetch stock
    const { data: stock } = await supabase
      .from('daily_stock_entries')
      .select('*, items(id, name, uom, item_categories(name))')
      .eq('store_id', selectedStoreId)
      .eq('entry_date', selectedDate);

    // Fetch sales summary + items
    const { data: salesSum } = await supabase
      .from('daily_sales_summary')
      .select('id')
      .eq('store_id', selectedStoreId)
      .eq('entry_date', selectedDate)
      .maybeSingle();

    let salesItems: any[] = [];
    if (salesSum) {
      const { data: sItems } = await supabase
        .from('daily_sales_items')
        .select('*')
        .eq('sales_summary_id', salesSum.id);
      if (sItems) salesItems = sItems;
    }

    // Fetch recipes & ingredients
    const { data: recipes } = await supabase
      .from('recipes')
      .select('*, recipe_ingredients(*, items(id, name, uom))');

    // Fetch wastage
    const { data: wastage } = await supabase
      .from('daily_wastage_log')
      .select('*')
      .eq('store_id', selectedStoreId)
      .eq('entry_date', selectedDate);

    // Compute map
    const map = new Map<string, VarianceRow>();

    // Seed from stock
    (stock || []).forEach(s => {
      if (!s.items) return;
      const itemId = s.item_id;
      const actual = (s.opening_stock || 0) - (s.closing_stock || 0);
      map.set(itemId, {
        item_id: itemId,
        item_name: s.items.name,
        category_name: s.items.item_categories?.name || 'General',
        uom: s.items.uom,
        opening_stock: s.opening_stock || 0,
        closing_stock: s.closing_stock || 0,
        actual_consumption: actual,
        theoretical_consumption: 0,
        wastage: 0,
        tasting: 0,
        variance: 0,
        variance_percent: 0,
        threshold_percent: 5.0,
        status: 'OK',
      });
    });

    // Add wastage
    (wastage || []).forEach(w => {
      if (map.has(w.item_id)) {
        const row = map.get(w.item_id)!;
        row.wastage += w.quantity_wasted || 0;
      }
    });

    // Compute POS theoretical consumption
    if (recipes && salesItems.length > 0) {
      salesItems.forEach(si => {
        const rec = recipes.find(
          r => r.product_name.trim().toLowerCase() === si.item_name.trim().toLowerCase()
        );
        if (rec && rec.recipe_ingredients) {
          rec.recipe_ingredients.forEach((ri: any) => {
            const consumed = (si.quantity_sold || 0) * (ri.quantity || 0);
            if (map.has(ri.item_id)) {
              const row = map.get(ri.item_id)!;
              row.theoretical_consumption += consumed;
            }
          });
        }
      });
    }

    // Final calculations
    const result: VarianceRow[] = Array.from(map.values()).map(row => {
      const netActual = row.actual_consumption - row.wastage - row.tasting;
      const variance = netActual - row.theoretical_consumption;
      const variancePct =
        row.theoretical_consumption > 0
          ? (variance / row.theoretical_consumption) * 100
          : 0;
      const isExceeded = Math.abs(variancePct) > row.threshold_percent;

      return {
        ...row,
        variance: parseFloat(variance.toFixed(2)),
        variance_percent: parseFloat(variancePct.toFixed(2)),
        status: isExceeded ? 'EXCEEDED' : 'OK',
      };
    });

    setVarianceData(result);
  }

  async function openDrillDownModal(row: VarianceRow) {
    setSelectedItemDetail(row);
    setBreakdownLoading(true);

    // Fetch POS items matching recipes for this item
    const { data: salesSum } = await supabase
      .from('daily_sales_summary')
      .select('id')
      .eq('store_id', selectedStoreId)
      .eq('entry_date', selectedDate)
      .maybeSingle();

    if (!salesSum) {
      setPosBreakdown([]);
      setBreakdownLoading(false);
      return;
    }

    const { data: sItems } = await supabase
      .from('daily_sales_items')
      .select('*')
      .eq('sales_summary_id', salesSum.id);

    const { data: recipeIng } = await supabase
      .from('recipe_ingredients')
      .select('*, recipes(product_name)')
      .eq('item_id', row.item_id);

    const breakdown: any[] = [];
    if (sItems && recipeIng) {
      recipeIng.forEach(ri => {
        const prodName = ri.recipes?.product_name;
        const matchedPOS = sItems.find(
          si => si.item_name.trim().toLowerCase() === prodName?.trim().toLowerCase()
        );
        if (matchedPOS) {
          breakdown.push({
            posItem: matchedPOS.item_name,
            qtySold: matchedPOS.quantity_sold,
            recipeQty: ri.quantity,
            totalConsumed: matchedPOS.quantity_sold * ri.quantity,
          });
        }
      });
    }

    setPosBreakdown(breakdown);
    setBreakdownLoading(false);
  }

  // Summary KPIs
  const totalActual = varianceData.reduce((acc, r) => acc + (r.actual_consumption || 0), 0);
  const totalTheo = varianceData.reduce((acc, r) => acc + (r.theoretical_consumption || 0), 0);
  const totalWaste = varianceData.reduce((acc, r) => acc + (r.wastage || 0), 0);
  const alertsCount = varianceData.filter(r => r.status === 'EXCEEDED').length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Stock Variance & Audit Dashboard</h1>
          <p className={styles.subtitle}>
            Compare physical stock logs against POS sales theoretical recipe consumption to detect leakage & wastage
          </p>
        </div>
      </div>

      {/* Control Bar */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className={styles.fieldGroup} style={{ marginBottom: 0, minWidth: '220px' }}>
            <label>Select Store</label>
            <select
              value={selectedStoreId}
              onChange={e => setSelectedStoreId(e.target.value)}
            >
              {stores.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div className={styles.fieldGroup} style={{ marginBottom: 0, minWidth: '180px' }}>
            <label>Audit Date</label>
            <input
              type="date"
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>

          <div style={{ alignSelf: 'flex-end' }}>
            <button className={styles.primaryButton} onClick={calculateVariance}>
              🔄 Refresh Variance Audit
            </button>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <div className={styles.statTitle}>Total Actual Stock Used</div>
          <div className={styles.statValue}>{totalActual.toFixed(1)} <span style={{ fontSize: '1rem' }}>g/pcs</span></div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Theoretical POS Target</div>
          <div className={styles.statValue}>{totalTheo.toFixed(1)} <span style={{ fontSize: '1rem' }}>g/pcs</span></div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Logged Wastage</div>
          <div className={styles.statValue} style={{ color: 'var(--warning)' }}>{totalWaste.toFixed(1)} <span style={{ fontSize: '1rem' }}>g/pcs</span></div>
        </div>

        <div className={styles.statCard}>
          <div className={styles.statTitle}>Audit Discrepancy Alerts</div>
          <div className={styles.statValue} style={{ color: alertsCount > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {alertsCount} {alertsCount > 0 ? '⚠ Alert' : '✓ Clean'}
          </div>
        </div>
      </div>

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
                  <td colSpan={11} style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                    No stock entry or POS report uploaded for this store on {selectedDate}.
                    <br />
                    <span style={{ fontSize: '0.9rem', color: 'var(--accent-primary)' }}>
                      Ensure morning/evening stock is submitted and POS file is uploaded in Store Portal.
                    </span>
                  </td>
                </tr>
              ) : (
                varianceData.map(row => (
                  <tr
                    key={row.item_id}
                    style={{
                      background: row.status === 'EXCEEDED' ? 'rgba(255, 23, 68, 0.08)' : undefined,
                    }}
                  >
                    <td style={{ fontWeight: 600 }}>{row.item_name}</td>
                    <td>{row.category_name}</td>
                    <td>{row.opening_stock}</td>
                    <td>{row.closing_stock}</td>
                    <td style={{ fontWeight: 600 }}>{row.actual_consumption} {row.uom}</td>
                    <td style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                      {row.theoretical_consumption} {row.uom}
                    </td>
                    <td>{row.wastage}</td>
                    <td
                      style={{
                        fontWeight: 700,
                        color: row.variance > 0 ? 'var(--danger)' : row.variance < 0 ? 'var(--success)' : 'inherit',
                      }}
                    >
                      {row.variance > 0 ? `+${row.variance}` : row.variance} {row.uom}
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {row.variance_percent > 0 ? `+${row.variance_percent}%` : `${row.variance_percent}%`}
                    </td>
                    <td>
                      <span className={row.status === 'EXCEEDED' ? styles.badgeDanger : styles.badgeSuccess}>
                        {row.status === 'EXCEEDED' ? '⚠ Exceeded' : '✓ OK'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={styles.secondaryButton}
                        onClick={() => openDrillDownModal(row)}
                      >
                        Drill Down
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
