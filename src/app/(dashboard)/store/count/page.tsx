'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { Frequency, FREQUENCY_LABEL, isDue } from '@/lib/stock/schedule';
import { displayUnit, fromDisplay, toDisplay } from '@/lib/stock/units';

type Item = {
  id: string; name: string; uom: string; rista_unit: string | null;
  count_frequency: Frequency; stock_group: string | null; tare_grams: number;
};
type StaffMember = { id: string; name: string };

const ORDER: Frequency[] = ['daily', 'fortnightly', 'monthly', 'none'];

export default function StockCountPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [items, setItems] = useState<Item[]>([]);
  const [lastCount, setLastCount] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedToday, setSavedToday] = useState<Set<string>>(new Set());
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staff, setStaff] = useState('');
  const [fullCount, setFullCount] = useState(false);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: st }, { data: itemRows }, { data: counts }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('items')
        .select('id, name, uom, rista_unit, count_frequency, stock_group, tare_grams, item_categories!inner(brand_id)')
        .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).order('name'),
      // last ~2 months of counts is enough to work out what's due
      supabase.from('stock_counts').select('item_id, count_date, quantity')
        .eq('store_id', store.id).gte('count_date', addDays(today, -62)).order('count_date', { ascending: false }).limit(5000),
    ]);
    const list = ((itemRows || []) as unknown as Item[])
      .map(i => ({ ...i, tare_grams: Number(i.tare_grams) || 0 }))
      .filter(i => i.tare_grams === 0); // ice cream flavours (boxes) are counted on "Open & Close Count"
    const last: Record<string, string> = {};
    const vals: Record<string, string> = {};
    const done = new Set<string>();
    (counts || []).forEach(c => {
      if (!last[c.item_id]) last[c.item_id] = c.count_date;
      if (c.count_date === today) {
        const it = list.find(i => i.id === c.item_id);
        if (it) { vals[c.item_id] = String(toDisplay(Number(c.quantity), it.rista_unit, it.uom)); done.add(c.item_id); }
      }
    });
    setStaffList(st || []);
    setItems(list);
    setLastCount(last);
    setValues(vals);
    setSavedToday(done);
    setLoading(false);
  }, [supabase, store, today]);

  useEffect(() => { load(); }, [load]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  const shown = items.filter(i =>
    (fullCount ? true : isDue(i.count_frequency, lastCount[i.id] || null, today)) &&
    (!search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase())));

  const save = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who is counting', 'error'); return; }
    const filled = shown.filter(i => (values[i.id] ?? '').trim() !== '');
    if (!filled.length) { showToast('Enter at least one count', 'error'); return; }
    const bad = filled.find(i => isNaN(Number(values[i.id])) || Number(values[i.id]) < 0);
    if (bad) { showToast(`Check the number for ${bad.name}`, 'error'); return; }
    const empty = shown.filter(i => (values[i.id] ?? '').trim() === '');
    if (empty.length && !confirm(`${empty.length} item(s) are still empty (e.g. ${empty[0].name}). Save the ones you've counted?`)) return;

    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('stock_counts').upsert(filled.map(i => ({
      store_id: store.id, item_id: i.id, count_date: today,
      quantity: fromDisplay(Number(values[i.id]), i.rista_unit, i.uom),
      kind: fullCount ? 'audit' : 'count',
      staff_member_id: staff, submitted_by_profile_id: user?.id,
    })), { onConflict: 'store_id,item_id,count_date' });
    setSaving(false);
    if (error) {
      showToast(/row-level security/i.test(error.message) ? 'This day is closed for changes. Ask your manager.' : 'Could not save: ' + error.message, 'error');
      return;
    }
    showToast(`${filled.length} count${filled.length > 1 ? 's' : ''} saved`, 'success');
    load();
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login.</div>;

  const groups = ORDER.map(f => ({ f, list: shown.filter(i => i.count_frequency === f) })).filter(g => g.list.length);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Stock Count</h1>
          <p className={styles.subtitle}>Count at closing. Enter what is <strong>actually there</strong> — open + unopened packs together.</p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${!fullCount ? styles.active : ''}`} onClick={() => setFullCount(false)}>Due today</button>
        <button className={`${styles.tab} ${fullCount ? styles.active : ''}`} onClick={() => setFullCount(true)}>Full count (audit)</button>
      </div>

      <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <select className={styles.select} value={staff} onChange={e => setStaff(e.target.value)}>
          <option value="">Who is counting?</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className={styles.input} style={{ flex: 1, minWidth: 180 }} placeholder="Search item…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {shown.length === 0 && (
        <p className={styles.statusText}>
          {items.length === 0 ? 'No items set up yet — add them on the Items page.' : 'Nothing is due today. 🎉'}
        </p>
      )}

      <div className={styles.formContainer}>
        {groups.map(g => (
          <div key={g.f} className={styles.categorySection}>
            <h2 className={styles.categoryHeader}>{FREQUENCY_LABEL[g.f]}</h2>
            <div className={styles.itemGrid}>
              {g.list.map(i => (
                <div key={i.id} className={styles.itemRow}>
                  <div className={styles.itemInfo}>
                    <span className={styles.itemName}>{i.name}{savedToday.has(i.id) ? ' ✓' : ''}</span>
                    <span className={styles.badge}>{displayUnit(i.rista_unit, i.uom)}</span>
                  </div>
                  <input type="number" inputMode="decimal" min="0" className={styles.input}
                    value={values[i.id] ?? ''} placeholder={`Count in ${displayUnit(i.rista_unit, i.uom)}`}
                    aria-label={`${i.name} count`}
                    onChange={e => setValues(v => ({ ...v, [i.id]: e.target.value }))} />
                  {!lastCount[i.id] && <div style={{ fontSize: '0.8rem', color: 'var(--warning)' }}>First count for this item</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {shown.length > 0 && (
        <div className={styles.submitArea}>
          <button className={styles.button} onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Count'}</button>
        </div>
      )}
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
