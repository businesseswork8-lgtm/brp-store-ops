'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';

type Item = {
  id: string;
  name: string;
  uom: string;
  item_categories: { name: string; sort_order: number; brand_id: string } | null;
};

type Row = {
  existsToday: boolean;
  opening: string;        // what's saved/entered for today's opening
  closing: string;        // what's saved/entered for today's closing
  lastClosing: string;    // most recent earlier closing (used to pre-fill opening)
};

type StaffMember = { id: string; name: string };

const toStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

export default function StockEntryPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [mode, setMode] = useState<'opening' | 'closing'>('opening');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);

    const [{ data: staff }, { data: itemRows }, { data: todayRows }, { data: pastRows }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      // Only this store's brand
      supabase.from('items')
        .select('id, name, uom, item_categories!inner(name, sort_order, brand_id)')
        .eq('is_active', true)
        .eq('is_daily_tracked', true)
        .eq('item_categories.brand_id', store.brand_id),
      supabase.from('daily_stock_entries').select('item_id, opening_stock, closing_stock')
        .eq('store_id', store.id).eq('entry_date', today),
      // Last 14 days to find each item's most recent closing count
      supabase.from('daily_stock_entries').select('item_id, closing_stock, entry_date')
        .eq('store_id', store.id).lt('entry_date', today).not('closing_stock', 'is', null)
        .order('entry_date', { ascending: false }).limit(2000),
    ]);

    const list = ((itemRows || []) as unknown as Item[]).sort((a, b) =>
      (a.item_categories?.sort_order ?? 999) - (b.item_categories?.sort_order ?? 999) || a.name.localeCompare(b.name));

    const map: Record<string, Row> = {};
    list.forEach(item => {
      const t = todayRows?.find(r => r.item_id === item.id);
      const last = pastRows?.find(r => r.item_id === item.id);
      map[item.id] = {
        existsToday: Boolean(t),
        opening: t ? toStr(t.opening_stock) : '',
        closing: t ? toStr(t.closing_stock) : '',
        lastClosing: last ? toStr(last.closing_stock) : '',
      };
      // Pre-fill opening from last closing if not counted yet today
      if (!t && last) map[item.id].opening = toStr(last.closing_stock);
    });

    setStaffList(staff || []);
    setItems(list);
    setRows(map);
    setLoading(false);
  }, [supabase, store, today]);

  useEffect(() => { load(); }, [load]);

  const setValue = (itemId: string, value: string) => {
    setRows(prev => ({ ...prev, [itemId]: { ...prev[itemId], [mode]: value } }));
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSubmit = async () => {
    if (!store) return;
    if (!selectedStaff) { showToast('Please select who is counting', 'error'); return; }

    const missing = items.filter(i => rows[i.id]?.[mode] === '');
    if (missing.length > 0) {
      showToast(`Please fill all items (${missing.length} empty). Enter 0 if none left.`, 'error');
      return;
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      // Only send the column being counted, so opening never overwrites closing and vice versa.
      const payload = items.map(item => {
        const r = rows[item.id];
        const base = {
          store_id: store.id,
          item_id: item.id,
          entry_date: today,
          staff_member_id: selectedStaff,
          submitted_by_profile_id: user.id,
        };
        if (mode === 'opening') return { ...base, opening_stock: Number(r.opening) };
        // Closing for an item with no opening today: use the pre-filled opening
        return r.existsToday
          ? { ...base, closing_stock: Number(r.closing) }
          : { ...base, opening_stock: Number(r.opening || r.lastClosing || 0), closing_stock: Number(r.closing) };
      });

      // Split: rows that need both fields vs single field, so upsert column sets are consistent
      const groups = new Map<string, typeof payload>();
      payload.forEach(p => {
        const key = Object.keys(p).sort().join(',');
        groups.set(key, [...(groups.get(key) || []), p]);
      });
      for (const group of groups.values()) {
        const { error } = await supabase.from('daily_stock_entries')
          .upsert(group, { onConflict: 'store_id,item_id,entry_date' });
        if (error) throw error;
      }

      showToast(`${mode === 'opening' ? 'Opening' : 'Closing'} stock saved`, 'success');
      load();
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Could not save. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const grouped = items.reduce((acc, item) => {
    const cat = item.item_categories?.name || 'Other';
    (acc[cat] = acc[cat] || []).push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title}>Stock Count</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${mode === 'opening' ? styles.active : ''}`} onClick={() => setMode('opening')}>
          Opening
        </button>
        <button className={`${styles.tab} ${mode === 'closing' ? styles.active : ''}`} onClick={() => setMode('closing')}>
          Closing
        </button>
      </div>

      <div className={styles.controls}>
        <select className={styles.select} value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)}>
          <option value="">Who is counting?</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      {items.length === 0 && (
        <p className={styles.statusText}>No items are set up for this store yet.</p>
      )}

      <div className={styles.formContainer}>
        {Object.entries(grouped).map(([category, catItems]) => (
          <div key={category} className={styles.categorySection}>
            <h2 className={styles.categoryHeader}>{category}</h2>
            <div className={styles.itemGrid}>
              {catItems.map(item => {
                const r = rows[item.id];
                const value = r?.[mode] ?? '';
                const opening = r?.opening ?? '';
                const used = mode === 'closing' && opening !== '' && value !== ''
                  ? Number(opening) - Number(value) : null;

                return (
                  <div key={item.id} className={styles.itemRow}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.badge}>{item.uom}</span>
                    </div>
                    {mode === 'closing' && (
                      <div style={{ color: 'var(--text-secondary)' }}>Opening: {opening === '' ? '–' : opening}</div>
                    )}
                    <input
                      type="number"
                      inputMode="decimal"
                      min="0"
                      className={styles.input}
                      value={value}
                      onChange={e => setValue(item.id, e.target.value)}
                      placeholder={mode === 'opening' ? 'Opening' : 'Closing'}
                    />
                    {used !== null && (
                      <div style={{ color: used < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        Used: {used}{used < 0 ? ' (more than opening — delivery?)' : ''}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {items.length > 0 && (
        <div className={styles.submitArea}>
          <button className={styles.button} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : `Save ${mode === 'opening' ? 'Opening' : 'Closing'} Stock`}
          </button>
        </div>
      )}

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
