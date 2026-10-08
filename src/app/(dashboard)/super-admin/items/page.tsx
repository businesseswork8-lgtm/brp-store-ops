'use client';

import React, { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { istDate } from '@/lib/dates';
import { Frequency, FREQUENCY_LABEL } from '@/lib/stock/schedule';
import { displayUnit, fromDisplay, groupForRistaCategory, uomForRistaUnit } from '@/lib/stock/units';
import { parseConsumption, ConsumptionLine } from '@/lib/stock/rista-consumption';
import { isMonthEndAudit, parseMonthEndAudit } from '@/lib/stock/audit-files';

type Material = { sku: string; name: string; type: string | null; category: string | null; sub_category: string | null;
  unit: string | null; rate: number | null; is_critical: boolean; stock_group: string | null };
import styles from '../super-admin.module.css';
import { FlavoursContent } from '../flavours/page';
import { BR_BRAND_ID } from '@/lib/br';

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
  return (
    <Suspense fallback={<div style={{ padding: '2rem', textAlign: 'center' }}>Loading…</div>}>
      <ItemsPageInner />
    </Suspense>
  );
}

function ItemsPageInner() {
  const searchParams = useSearchParams();
  const brandParam = searchParams.get('brand');
  const tabParam = (searchParams.get('tab') as 'sizes' | 'flavours' | 'matching' | null) || undefined;

  const [supabase] = useState(() => createClient());
  const [brands, setBrands] = useState<Brand[]>([]);
  const [brandId, setBrandId] = useState(() => brandParam === 'br' ? BR_BRAND_ID : '');
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
  const [master, setMaster] = useState<Material[]>([]);
  const [ristaSearch, setRistaSearch] = useState('');
  const [pickSku, setPickSku] = useState('');
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
    setBrandId(prev => {
      if (brandParam === 'br') return BR_BRAND_ID;
      return prev || b?.[0]?.id || '';
    });
    setCategories((c || []) as Category[]);
    setStores((s || []) as Store[]);
    setItems(((i || []) as Item[]).map(x => ({ ...x, tare_grams: Number(x.tare_grams) || 0 })));
    setLoading(false);
  }, [supabase, brandParam]);

  useEffect(() => { load(); }, [load]);

  const loadMaster = useCallback(async () => {
    if (!brandId) return;
    const { data } = await supabase.from('rista_materials')
      .select('sku, name, type, category, sub_category, unit, rate, is_critical, stock_group')
      .eq('brand_id', brandId).order('name').limit(2000);
    setMaster((data || []) as Material[]);
  }, [supabase, brandId]);
  useEffect(() => { loadMaster(); }, [loadMaster]);

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
    if (master.length && form.rista_sku.trim() && !master.some(m => m.sku === form.rista_sku.trim())
      && !confirm(`SKU ${form.rista_sku} is not in the Rista list. Add it anyway?`)) return;
    if (master.length && !form.rista_sku.trim() && !confirm('This item has no Rista SKU, so its usage can\'t be checked. Add it anyway?')) return;
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
    setPickSku('');
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
    if (sku && master.length && !master.some(m => m.sku === sku) && !confirm(`SKU ${sku} is not in the Rista list. Save anyway?`)) return;
    const ok = await update(i.id, {
      name: edit.name.trim() || i.name, rista_sku: sku, rate: edit.rate ? Number(edit.rate) : null,
      category_id: edit.category_id, stock_group: groupOf(catName(edit.category_id)),
    });
    if (ok) setEditing(null);
  };

  // ---- Pick from the complete Rista list ----
  const openRistaList = () => {
    const linked = new Set(brandItems.map(i => i.rista_sku).filter(Boolean));
    setRistaSearch('');
    setRistaLines(master
      .filter(m => !linked.has(m.sku) && !/asset/i.test(m.category || ''))
      .map(m => {
        // Same name, or one name inside the other (e.g. "Mango" ↔ "Mango Ice Cream Bulk")
        const n = norm(m.name);
        const same = brandItems.find(i => !i.rista_sku && norm(i.name) === n)
          || brandItems.find(i => !i.rista_sku && norm(i.name).length >= 4 && (n.includes(norm(i.name)) || norm(i.name).includes(n)));
        return {
          sku: m.sku, name: m.name, type: m.type || '', category: m.category || '', sub_category: m.sub_category || '',
          unit: m.unit || 'Nos', ideal_qty: 0, rate: m.rate,
          pick: false, freq: (m.is_critical ? 'daily' : 'monthly') as Frequency, linkTo: same?.id || '',
        };
      }));
  };

  /** Refresh the Rista list from a Consumption Variance or month-end audit file (adds new SKUs, updates names and rates). */
  const updateRistaList = async (f: File) => {
    const buf = await f.arrayBuffer();
    const head = new TextDecoder().decode(buf.slice(0, 400));
    const rows = isMonthEndAudit(head)
      ? parseMonthEndAudit(buf).lines.map(l => ({ sku: l.sku, name: l.name, type: l.type, category: l.category, sub_category: l.sub_category,
          unit: l.unit, perishable: l.perishable, stock_group: l.stock_group }))
      : parseConsumption(buf, f.name).lines.map(l => ({ sku: l.sku, name: l.name, type: l.type, category: l.category, sub_category: l.sub_category,
          unit: l.unit, rate: l.rate, stock_group: groupForRistaCategory(l.category, l.sub_category) }));
    if (!rows.length) { alert('No items found. Use a Rista "Consumption Variance" or month-end audit file.'); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc('refresh_rista_materials', { p_brand: brandId, p_rows: rows });
    setBusy(false);
    if (error) { alert('Could not update: ' + error.message); return; }
    alert(`Rista list updated: ${data} items. Rates of linked items were updated too.`);
    loadMaster();
    load();
  };

  /** Fill the add form from a Rista list entry. */
  const pickMaterial = (sku: string) => {
    setPickSku(sku);
    const m = master.find(x => x.sku === sku);
    if (!m) return;
    const group = m.stock_group || groupForRistaCategory(m.category || '', m.sub_category || '');
    setForm(f => ({
      ...f, name: m.name, rista_sku: m.sku, rista_unit: m.unit && RISTA_UNITS.includes(m.unit) ? m.unit : (/kg|g/i.test(m.unit || '') ? 'kg' : 'Nos'),
      rate: m.rate?.toString() || '', category_id: categoryForGroup(group) || f.category_id,
      count_frequency: m.is_critical ? 'daily' : f.count_frequency,
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
        rista_sku: l.sku, rista_unit: l.unit, rate: l.rate, count_frequency: l.freq, name: l.name, is_active: true,
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

  const isBRSelected = brandId === BR_BRAND_ID || /baskin/i.test(brands.find(b => b.id === brandId)?.name || '');

  return (
    <div className={styles.container}>
      {/* Brand Switcher */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '1rem' }}>
        {brands.map(b => {
          const isSelected = b.id === brandId;
          const isBR = b.id === BR_BRAND_ID || /baskin/i.test(b.name);
          return (
            <button
              key={b.id}
              className={isSelected ? styles.primaryButton : styles.secondaryButton}
              style={{
                padding: '0.65rem 1.35rem',
                fontSize: '1.05rem',
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                borderRadius: '8px',
                cursor: 'pointer'
              }}
              onClick={() => setBrandId(b.id)}
            >
              {isBR ? '🍨 Baskin Robbins Ice Cream' : '🥞 99 Pancakes Items'}
            </button>
          );
        })}
      </div>

      {isBRSelected ? (
        <FlavoursContent initialTab={tabParam} />
      ) : (
        <>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>99 Pancakes Items</h1>
          <p className={styles.subtitle}>What each 99 Pancakes store counts, how often, and its Rista code and rate for the stock report.</p>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <label className={styles.secondaryButton} title="Upload a Rista Consumption Variance or month-end audit file to add new SKUs and update rates">
              🔄 Update Rista list
              <input type="file" accept=".csv,.xlsx" style={{ display: 'none' }}
                onChange={e => { if (e.target.files?.[0]) updateRistaList(e.target.files[0]); e.target.value = ''; }} />
            </label>
            <button className={styles.secondaryButton} onClick={openRistaList} disabled={!master.length}>📚 Add from Rista list ({master.length})</button>
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
          {master.length > 0 && (
            <div className={styles.fieldGroup} style={{ marginBottom: '1rem' }}>
              <label>Pick from the Rista list (fills everything in — no typing mistakes)</label>
              <input className={styles.input} list="rista-materials" placeholder="Type a name or SKU…" value={pickSku}
                onChange={e => { const v = e.target.value; const m = master.find(x => x.sku === v || `${x.name} (${x.sku})` === v); if (m) pickMaterial(m.sku); else setPickSku(v); }} />
              <datalist id="rista-materials">
                {master.filter(m => !brandItems.some(i => i.rista_sku === m.sku)).map(m => (
                  <option key={m.sku} value={`${m.name} (${m.sku})`} />
                ))}
              </datalist>
            </div>
          )}
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
            <h3 style={{ margin: 0 }}>Rista list: {ristaLines.length} items not tracked yet</h3>
            <input className={styles.searchInput} style={{ minWidth: 200 }} placeholder="Search…" value={ristaSearch} onChange={e => setRistaSearch(e.target.value)} />
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className={styles.secondaryButton} onClick={() => setRistaLines(null)}>Cancel</button>
              <button className={styles.primaryButton} onClick={importPicked} disabled={busy}>{busy ? 'Saving…' : `Add ${ristaLines.filter(l => l.pick).length} ticked`}</button>
            </div>
          </div>
          <p className={styles.subtitle}>Tick what you want to track. Items on the company audit&apos;s critical list are set to Daily. Where an app item has the same name, it gets linked instead of added twice.</p>
          <div style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead><tr><th></th><th>Rista item</th><th>SKU</th><th>Unit</th><th>Rate ₹</th><th>Group</th><th>Count</th><th>Link to existing</th></tr></thead>
              <tbody>
                {ristaLines.map((l, idx) => (!ristaSearch.trim() || `${l.name} ${l.sku}`.toLowerCase().includes(ristaSearch.toLowerCase())) && (
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
      </>
      )}
    </div>
  );
}
