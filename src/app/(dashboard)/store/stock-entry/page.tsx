'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';
import { BoxEntry, boxEntryEmpty, boxEntryFromSaved, boxNet, isBoxItem } from '@/lib/icecream';

type Item = {
  id: string;
  name: string;
  uom: string;
  sub_category: string | null;
  tare_grams: number;          // empty box weight (Baskin Robbins flavours: 100 g)
  full_box_grams: number | null; // ice cream in one sealed box
  item_categories: { name: string; sort_order: number; brand_id: string } | null;
};

type Mode = 'opening' | 'closing';

/** What staff type in. Normal items use qty; ice cream uses unopened boxes + open box weight. */
type Entry = { qty: string } & BoxEntry;
type Row = { existsToday: boolean; opening: Entry; closing: Entry };
type StaffMember = { id: string; name: string };

const blank = (): Entry => ({ qty: '', unopened: '', openGross: '' });
const toStr = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v));

function isEmpty(item: Item, e: Entry) {
  return isBoxItem(item) ? boxEntryEmpty(e) : e.qty.trim() === '';
}

/** Net stock that gets saved, or an error to show. */
function netOf(item: Item, e: Entry): { value: number | null; error: string | null } {
  if (isBoxItem(item)) {
    const r = boxNet(item, e);
    return { value: r.grams, error: r.error };
  }
  if (e.qty.trim() === '') return { value: null, error: null };
  const n = Number(e.qty);
  if (isNaN(n) || n < 0) return { value: null, error: `${item.name}: check the quantity` };
  return { value: n, error: null };
}

function entryFromSaved(item: Item, net: number | null, unopened: number | null, openGross: number | null): Entry {
  if (net === null || net === undefined) return blank();
  if (isBoxItem(item)) return { qty: '', ...boxEntryFromSaved(unopened, openGross) };
  return { qty: toStr(Number(net)), unopened: '', openGross: '' };
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

    // Last day before today that has a closing count (pre-fills today's opening)
    const { data: lastDay } = await supabase.from('daily_stock_entries').select('entry_date')
      .eq('store_id', store.id).lt('entry_date', today).not('closing_stock', 'is', null)
      .order('entry_date', { ascending: false }).limit(1).maybeSingle();

    const [{ data: staff }, { data: itemRows }, { data: todayRows }, { data: pastRows }, { data: deliveryRows }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      // Only this store's brand
      supabase.from('items')
        .select('id, name, uom, sub_category, tare_grams, full_box_grams, item_categories!inner(name, sort_order, brand_id)')
        .eq('is_active', true)
        .eq('is_daily_tracked', true)
        .eq('item_categories.brand_id', store.brand_id),
      supabase.from('daily_stock_entries')
        .select('item_id, opening_stock, closing_stock, opening_containers, closing_containers, opening_open_gross, closing_open_gross')
        .eq('store_id', store.id).eq('entry_date', today),
      lastDay
        ? supabase.from('daily_stock_entries').select('item_id, closing_stock, closing_containers, closing_open_gross')
            .eq('store_id', store.id).eq('entry_date', lastDay.entry_date).not('closing_stock', 'is', null)
        : Promise.resolve({ data: [] as { item_id: string; closing_stock: number; closing_containers: number; closing_open_gross: number | null }[] }),
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
          ? entryFromSaved(item, t.opening_stock, t.opening_containers, t.opening_open_gross)
          : last ? entryFromSaved(item, last.closing_stock, last.closing_containers, last.closing_open_gross) : blank(),
        closing: t ? entryFromSaved(item, t.closing_stock, t.closing_containers, t.closing_open_gross) : blank(),
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
    setTimeout(() => setToast(null), 4000);
  };

  const handleSubmit = async () => {
    if (!store) return;
    if (!selectedStaff) { showToast('Please select who is counting', 'error'); return; }

    const missing = items.filter(i => isEmpty(i, rows[i.id][mode]));
    if (missing.length > 0) {
      showToast(`Please fill all items (${missing.length} empty, e.g. ${missing[0].name}). Enter 0 if none left.`, 'error');
      return;
    }
    // Closing needs an opening for the same day
    if (mode === 'closing') {
      const noOpening = items.filter(i => !rows[i.id].existsToday && isEmpty(i, rows[i.id].opening));
      if (noOpening.length > 0) {
        showToast(`Opening stock was not counted for ${noOpening[0].name}${noOpening.length > 1 ? ` and ${noOpening.length - 1} more` : ''}. Save Opening first.`, 'error');
        return;
      }
    }
    for (const i of items) {
      const errs = [netOf(i, rows[i.id][mode]).error, mode === 'closing' && !rows[i.id].existsToday ? netOf(i, rows[i.id].opening).error : null];
      const err = errs.find(Boolean);
      if (err) { showToast(err, 'error'); return; }
    }

    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      // Only send the column being counted, so opening never overwrites closing and vice versa.
      const payload = items.map(item => {
        const r = rows[item.id];
        const box = isBoxItem(item);
        const base = {
          store_id: store.id,
          item_id: item.id,
          entry_date: today,
          staff_member_id: selectedStaff,
          submitted_by_profile_id: user.id,
        };
        const part = (m: Mode) => {
          const e = r[m];
          return {
            [`${m}_stock`]: netOf(item, e).value ?? 0,
            [`${m}_containers`]: box ? Number(e.unopened) || 0 : 0,
            [`${m}_open_gross`]: box ? Number(e.openGross) || 0 : null,
          };
        };
        if (mode === 'opening') return { ...base, ...part('opening') };
        // Closing for an item with no row today: also save the pre-filled opening
        return r.existsToday ? { ...base, ...part('closing') } : { ...base, ...part('opening'), ...part('closing') };
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
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || '';
      showToast(/row-level security/i.test(msg)
        ? 'This day is closed for changes. Ask your manager to correct it.'
        : msg || 'Could not save. Please try again.', 'error');
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
  const hasBoxes = items.some(isBoxItem);

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

      {hasBoxes && (
        <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
          🍨 Ice cream: enter the number of <strong>unopened boxes</strong>, and put the <strong>open box</strong> on the scale and enter its weight in grams.
          The empty box (100 g) is taken off automatically. No open box? Leave the weight blank.
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
                const entry = r?.[mode] ?? blank();
                const box = isBoxItem(item);
                const { value: net, error } = netOf(item, entry);
                const openingNet = r ? netOf(item, r.opening).value : null;
                const got = received[item.id] || 0;
                const used = mode === 'closing' && openingNet !== null && net !== null ? openingNet + got - net : null;

                return (
                  <div key={item.id} className={styles.itemRow}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.badge}>{box ? 'grams' : item.uom}</span>
                    </div>
                    {mode === 'closing' && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Opening: {openingNet === null ? '–' : `${openingNet} ${item.uom}`}
                        {got > 0 && <> · Received: {got} {item.uom}</>}
                      </div>
                    )}
                    {box ? (
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                          type="number" inputMode="numeric" min="0" step="1"
                          className={styles.input} style={{ maxWidth: '120px' }}
                          value={entry.unopened}
                          onChange={e => setField(item.id, 'unopened', e.target.value)}
                          placeholder="Unopened boxes"
                          aria-label={`${item.name} unopened boxes`}
                        />
                        <input
                          type="number" inputMode="decimal" min="0"
                          className={styles.input}
                          value={entry.openGross}
                          onChange={e => setField(item.id, 'openGross', e.target.value)}
                          placeholder="Open box on scale (g)"
                          aria-label={`${item.name} open box weight`}
                        />
                      </div>
                    ) : (
                      <input
                        type="number" inputMode="decimal" min="0"
                        className={styles.input}
                        value={entry.qty}
                        onChange={e => setField(item.id, 'qty', e.target.value)}
                        placeholder={mode === 'opening' ? 'Opening' : 'Closing'}
                        aria-label={`${item.name} quantity`}
                      />
                    )}
                    {box && (error || net !== null) && (
                      <div style={{ color: error ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '0.85rem' }}>
                        {error || `Ice cream: ${net} g`}
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
