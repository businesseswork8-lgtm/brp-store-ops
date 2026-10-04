'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from './flavours.module.css';

type Tier = { id: string; name: string; sort_order: number };
type Flavour = {
  id: string;
  code: string | null;
  name: string;
  sub_category: string | null;
  is_new: boolean;
  is_active: boolean;
  category_id: string;
};

const SUB_CATEGORIES = ['Fruits', 'Classics & Nuts', 'Chocolates'];
const BR_BRAND_ID = '22222222-2222-2222-2222-222222222222';
const EMPTY_TUB_GRAMS = 100;

export default function FlavoursPage() {
  const [supabase] = useState(() => createClient());
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [flavours, setFlavours] = useState<Flavour[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [showRemoved, setShowRemoved] = useState(false);
  const [form, setForm] = useState({ name: '', category_id: '', sub_category: SUB_CATEGORIES[0], is_new: true });
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  const notify = (text: string, ok = true) => {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [{ data: prof }, { data: tierRows }] = await Promise.all([
      supabase.from('profiles').select('role, can_edit').eq('id', user?.id || '').single(),
      supabase.from('item_categories').select('id, name, sort_order')
        .eq('brand_id', BR_BRAND_ID).eq('is_flavour', true).order('sort_order'),
    ]);
    const tierList = (tierRows || []) as Tier[];
    const { data: flavourRows } = tierList.length
      ? await supabase.from('items')
          .select('id, code, name, sub_category, is_new, is_active, category_id')
          .in('category_id', tierList.map(t => t.id))
          .order('name')
      : { data: [] };

    setCanEdit(prof?.role === 'super_admin' || (prof?.role === 'admin' && Boolean(prof?.can_edit)));
    setTiers(tierList);
    setFlavours((flavourRows || []) as Flavour[]);
    setForm(f => ({ ...f, category_id: f.category_id || tierList[0]?.id || '' }));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const nextCode = useMemo(() => {
    const max = flavours.reduce((m, f) => {
      const n = parseInt((f.code || '').replace(/\D/g, ''), 10);
      return isNaN(n) ? m : Math.max(m, n);
    }, 0);
    return `FLV-${String(max + 1).padStart(3, '0')}`;
  }, [flavours]);

  const addFlavour = async () => {
    const name = form.name.trim();
    if (!name || !form.category_id) { notify('Enter a flavour name and pick a range', false); return; }
    if (flavours.some(f => f.name.toLowerCase() === name.toLowerCase())) {
      notify('This flavour already exists — use "Bring back" if it was removed', false);
      return;
    }
    setSaving(true);
    const { error } = await supabase.from('items').insert({
      category_id: form.category_id,
      code: nextCode,
      name,
      sub_category: form.sub_category,
      is_new: form.is_new,
      uom: 'grams',
      purchase_unit_name: 'Tub',
      purchase_unit_qty: 1,
      is_daily_tracked: true,
      is_active: true,
      tare_grams: EMPTY_TUB_GRAMS,
    });
    setSaving(false);
    if (error) { notify('Could not add: ' + error.message, false); return; }
    setForm(f => ({ ...f, name: '' }));
    notify(`${name} added`);
    load();
  };

  const setActive = async (f: Flavour, active: boolean) => {
    if (!active && !confirm(`Remove "${f.name}"? Staff will no longer see it in Stock Count. Past records are kept.`)) return;
    const { error } = await supabase.from('items').update({ is_active: active }).eq('id', f.id);
    if (error) { notify('Could not update: ' + error.message, false); return; }
    notify(active ? `${f.name} is back` : `${f.name} removed`);
    load();
  };

  const toggleNew = async (f: Flavour) => {
    const { error } = await supabase.from('items').update({ is_new: !f.is_new }).eq('id', f.id);
    if (error) notify('Could not update: ' + error.message, false);
    else load();
  };

  if (loading) return <div className={styles.container}>Loading flavours…</div>;

  const term = search.trim().toLowerCase();
  const visible = flavours.filter(f =>
    (showRemoved || f.is_active) && (!term || f.name.toLowerCase().includes(term) || (f.code || '').toLowerCase().includes(term)));
  const activeCount = flavours.filter(f => f.is_active).length;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Ice Cream Flavours</h1>
          <p className={styles.subtitle}>
            {activeCount} flavours in Baskin Robbins Stock Count. Staff weigh tubs; {EMPTY_TUB_GRAMS} g per empty tub is subtracted automatically.
          </p>
        </div>
      </div>

      {!canEdit && (
        <div className={styles.notice}>View only. Ask the Super Admin to switch on “Allowed to edit” to add or remove flavours.</div>
      )}

      {canEdit && (
        <div className={styles.card}>
          <h2 className={styles.tierTitle}>Add a flavour <span className={styles.count}>Code {nextCode}</span></h2>
          <div className={styles.formGrid}>
            <label className={styles.field}>
              Flavour name
              <input value={form.name} placeholder="e.g. Belgian Bliss"
                onChange={e => setForm({ ...form, name: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') addFlavour(); }} />
            </label>
            <label className={styles.field}>
              Range
              <select value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                {tiers.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Type
              <select value={form.sub_category} onChange={e => setForm({ ...form, sub_category: e.target.value })}>
                {SUB_CATEGORIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={`${styles.field} ${styles.check}`}>
              <input type="checkbox" checked={form.is_new} onChange={e => setForm({ ...form, is_new: e.target.checked })} />
              New launch
            </label>
            <button className={styles.primary} onClick={addFlavour} disabled={saving}>
              {saving ? 'Adding…' : '+ Add flavour'}
            </button>
          </div>
        </div>
      )}

      <div className={styles.toolbar}>
        <input className={styles.search} placeholder="Search flavour or code…" value={search} onChange={e => setSearch(e.target.value)} />
        <label className={`${styles.field} ${styles.check}`} style={{ paddingBottom: 0 }}>
          <input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} />
          Show removed
        </label>
      </div>

      {tiers.map(tier => {
        const list = visible.filter(f => f.category_id === tier.id);
        if (!list.length) return null;
        return (
          <div key={tier.id} className={styles.card}>
            <h2 className={styles.tierTitle}>
              {tier.name} <span className={styles.count}>{list.filter(f => f.is_active).length} active</span>
            </h2>
            {list.map(f => (
              <div key={f.id} className={`${styles.row} ${f.is_active ? '' : styles.off}`}>
                <span className={styles.name}>
                  {f.name}
                  {f.is_new && <span className={styles.newTag}>New</span>}
                  {!f.is_active && <span className={styles.count}> (removed)</span>}
                </span>
                <span className={styles.meta}>{f.sub_category || '—'}</span>
                <span className={styles.meta}>{f.code || ''}</span>
                {canEdit && (
                  <>
                    <button className={styles.secondary} onClick={() => toggleNew(f)}>
                      {f.is_new ? 'Unmark new' : 'Mark new'}
                    </button>
                    {f.is_active
                      ? <button className={styles.danger} onClick={() => setActive(f, false)}>Remove</button>
                      : <button className={styles.secondary} onClick={() => setActive(f, true)}>Bring back</button>}
                  </>
                )}
              </div>
            ))}
          </div>
        );
      })}

      {toast && <div className={`${styles.toast} ${toast.ok ? styles.ok : styles.err}`}>{toast.text}</div>}
    </div>
  );
}
