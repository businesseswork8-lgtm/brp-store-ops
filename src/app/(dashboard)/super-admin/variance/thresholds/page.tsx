'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../../super-admin.module.css';

type Threshold = {
  id: string;
  item_id?: string | null;
  category_id?: string | null;
  threshold_percent: number;
  items?: { name: string };
  item_categories?: { name: string };
};

type Item = { id: string; name: string };
type Category = { id: string; name: string };

export default function VarianceThresholdsPage() {
  const supabase = createClient();

  const [thresholds, setThresholds] = useState<Threshold[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editVal, setEditVal] = useState<number>(5.0);

  const [isAdding, setIsAdding] = useState(false);
  const [targetType, setTargetType] = useState<'item' | 'category'>('item');
  const [targetId, setTargetId] = useState('');
  const [newThresholdPercent, setNewThresholdPercent] = useState<number>(5.0);

  useEffect(() => {
    fetchData();
  }, []);

  async function fetchData() {
    setLoading(true);
    const { data: iRaw } = await supabase.from('items')
      .select('id, name, item_categories(brands(code))').eq('is_active', true).order('name');
    // Show the brand next to each item so 99P and BR items can't be confused
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const iData = (iRaw || []).map((i: any) => ({ id: i.id, name: `${i.name} (${i.item_categories?.brands?.code || '?'})` }));
    if (iData) {
      setItems(iData);
      if (iData.length > 0) setTargetId(iData[0].id);
    }

    const { data: cRaw } = await supabase.from('item_categories').select('id, name, brands(code)').order('name');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setCategories((cRaw || []).map((c: any) => ({ id: c.id, name: `${c.name} (${c.brands?.code || '?'})` })));

    const { data: tData } = await supabase
      .from('variance_thresholds')
      .select('*, items(name), item_categories(name)');

    if (tData) setThresholds(tData);
    setLoading(false);
  }

  async function handleSaveEdit(id: string) {
    const { error } = await supabase
      .from('variance_thresholds')
      .update({ threshold_percent: editVal })
      .eq('id', id);

    if (!error) {
      setEditingId(null);
      fetchData();
    }
  }

  async function handleDelete(id: string) {
    if (!confirm('Remove this alert limit? The default limit will apply instead.')) return;
    const { error } = await supabase.from('variance_thresholds').delete().eq('id', id);
    if (error) alert('Could not delete: ' + error.message);
    else fetchData();
  }

  async function handleCreateThreshold(e: React.FormEvent) {
    e.preventDefault();
    if (!targetId) return;

    const payload: any = { threshold_percent: newThresholdPercent };
    if (targetType === 'item') {
      payload.item_id = targetId;
    } else {
      payload.category_id = targetId;
    }

    const { error } = await supabase.from('variance_thresholds').insert(payload);
    if (!error) {
      setIsAdding(false);
      fetchData();
    } else {
      alert('Error creating threshold rule: ' + error.message);
    }
  }

  // Find global default threshold (where item_id and category_id are null)
  const defaultThresholdRow = thresholds.find(t => !t.item_id && !t.category_id);
  const specificThresholds = thresholds.filter(t => t.item_id || t.category_id);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Variance Tolerance Thresholds</h1>
          <p className={styles.subtitle}>Configure acceptable stock variance % triggers for audit alerts</p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link href="/super-admin/variance" className={styles.secondaryButton} style={{ textDecoration: 'none' }}>
            ← Back to Variance Audit
          </Link>
          <button className={styles.primaryButton} onClick={() => setIsAdding(!isAdding)}>
            {isAdding ? 'Cancel' : '+ Add Custom Rule'}
          </button>
        </div>
      </div>

      {/* Global Default Banner */}
      <div className={styles.card} style={{ marginBottom: '1.5rem', background: 'rgba(255,107,53,0.1)', borderColor: 'var(--accent-primary)' }}>
        <h3 style={{ margin: 0, color: 'var(--accent-primary)' }}>Default System Threshold</h3>
        <p style={{ margin: '0.5rem 0', color: 'var(--text-secondary)' }}>
          Items without custom rules trigger red audit alerts when their actual stock consumption deviates from POS theoretical consumption by more than:
        </p>
        <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
          ± {defaultThresholdRow ? defaultThresholdRow.threshold_percent : 5.0} %
        </div>
      </div>

      {isAdding && (
        <form className={styles.card} onSubmit={handleCreateThreshold} style={{ marginBottom: '1.5rem' }}>
          <h3>Add Custom Variance Threshold Rule</h3>
          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}>
              <label>Apply Rule To</label>
              <select
                value={targetType}
                onChange={e => {
                  const type = e.target.value as 'item' | 'category';
                  setTargetType(type);
                  if (type === 'item' && items.length > 0) setTargetId(items[0].id);
                  if (type === 'category' && categories.length > 0) setTargetId(categories[0].id);
                }}
              >
                <option value="item">Specific Item</option>
                <option value="category">Whole Item Category</option>
              </select>
            </div>

            <div className={styles.fieldGroup}>
              <label>Select Target</label>
              {targetType === 'item' ? (
                <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                  {items.map(i => (
                    <option key={i.id} value={i.id}>{i.name}</option>
                  ))}
                </select>
              ) : (
                <select value={targetId} onChange={e => setTargetId(e.target.value)}>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className={styles.fieldGroup}>
              <label>Max Allowed Variance (+/- %)</label>
              <input
                type="number"
                step="0.5"
                required
                value={newThresholdPercent}
                onChange={e => setNewThresholdPercent(parseFloat(e.target.value) || 0)}
              />
            </div>
          </div>

          <button type="submit" className={styles.primaryButton} style={{ marginTop: '1rem' }}>
            Save Threshold Rule
          </button>
        </form>
      )}

      {/* Threshold Rules Table */}
      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Loading threshold settings...
        </div>
      ) : (
        <div className={styles.card}>
          <h3>Specific Threshold Rules</h3>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Scope / Target</th>
                <th>Target Name</th>
                <th>Tolerance Threshold (%)</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {specificThresholds.length === 0 ? (
                <tr>
                  <td colSpan={4} style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem' }}>
                    No specific rules defined. All items currently use the 5.0% default system threshold.
                  </td>
                </tr>
              ) : (
                specificThresholds.map(t => (
                  <tr key={t.id}>
                    <td>
                      <span className={styles.badgeDefault}>
                        {t.item_id ? 'Item Rule' : 'Category Rule'}
                      </span>
                    </td>
                    <td style={{ fontWeight: 600 }}>
                      {t.items?.name || t.item_categories?.name || 'Rule'}
                    </td>
                    <td>
                      {editingId === t.id ? (
                        <input
                          type="number"
                          step="0.5"
                          value={editVal}
                          onChange={e => setEditVal(parseFloat(e.target.value) || 0)}
                          style={{ width: '80px' }}
                        />
                      ) : (
                        `± ${t.threshold_percent}%`
                      )}
                    </td>
                    <td>
                      {editingId === t.id ? (
                        <button className={styles.secondaryButton} onClick={() => handleSaveEdit(t.id)}>
                          Save
                        </button>
                      ) : (
                        <button
                          className={styles.secondaryButton}
                          onClick={() => {
                            setEditingId(t.id);
                            setEditVal(t.threshold_percent);
                          }}
                        >
                          Edit
                        </button>
                      )}
                      <button className={styles.secondaryButton} style={{ marginLeft: '0.5rem' }} onClick={() => handleDelete(t.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
