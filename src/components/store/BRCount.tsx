'use client';

import React, { useCallback, useEffect, useState, useRef } from 'react';
import Link from 'next/link';
import styles from '@/app/(dashboard)/store/store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { BoxEntry, boxEntryEmpty, boxNet, EMPTY_BOX_GRAMS, FULL_BOX_GRAMS } from '@/lib/icecream';
import { Session, grams } from '@/lib/br';
import { StockTabs } from '@/components/store/StockTabs';

type Flavour = {
  id: string; name: string; tare_grams: number; full_box_grams: number | null;
  item_categories: { name: string; sort_order: number };
};
type StaffMember = { id: string; name: string };
const EMPTY: BoxEntry = { unopened: '', openGross: '' };

/** Baskin Robbins: weigh every flavour at opening and at closing. Auto-saves on every item! */
export function BRCount() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [flavours, setFlavours] = useState<Flavour[]>([]);
  const [session, setSession] = useState<Session>('opening');
  const [entries, setEntries] = useState<Record<Session, Record<string, BoxEntry>>>({ opening: {}, closing: {} });
  const [saved, setSaved] = useState<Record<Session, Set<string>>>({ opening: new Set(), closing: new Set() });
  const [savingId, setSavingId] = useState<string | null>(null);
  const [lastNight, setLastNight] = useState<Record<string, number>>({});
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [staff, setStaff] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const debounceTimers = useRef<Record<string, NodeJS.Timeout>>({});
  const staffRef = useRef(staff);
  staffRef.current = staff;

  const today = istDate();

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: st }, { data: rows }, { data: counts }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('items')
        .select('id, name, tare_grams, full_box_grams, item_categories!inner(brand_id, is_flavour, name, sort_order)')
        .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).eq('item_categories.is_flavour', true)
        .order('name'),
      supabase.from('br_flavour_counts').select('item_id, count_date, session, unopened_boxes, open_box_gross, grams, staff_member_id')
        .eq('store_id', store.id).gte('count_date', addDays(today, -1)).lte('count_date', today),
    ]);
    const list = ((rows || []) as unknown as Flavour[])
      .map(f => ({ ...f, tare_grams: Number(f.tare_grams) || EMPTY_BOX_GRAMS, full_box_grams: f.full_box_grams === null ? null : Number(f.full_box_grams) }))
      .sort((a, b) => a.item_categories.sort_order - b.item_categories.sort_order || a.name.localeCompare(b.name));
    const e: Record<Session, Record<string, BoxEntry>> = { opening: {}, closing: {} };
    const s: Record<Session, Set<string>> = { opening: new Set(), closing: new Set() };
    const ln: Record<string, number> = {};
    let savedStaff = '';
    (counts || []).forEach(c => {
      if (c.count_date === today) {
        const ses = c.session as Session;
        e[ses][c.item_id] = { unopened: String(c.unopened_boxes ?? 0), openGross: Number(c.open_box_gross) > 0 ? String(c.open_box_gross) : '' };
        s[ses].add(c.item_id);
        if (c.staff_member_id && !savedStaff) savedStaff = c.staff_member_id;
      } else if (c.session === 'closing') ln[c.item_id] = Number(c.grams);
    });
    setStaffList(st || []);
    if (savedStaff && !staff) setStaff(savedStaff);
    else if ((st || []).length === 1 && !staff) setStaff((st || [])[0].id);
    setFlavours(list);
    setEntries(e);
    setSaved(s);
    setLastNight(ln);
    // Open the tab that still needs doing
    setSession(list.length && s.opening.size >= list.length ? 'closing' : 'opening');
    setLoading(false);
  }, [supabase, store, today, staff]);

  useEffect(() => { load(); }, [load]);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const cur = entries[session];

  // Auto-save a single item to Supabase as soon as entered or on blur
  const autoSaveItem = async (f: Flavour, entryOverride?: BoxEntry) => {
    if (!store) return;
    const currentStaff = staffRef.current;
    if (!currentStaff) {
      showToast('Select who is weighing at the top to enable auto-save', 'error');
      return;
    }
    const b = entryOverride || cur[f.id] || EMPTY;
    if (boxEntryEmpty(b)) return;
    const r = boxNet(f, b);
    if (r.error || r.grams === null) return;

    setSavingId(f.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from('br_flavour_counts').upsert({
        store_id: store.id,
        item_id: f.id,
        count_date: today,
        session,
        unopened_boxes: Number(b.unopened) || 0,
        open_box_gross: Number(b.openGross) || 0,
        grams: r.grams ?? 0,
        staff_member_id: currentStaff,
        submitted_by_profile_id: user?.id,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_id,item_id,count_date,session' });

      if (error) {
        console.error('Auto-save error:', error);
      } else {
        setSaved(prev => ({
          ...prev,
          [session]: new Set([...prev[session], f.id]),
        }));
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSavingId(null);
    }
  };

  const setEntry = (f: Flavour, k: keyof BoxEntry, v: string) => {
    const updated = { ...(cur[f.id] || EMPTY), [k]: v };
    setEntries(x => ({ ...x, [session]: { ...x[session], [f.id]: updated } }));

    // Debounced auto-save (800ms) while typing
    if (debounceTimers.current[f.id]) clearTimeout(debounceTimers.current[f.id]);
    debounceTimers.current[f.id] = setTimeout(() => {
      autoSaveItem(f, updated);
    }, 800);
  };

  const save = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who is weighing', 'error'); return; }
    const missing = flavours.filter(f => boxEntryEmpty(cur[f.id] || EMPTY));
    if (missing.length) {
      showToast(`Every flavour is needed. ${missing.length} still empty (e.g. ${missing[0].name}). If a flavour has nothing, enter 0 boxes.`, 'error');
      return;
    }
    const rows = [];
    for (const f of flavours) {
      const r = boxNet(f, cur[f.id]);
      if (r.error) { showToast(r.error, 'error'); return; }
      rows.push({
        store_id: store.id, item_id: f.id, count_date: today, session,
        unopened_boxes: Number(cur[f.id].unopened) || 0,
        open_box_gross: Number(cur[f.id].openGross) || 0,
        grams: r.grams ?? 0,
        staff_member_id: staff,
      });
    }
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    const { error } = await supabase.from('br_flavour_counts')
      .upsert(rows.map(r => ({ ...r, submitted_by_profile_id: user?.id, updated_at: new Date().toISOString() })),
        { onConflict: 'store_id,item_id,count_date,session' });
    setSaving(false);
    if (error) {
      showToast(/row-level security/i.test(error.message) ? 'This day is closed for changes. Ask your manager.' : 'Could not save: ' + error.message, 'error');
      return;
    }
    showToast(`${session === 'opening' ? 'Opening' : 'Closing'} weigh saved for ${rows.length} flavours`, 'success');
    load();
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login.</div>;

  const term = search.trim().toLowerCase();
  const shown = flavours.filter(f => !term || f.name.toLowerCase().includes(term));
  const ranges = Array.from(new Set(shown.map(f => f.item_categories.name)));
  const filled = flavours.filter(f => !boxEntryEmpty(cur[f.id] || EMPTY)).length;
  const total = flavours.reduce((t, f) => {
    const e = cur[f.id];
    if (!e || boxEntryEmpty(e)) return t;
    const r = boxNet(f, e);
    return t + (r.grams || 0);
  }, 0);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Ice Cream Weigh</h1>
          <p className={styles.subtitle}>Weigh <strong>every flavour</strong> at opening and again at closing.</p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <StockTabs />

      <div className={styles.tabs}>
        {(['opening', 'closing'] as Session[]).map(s => (
          <button key={s} className={`${styles.tab} ${session === s ? styles.active : ''}`} onClick={() => setSession(s)}>
            {s === 'opening' ? '🌅 Opening' : '🌙 Closing'} {saved[s].size >= flavours.length && flavours.length ? '✓' : `(${saved[s].size}/${flavours.length})`}
          </button>
        ))}
      </div>

      <div style={{ padding: '0.75rem 1rem', background: 'rgba(0,200,83,0.08)', border: '1px solid rgba(0,200,83,0.25)', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.88rem' }}>
        ⚡ <strong>Auto-save active:</strong> Each flavour automatically saves to the cloud as soon as you type or tap outside the box.
      </div>

      <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
        For each flavour: <strong>Box 1</strong> = how many <strong>packed (sealed) boxes</strong>. <strong>Box 2</strong> = put the <strong>open box</strong> on the scale and type
        exactly what it shows — <strong>with the box</strong>. The app takes off the {EMPTY_BOX_GRAMS} g box by itself (1 packed box = {FULL_BOX_GRAMS} g).
        No open box? Leave Box 2 blank. Nothing at all? Enter 0.
      </p>

      <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <select
          className={styles.select}
          value={staff}
          onChange={e => setStaff(e.target.value)}
          style={{ border: !staff ? '2px solid var(--warning)' : undefined }}
        >
          <option value="">⚠️ Select who is weighing (required for auto-save)</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input className={styles.input} style={{ flex: 1, minWidth: 180 }} placeholder="Search flavour…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {flavours.length === 0 && <p className={styles.statusText}>No flavours set up yet — ask your manager.</p>}

      <div className={styles.formContainer}>
        {ranges.map(rg => (
          <div key={rg} className={styles.categorySection}>
            <h2 className={styles.categoryHeader}>{rg}</h2>
            <div className={styles.itemGrid}>
              {shown.filter(f => f.item_categories.name === rg).map(f => {
                const b = cur[f.id] || EMPTY;
                const r = boxEntryEmpty(b) ? null : boxNet(f, b);
                const isItemSaved = saved[session].has(f.id);
                const isItemSaving = savingId === f.id;
                return (
                  <div key={f.id} className={styles.itemRow}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>
                        {f.name}
                        {isItemSaving ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--accent-primary)', marginLeft: '0.5rem' }}>saving…</span>
                        ) : isItemSaved ? (
                          <span style={{ fontSize: '0.75rem', color: 'var(--success)', marginLeft: '0.5rem' }}>✓ auto-saved</span>
                        ) : null}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', color: 'var(--text-secondary)', maxWidth: 130 }}>
                        Packed boxes
                        <input type="number" inputMode="numeric" min="0" step="1" className={styles.input}
                          value={b.unopened} placeholder="0" aria-label={`${f.name} packed boxes`}
                          onChange={e => setEntry(f, 'unopened', e.target.value)}
                          onBlur={() => autoSaveItem(f)} />
                      </label>
                      <label style={{ display: 'flex', flexDirection: 'column', fontSize: '0.75rem', color: 'var(--text-secondary)', flex: 1 }}>
                        Open box on scale (g, with box)
                        <input type="number" inputMode="decimal" min="0" className={styles.input}
                          value={b.openGross} placeholder="e.g. 1450" aria-label={`${f.name} open box weight with box`}
                          onChange={e => setEntry(f, 'openGross', e.target.value)}
                          onBlur={() => autoSaveItem(f)} />
                      </label>
                    </div>
                    <div style={{ fontSize: '0.85rem', color: r?.error ? 'var(--danger)' : 'var(--text-secondary)' }}>
                      {r?.error || (r ? `= ${grams(r.grams)}` : '')}
                      {session === 'opening' && lastNight[f.id] !== undefined && !r?.error ? `${r ? ' · ' : ''}last night ${grams(lastNight[f.id])}` : ''}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {flavours.length > 0 && (
        <div className={styles.submitArea}>
          <p className={styles.statusText}>{filled} of {flavours.length} flavours entered · total {grams(total)}</p>
          <button className={styles.button} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : `Save / Confirm ${session === 'opening' ? 'Opening' : 'Closing'} Weigh`}
          </button>
        </div>
      )}
      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
