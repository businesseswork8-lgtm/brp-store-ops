'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { istDate } from '@/lib/dates';
import { Frequency, FREQUENCY_LABEL } from '@/lib/stock/schedule';
import { displayUnit, fromDisplay, groupForRistaCategory, uomForRistaUnit } from '@/lib/stock/units';
import { parseConsumption, ConsumptionLine } from '@/lib/stock/rista-consumption';
import styles from '../super-admin.module.css';

type Brand = { id: string; name: string };
type Category = { id: string; name: string; brand_id: string; is_flavour: boolean };
type Store = { id: string; name: string; brand_id: string };
type Item = {
  id: string; name: string; category_id: string; uom: string; is_active: boolean; tare_grams: number;
  rista_sku: string | null; rista_unit: string | null; rate: number | null; count_frequency: Frequency;
  stock_group: string | null;
};

const FREQS: Frequency[] = ['daily', 'fortnightly', 'monthly', 'none'];
const RISTA_UNITS = ['kg', 'Nos', 'lt'];
const norm = (s: string) => s.toLowerCase().replace(/\(.*?\)|\[.*?\]/g, '').replace(/[^a-z0-9]/g, '');

/** Audit group from the category name. */
function groupOf(categoryName: string): string {
  const n = categoryName.toLowerCase();
  if (n.includes('packaging')) return 'Packaging';
  if (n.includes('cake') || n.includes('pastr')) return 'Cakes & Pastries';
  if (n.includes('misc')) return 'Other';
  return 'Raw Material';
}

const blankForm = { name: '', category_id: '', rista_sku: '', rista_unit: 'kg', rate: '', count_frequency: 'daily' as Frequency };

export default function ItemsPage() {
  const [supabase] = useState(() => createClient());
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState('');
  const [categories, setCategories] = useState<Category[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [freqFilter, setFreqFilter] = useState<'all' | Frequency>('all');
  const [showRemoved, setShowRemoved] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [starting, setStarting] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; rista_sku: string; rate: string; category_id: string }>({ name: '', rista_sku: '', rate: '', category_id: '' });
  const [ristaLines, setRistaLines] = useState<(ConsumptionLine & { pick: boolean; freq: Frequency; linkTo: string })[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    const [{ data: prof }, { data: b }, { data: c }, { data: s }, { data: i }] = await Promise.all([
      supabase.from('profiles').select('role, can_edit').eq('id', user?.id || '').maybeSingle(),
      supabase.from('brands').select('id, name').order('name'),
      supabase.from('item_categories').select('id, name, brand_id, is_flavour').order('sort_order'),
      supabase.from('stores').select('id, name, brand_id').eq('is_active', true).order('name'),
      supabase.from('items').select('id, name, category_id, uom, is_active, tare_grams, rista_sku, rista_unit, rate, count_frequency, stock_group').order('name'),
    ]);
    setCanEdit(prof?.role === 'super_admin' || (prof?.role === 'admin' && Boolean(prof?.can_edit)));
    setBrands(b || []);
    setBrandId(prev => prev || b?.[0]?.id || '');
    setCategories((c || []) as Category[]);
    setStores((s || []) as Store[]);
    setItems(((i || []) as Item[]).map(x => ({ ...x, tare_grams: Number(x.tare_grams) || 0 })));
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  const brandCats = useMemo(() => categories.filter(c => c.brand_id === brandId && !c.is_flavour), [categories, brandId]);
  const brandCatIds = useMemo(() => new Set(categories.filter(c => c.brand_id === brandId).map(c => c.id)), [categories, brandId]);
  const brandStores = stores.filter(s => s.brand_id === brandId);
  const brandItems = items.filter(i => brandCatIds.has(i.category_id));
  const catName = (id: string) => categories.find(c => c.id === id)?.name || '';

  const visible = brandItems.filter(i =>
    (showRemoved || i.is_active) &&
    (freqFilter === 'all' || i.count_frequency === freqFilter) &&
    (!search.trim() || i.name.toLowerCase().includes(search.toLowerCase()) || (i.rista_sku || '').includes(search.trim())));

  const update = async (id: string, patch: Partial<Item>) => {
    const { error } = await supabase.from('items').update(patch).eq('id', id);
    if (error) { alert('Could not save: ' + error.message); return false; }
    setItems(list => list.map(x => (x.id === id ? { ...x, ...patch } : x)));
    return true;
  };

  /** Save starting stock as today's count for each store that has a number. */
  const saveStarting = async (itemId: string, ristaUnit: string, uom: string, perStore: Record<string, string>) => {
    const { data: { user } } = await supabase.auth.getUser();
    const rows = Object.entries(perStore).filter(([, v]) => v.trim() !== '').map(([storeId, v]) => ({
      store_id: storeId, item_id: itemId, count_date: istDate(), kind: 'starting',
      quantity: fromDisplay(Number(v), ristaUnit, uom), submitted_by_profile_id: user?.id,
    }));
    if (!rows.length) return null;
    const { error } = await supabase.from('stock_counts').upsert(rows, { onConflict: 'store_id,item_id,count_date' });
    return error;
  };

  const addItem = async () => {
    const name = form.name.trim();
    if (!name || !form.category_id) { alert('Enter a name and pick a group'); return; }
    if (brandItems.some(i => i.name.toLowerCase() === name.toLowerCase())) { alert('An item with this name already exists'); return; }
    if (form.rista_sku && brandItems.some(i => i.rista_sku === form.rista_sku.trim())) { alert('Another item already uses this Rista SKU'); return; }
    const bad = Object.values(starting).find(v => v.trim() !== '' && (isNaN(Number(v)) || Number(v) < 0));
    if (bad !== undefined) { alert('Check the starting stock numbers'); return; }
    setBusy(true);
    const uom = uomForRistaUnit(form.rista_unit);
    const { data, error } = await supabase.from('items').insert({
      name, category_id: form.category_id, uom, purchase_unit_name: form.rista_unit, purchase_unit_qty: 1,
      is_daily_tracked: false, is_active: true,
      rista_sku: form.rista_sku.trim() || null, rista_unit: form.rista_unit,
      rate: form.rate ? Number(form.rate) : null, count_frequency: form.count_frequency,
      stock_group: groupOf(catName(form.category_id)),
    }).select('id').single();
    if (error || !data) { setBusy(false); alert('Could not add item: ' + error?.message); return; }
    const sErr = await saveStarting(data.id, form.rista_unit, uom, starting);
    setBusy(false);
    if (sErr) alert('Item added, but starting stock failed: ' + sErr.message);
    setForm({ ...blankForm, category_id: form.category_id });
    setStarting({});
    setAdding(false);
    load();
  };

  const startEdit = (i: Item) => {
    setEditing(i.id);
    setEdit({ name: i.name, rista_sku: i.rista_sku || '', rate: i.rate?.toString() || '', category_id: i.category_id });
  };
  const saveEdit = async (i: Item) => {
    const sku = edit.rista_sku.trim() || null;
    if (sku && brandItems.some(x => x.id !== i.id && x.rista_sku === sku)) { alert('Another item already uses this Rista SKU'); return; }
    const ok = await update(i.id, {
      name: edit.name.trim() || i.name, rista_sku: sku, rate: edit.rate ? Number(edit.rate) : null,
      category_id: edit.category_id, stock_group: groupOf(catName(edit.category_id)),
    });
    if (ok) setEditing(null);
  };

  // ---- Import from a Rista Consumption Variance file ----
  const readRista = async (f: File) => {
    const parsed = parseConsumption(await f.arrayBuffer(), f.name);
    if (parsed.warnings.length) { alert(parsed.warnings.join('\n')); return; }
    const linked = new Set(brandItems.map(i => i.rista_sku).filter(Boolean));
    setRistaLines(parsed.lines
      .filter(l => !linked.has(l.sku) && !/asset/i.test(l.category))
      .map(l => {
        // Same name, or one name inside the other (e.g. "Mango" ↔ "Mango Ice Cream Bulk")
        const n = norm(l.name);
        const same = brandItems.find(i => !i.rista_sku && norm(i.name) === n)
          || brandItems.find(i => !i.rista_sku && norm(i.name).length >= 4 && (n.includes(norm(i.name)) || norm(i.name).includes(n)));
        return { ...l, pick: false, freq: 'monthly' as Frequency, linkTo: same?.id || '' };
      }));
  };

  const categoryForGroup = (group: string) => {
    const want = group === 'Raw Material' ? ['other raw material', 'raw material'] : [group.toLowerCase(), group === 'Other' ? 'miscellaneous' : ''];
    return brandCats.find(c => want.includes(c.name.toLowerCase()))?.id
      || brandCats.find(c => c.name.toLowerCase().includes(group.toLowerCase().split(' ')[0]))?.id
      || brandCats[0]?.id;
  };

  const importPicked = async () => {
    if (!ristaLines) return;
    const picked = ristaLines.filter(l => l.pick);
    if (!picked.length) { alert('Tick the items to add'); return; }
    setBusy(true);
    // 1. Link existing items
    for (const l of picked.filter(l => l.linkTo)) {
      const { error } = await supabase.from('items').update({
        rista_sku: l.sku, rista_unit: l.unit, rate: l.rate, count_frequency: l.freq,
        stock_group: groupForRistaCategory(l.category, l.sub_category),
      }).eq('id', l.linkTo);
      if (error) { setBusy(false); alert(`Could not link ${l.name}: ${error.message}`); return; }
    }
    // 2. Add new items
    const fresh = picked.filter(l => !l.linkTo).map(l => {
      const group = groupForRistaCategory(l.category, l.sub_category);
      return {
        name: l.name, category_id: categoryForGroup(group), uom: uomForRistaUnit(l.unit),
        purchase_unit_name: l.unit || 'Nos', purchase_unit_qty: 1, is_daily_tracked: false, is_active: true,
        rista_sku: l.sku, rista_unit: l.unit, rate: l.rate, count_frequency: l.freq, stock_group: group,
      };
    });
    if (fresh.length) {
      const { error } = await supabase.from('items').insert(fresh);
      if (error) { setBusy(false); alert('Could not add items: ' + error.message); return; }
    }
    setBusy(false);
    setRistaLines(null);
    alert(`${picked.length} item(s) added / linked. Enter their starting stock with "Starting stock" on each item, or do a Full count in Stock Count.`);
    load();
  };

  // ---- Starting stock for an existing item ----
  const [startFor, setStartFor] = useState<Item | null>(null);
  const [startVals, setStartVals] = useState<Record<string, string>>({});
  const saveStartFor = async () => {
    if (!startFor) return;
    setBusy(true);
    const err = await saveStarting(startFor.id, startFor.rista_unit || 'Nos', startFor.uom, startVals);
    setBusy(false);
    if (err) { alert('Could not save: ' + err.message); return; }
    setStartFor(null);
    setStartVals({});
    alert('Starting stock saved for today.');
  };

  if (loading) return <div className={styles.loading}>Loading items…</div>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Items</h1>
          <p className={styles.subtitle}>What each store counts, how often, and its Rista code and rate for the stock report.
            {' '}<Link href="/super-admin/flavours">🍨 Ice cream flavours &amp; box weights →</Link></p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label className={styles.secondaryButton}>
              📄 Add from Rista file
              <input type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) readRista(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <button className={styles.primaryButton} onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add item'}</button>
          </div>
        )}
      </div>

      {!canEdit && <div className={styles.card} style={{ marginBottom: '1rem' }}>View only. Ask the Super Admin to switch on &quot;Allowed to edit&quot;.</div>}

      <div className={styles.filterBar} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select className={styles.selectFilter} value={brandId} onChange={e => setBrandId(e.target.value)}>
          {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select className={styles.selectFilter} value={freqFilter} onChange={e => setFreqFilter(e.target.value as 'all' | Frequency)}>
          <option value="all">All schedules</option>
          {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
        </select>
        <input className={styles.searchInput} style={{ flex: 1, minWidth: 180 }} placeholder="Search name or SKU…" value={search} onChange={e => setSearch(e.target.value)} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={showRemoved} onChange={e => setShowRemoved(e.target.checked)} /> Show removed
        </label>
      </div>

      {adding && (
        <div className={styles.card} style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Add item</h3>
          <div className={styles.formGrid}>
            <div className={styles.fieldGroup}><label>Name *</label>
              <input className={styles.input} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="e.g. Nutella" /></div>
            <div className={styles.fieldGroup}><label>Group *</label>
              <select className={styles.selectFilter} value={form.category_id} onChange={e => setForm({ ...form, category_id: e.target.value })}>
                <option value="">Select…</option>
                {brandCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
            <div className={styles.fieldGroup}><label>Unit (as in Rista)</label>
              <select className={styles.selectFilter} value={form.rista_unit} onChange={e => setForm({ ...form, rista_unit: e.target.value })}>
                {RISTA_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
              </select></div>
            <div className={styles.fieldGroup}><label>Rista SKU</label>
              <input className={styles.input} value={form.rista_sku} onChange={e => setForm({ ...form, rista_sku: e.target.value })} placeholder="e.g. 123" /></div>
            <div className={styles.fieldGroup}><label>Rate ₹ per {form.rista_unit}</label>
              <input className={styles.input} type="number" min="0" value={form.rate} onChange={e => setForm({ ...form, rate: e.target.value })} /></div>
            <div className={styles.fieldGroup}><label>Count</label>
              <select className={styles.selectFilter} value={form.count_frequency} onChange={e => setForm({ ...form, count_frequency: e.target.value as Frequency })}>
                {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
              </select></div>
          </div>
          <h4>Stock on hand right now ({form.rista_unit})</h4>
          <p className={styles.subtitle} style={{ marginBottom: '0.75rem' }}>This becomes the starting count for today, so everything balances from here.</p>
          <div className={styles.formGrid}>
            {brandStores.map(s => (
              <div key={s.id} className={styles.fieldGroup}><label>{s.name}</label>
                <input className={styles.input} type="number" min="0" placeholder="leave blank if not stocked"
                  value={starting[s.id] ?? ''} onChange={e => setStarting({ ...starting, [s.id]: e.target.value })} /></div>
            ))}
          </div>
          <button className={styles.primaryButton} style={{ marginTop: '1rem' }} onClick={addItem} disabled={busy}>{busy ? 'Saving…' : 'Add item'}</button>
        </div>
      )}

      {ristaLines && (
        <div className={styles.card} style={{ marginBottom: '1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
            <h3 style={{ margin: 0 }}>From the Rista file: {ristaLines.length} items not in the app yet</h3>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={styles.secondaryButton} onClick={() => setRistaLines(null)}>Cancel</button>
              <button className={styles.primaryButton} onClick={importPicked} disabled={busy}>{busy ? 'Saving…' : `Add ${ristaLines.filter(l => l.pick).length} ticked`}</button>
            </div>
          </div>
          <p className={styles.subtitle}>Tick what you want to track. Where an app item has the same name, it gets linked instead of added twice.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead><tr><th></th><th>Rista item</th><th>SKU</th><th>Unit</th><th>Rate ₹</th><th>Group</th><th>Count</th><th>Link to existing</th></tr></thead>
              <tbody>
                {ristaLines.map((l, idx) => (
                  <tr key={l.sku}>
                    <td><input type="checkbox" checked={l.pick} onChange={e => setRistaLines(ls => ls!.map((x, j) => j === idx ? { ...x, pick: e.target.checked } : x))} /></td>
                    <td>{l.name}</td><td>{l.sku}</td><td>{l.unit}</td><td>{l.rate ?? '—'}</td>
                    <td>{groupForRistaCategory(l.category, l.sub_category)}</td>
                    <td>
                      <select className={styles.selectFilter} value={l.freq} onChange={e => setRistaLines(ls => ls!.map((x, j) => j === idx ? { ...x, freq: e.target.value as Frequency } : x))}>
                        {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className={styles.selectFilter} value={l.linkTo} onChange={e => setRistaLines(ls => ls!.map((x, j) => j === idx ? { ...x, linkTo: e.target.value } : x))}>
                        <option value="">— add as new —</option>
                        {brandItems.filter(i => !i.rista_sku && i.is_active).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {startFor && (
        <div className={styles.card} style={{ marginBottom: '1rem' }}>
          <h3 style={{ marginTop: 0 }}>Starting stock — {startFor.name} ({displayUnit(startFor.rista_unit, startFor.uom)})</h3>
          <div className={styles.formGrid}>
            {brandStores.map(s => (
              <div key={s.id} className={styles.fieldGroup}><label>{s.name}</label>
                <input className={styles.input} type="number" min="0" value={startVals[s.id] ?? ''}
                  onChange={e => setStartVals({ ...startVals, [s.id]: e.target.value })} /></div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', marginTop: '1rem' }}>
            <button className={styles.secondaryButton} onClick={() => setStartFor(null)}>Cancel</button>
            <button className={styles.primaryButton} onClick={saveStartFor} disabled={busy}>Save for today</button>
          </div>
        </div>
      )}

      <div className={styles.card} style={{ overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead><tr><th>Item</th><th>Group</th><th>Unit</th><th>Rista SKU</th><th>Rate ₹</th><th>Count</th><th></th></tr></thead>
          <tbody>
            {visible.length === 0 && <tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>No items.</td></tr>}
            {visible.map(i => editing === i.id ? (
              <tr key={i.id}>
                <td><input className={styles.input} value={edit.name} onChange={e => setEdit({ ...edit, name: e.target.value })} /></td>
                <td><select className={styles.selectFilter} value={edit.category_id} onChange={e => setEdit({ ...edit, category_id: e.target.value })}>
                  {brandCats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></td>
                <td>{displayUnit(i.rista_unit, i.uom)}</td>
                <td><input className={styles.input} style={{ width: 110 }} value={edit.rista_sku} onChange={e => setEdit({ ...edit, rista_sku: e.target.value })} /></td>
                <td><input className={styles.input} style={{ width: 90 }} type="number" value={edit.rate} onChange={e => setEdit({ ...edit, rate: e.target.value })} /></td>
                <td>{FREQUENCY_LABEL[i.count_frequency]}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className={styles.primaryButton} onClick={() => saveEdit(i)}>Save</button>{' '}
                  <button className={styles.secondaryButton} onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={i.id} style={{ opacity: i.is_active ? 1 : 0.5 }}>
                <td style={{ fontWeight: 600 }}>{i.name}{!i.is_active && ' (removed)'}</td>
                <td>{i.stock_group || catName(i.category_id)}</td>
                <td>{displayUnit(i.rista_unit, i.uom)}</td>
                <td>{i.rista_sku || <span style={{ color: 'var(--warning)' }}>not linked</span>}</td>
                <td>{i.rate ?? '—'}</td>
                <td>
                  {canEdit ? (
                    <select className={styles.selectFilter} value={i.count_frequency} onChange={e => update(i.id, { count_frequency: e.target.value as Frequency })}>
                      {FREQS.map(f => <option key={f} value={f}>{FREQUENCY_LABEL[f]}</option>)}
                    </select>
                  ) : FREQUENCY_LABEL[i.count_frequency]}
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {canEdit && (
                    <>
                      <button className={styles.secondaryButton} onClick={() => startEdit(i)}>Edit</button>{' '}
                      <button className={styles.secondaryButton} onClick={() => { setStartFor(i); setStartVals({}); }}>Starting stock</button>{' '}
                      {i.is_active
                        ? <button className={styles.secondaryButton} style={{ color: 'var(--danger)' }}
                            onClick={() => confirm(`Remove ${i.name}? Past records are kept.`) && update(i.id, { is_active: false })}>Remove</button>
                        : <button className={styles.secondaryButton} onClick={() => update(i.id, { is_active: true })}>Bring back</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
