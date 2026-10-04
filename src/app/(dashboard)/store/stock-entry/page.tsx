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
  sub_category: string | null;
  tare_grams: number;          // empty tub weight (Baskin Robbins flavours: 100 g)
  item_categories: { name: string; sort_order: number; brand_id: string } | null;
};

type Mode = 'opening' | 'closing';

// What staff type in. For tub items "qty" is the weight on the scale (tubs included).
type Entry = { qty: string; tubs: string };

type Row = {
  existsToday: boolean;
  opening: Entry;
  closing: Entry;
};

type StaffMember = { id: string; name: string };

const toStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

/** Net stock that gets saved: scale weight minus empty tubs. */
function netOf(item: Item, e: Entry): number | null {
  if (e.qty === '') return null;
  const gross = Number(e.qty);
  if (!item.tare_grams) return gross;
  return gross - (Number(e.tubs) || 0) * item.tare_grams;
}

/** Rebuild what the scale showed from a saved net value. */
function entryFromSaved(item: Item, net: number | null, tubs: number | null): Entry {
  if (net === null || net === undefined) return { qty: '', tubs: '' };
  const t = tubs || 0;
  return { qty: toStr(Number(net) + t * (item.tare_grams || 0)), tubs: item.tare_grams ? toStr(t) : '' };
}

export default function StockEntryPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [mode, setMode] = useState<Mode>('opening');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [items, setItems] = useState<Item[]>([]);
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [search, setSearch] = useState('');
  const [received, setReceived] = useState<Record<string, number>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);

    const [{ data: staff }, { data: itemRows }, { data: todayRows }, { data: pastRows }, { data: deliveryRows }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      // Only this store's brand
      supabase.from('items')
        .select('id, name, uom, sub_category, tare_grams, item_categories!inner(name, sort_order, brand_id)')
        .eq('is_active', true)
        .eq('is_daily_tracked', true)
        .eq('item_categories.brand_id', store.brand_id),
      supabase.from('daily_stock_entries')
        .select('item_id, opening_stock, closing_stock, opening_containers, closing_containers')
        .eq('store_id', store.id).eq('entry_date', today),
      // Most recent earlier closing count per item (pre-fills today's opening)
      supabase.from('daily_stock_entries').select('item_id, closing_stock, closing_containers, entry_date')
        .eq('store_id', store.id).lt('entry_date', today).not('closing_stock', 'is', null)
        .order('entry_date', { ascending: false }).limit(2000),
      // Deliveries received today
      supabase.from('purchase_orders').select('item_id, quantity')
        .eq('store_id', store.id).eq('entry_date', today),
    ]);

    const rec: Record<string, number> = {};
    (deliveryRows || []).forEach(d => { rec[d.item_id] = (rec[d.item_id] || 0) + Number(d.quantity); });
    setReceived(rec);

    const list = ((itemRows || []) as unknown as Item[])
      .map(i => ({ ...i, tare_grams: Number(i.tare_grams) || 0 }))
      .sort((a, b) =>
        (a.item_categories?.sort_order ?? 999) - (b.item_categories?.sort_order ?? 999) || a.name.localeCompare(b.name));

    const map: Record<string, Row> = {};
    list.forEach(item => {
      const t = todayRows?.find(r => r.item_id === item.id);
      const last = pastRows?.find(r => r.item_id === item.id);
      map[item.id] = {
        existsToday: Boolean(t),
        opening: t
          ? entryFromSaved(item, t.opening_stock, t.opening_containers)
          : last ? entryFromSaved(item, last.closing_stock, last.closing_containers) : { qty: '', tubs: '' },
        closing: t ? entryFromSaved(item, t.closing_stock, t.closing_containers) : { qty: '', tubs: '' },
      };
    });

    setStaffList(staff || []);
    setItems(list);
    setRows(map);
    setLoading(false);
  }, [supabase, store, today]);

  useEffect(() => { load(); }, [load]);

  const setField = (itemId: string, field: keyof Entry, value: string) => {
    setRows(prev => ({ ...prev, [itemId]: { ...prev[itemId], [mode]: { ...prev[itemId][mode], [field]: value } } }));
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const handleSubmit = async () => {
    if (!store) return;
    if (!selectedStaff) { showToast('Please select who is counting', 'error'); return; }

    const missing = items.filter(i => rows[i.id]?.[mode].qty === '');
    if (missing.length > 0) {
      showToast(`Please fill all items (${missing.length} empty). Enter 0 if none left.`, 'error');
      return;
    }
    const negative = items.filter(i => (netOf(i, rows[i.id][mode]) ?? 0) < 0);
    if (negative.length > 0) {
      showToast(`Check ${negative[0].name}: weight is less than the empty tubs.`, 'error');
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
        const opening = { opening_stock: netOf(item, r.opening) ?? 0, opening_containers: Number(r.opening.tubs) || 0 };
        const closing = { closing_stock: netOf(item, r.closing) ?? 0, closing_containers: Number(r.closing.tubs) || 0 };
        if (mode === 'opening') return { ...base, ...opening };
        // Closing for an item with no opening today: also save the pre-filled opening
        return r.existsToday ? { ...base, ...closing } : { ...base, ...opening, ...closing };
      });

      // Upsert in groups with identical columns
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

  const term = search.trim().toLowerCase();
  const shown = term ? items.filter(i => i.name.toLowerCase().includes(term)) : items;
  const grouped = shown.reduce((acc, item) => {
    const cat = item.item_categories?.name || 'Other';
    (acc[cat] = acc[cat] || []).push(item);
    return acc;
  }, {} as Record<string, Item[]>);
  const hasTubs = items.some(i => i.tare_grams > 0);

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

      <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <select className={styles.select} value={selectedStaff} onChange={e => setSelectedStaff(e.target.value)}>
          <option value="">Who is counting?</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {items.length > 12 && (
          <input className={styles.input} style={{ flex: 1, minWidth: '180px' }} placeholder="Search item…"
            value={search} onChange={e => setSearch(e.target.value)} />
        )}
      </div>

      {hasTubs && (
        <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
          🍨 Ice cream: put the tub(s) on the scale and enter the <strong>total weight</strong> and <strong>number of tubs</strong>. The empty tub weight is taken off automatically.
        </p>
      )}

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
                const entry = r?.[mode] ?? { qty: '', tubs: '' };
                const net = netOf(item, entry);
                const openingNet = r ? netOf(item, r.opening) : null;
                const got = received[item.id] || 0;
                const used = mode === 'closing' && openingNet !== null && net !== null ? openingNet + got - net : null;
                const tub = item.tare_grams > 0;

                return (
                  <div key={item.id} className={styles.itemRow}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.badge}>{tub ? 'g on scale' : item.uom}</span>
                    </div>
                    {mode === 'closing' && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Opening: {openingNet === null ? '–' : `${openingNet} ${item.uom}`}
                        {got > 0 && <> · Received: {got} {item.uom}</>}
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        className={styles.input}
                        value={entry.qty}
                        onChange={e => setField(item.id, 'qty', e.target.value)}
                        placeholder={tub ? 'Total weight (g)' : mode === 'opening' ? 'Opening' : 'Closing'}
                        aria-label={`${item.name} ${tub ? 'total weight' : 'quantity'}`}
                      />
                      {tub && (
                        <input
                          type="number"
                          inputMode="numeric"
                          min="0"
                          step="1"
                          className={styles.input}
                          style={{ maxWidth: '90px' }}
                          value={entry.tubs}
                          onChange={e => setField(item.id, 'tubs', e.target.value)}
                          placeholder="Tubs"
                          aria-label={`${item.name} number of tubs`}
                        />
                      )}
                    </div>
                    {tub && net !== null && (
                      <div style={{ color: net < 0 ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        Ice cream: {net} g{net < 0 ? ' — check weight / tubs' : ''}
                      </div>
                    )}
                    {used !== null && (
                      <div style={{ color: used < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        Used: {used} {item.uom}{used < 0 ? ' (more than opening + received — check the count or add a delivery)' : ''}
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
