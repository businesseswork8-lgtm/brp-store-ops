'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { istDate, addDays } from '@/lib/dates';
import { BR_BRAND_ID, BRSalesLine } from '@/lib/br';
import styles from './flavours.module.css';

type Size = {
  id: string; name: string; grams_ice_cream: number; grams_gelato: number;
  match_words: string; sort_order: number; is_active: boolean;
};
type Store = { id: string; name: string };
type Props = { canEdit: boolean; flavours: { id: string; name: string }[] };

const td: React.CSSProperties = { padding: '0.4rem 0.5rem', borderBottom: '1px solid var(--border-color, rgba(255,255,255,0.08))', verticalAlign: 'middle' };
const num: React.CSSProperties = { width: 80, minWidth: 0, flex: 'none' };

/** Serving sizes (grams, editable) and Rista sales line → flavour + size matching. */
export function BRSettings({ canEdit, flavours }: Props) {
  const [supabase] = useState(() => createClient());
  const [sizes, setSizes] = useState<Size[]>([]);
  const [edits, setEdits] = useState<Record<string, Partial<Record<keyof Size, string>>>>({});
  const [newSize, setNewSize] = useState({ name: '', ic: '', gel: '' });
  const [stores, setStores] = useState<Store[]>([]);
  const [storeId, setStoreId] = useState('');
  const [lines, setLines] = useState<BRSalesLine[]>([]);
  const [linesErr, setLinesErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [pick, setPick] = useState<Record<string, { item: string; size: string }>>({});
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);

  const notify = (text: string, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg(null), 3500); };

  const loadSizes = useCallback(async () => {
    const { data } = await supabase.from('br_serving_sizes').select('*').eq('brand_id', BR_BRAND_ID).order('sort_order').order('name');
    setSizes(((data || []) as Size[]).map(z => ({ ...z, grams_ice_cream: Number(z.grams_ice_cream), grams_gelato: Number(z.grams_gelato) })));
  }, [supabase]);

  const loadLines = useCallback(async () => {
    if (!storeId) return;
    const today = istDate();
    const { data, error } = await supabase.rpc('br_sales_lines', { p_store_id: storeId, p_from: addDays(today, -45), p_to: today });
    setLinesErr(error ? error.message : null);
    setLines(((data || []) as BRSalesLine[]).map(l => ({ ...l, quantity: Number(l.quantity), grams: Number(l.grams) })));
  }, [supabase, storeId]);

  useEffect(() => {
    loadSizes();
    supabase.from('stores').select('id, name').eq('brand_id', BR_BRAND_ID).eq('is_active', true).order('name')
      .then(({ data }) => { setStores(data || []); setStoreId(s => s || data?.[0]?.id || ''); });
  }, [supabase, loadSizes]);

  useEffect(() => { loadLines(); }, [loadLines]);

  // ---------- serving sizes ----------
  const val = (z: Size, k: keyof Size) => edits[z.id]?.[k] ?? String(z[k] ?? '');
  const setVal = (z: Size, k: keyof Size, v: string) => setEdits(e => ({ ...e, [z.id]: { ...e[z.id], [k]: v } }));

  const saveSize = async (z: Size) => {
    const e = edits[z.id];
    if (!e) return;
    const ic = Number(val(z, 'grams_ice_cream')), gel = Number(val(z, 'grams_gelato'));
    if (!(ic >= 0) || !(gel >= 0) || isNaN(ic) || isNaN(gel)) { notify('Grams must be 0 or more', false); return; }
    const name = val(z, 'name').trim();
    if (!name) { notify('Size needs a name', false); return; }
    const { error } = await supabase.from('br_serving_sizes').update({
      name, grams_ice_cream: ic, grams_gelato: gel, match_words: val(z, 'match_words'), updated_at: new Date().toISOString(),
    }).eq('id', z.id);
    if (error) { notify('Could not save: ' + error.message, false); return; }
    setEdits(x => { const n = { ...x }; delete n[z.id]; return n; });
    notify(`${name} saved`);
    loadSizes(); loadLines();
  };

  const toggleSize = async (z: Size) => {
    if (z.is_active && !confirm(`Switch off "${z.name}"? Sales lines using it will stop counting.`)) return;
    const { error } = await supabase.from('br_serving_sizes').update({ is_active: !z.is_active }).eq('id', z.id);
    if (error) notify('Could not update: ' + error.message, false); else { loadSizes(); loadLines(); }
  };

  const addSize = async () => {
    const name = newSize.name.trim(), ic = Number(newSize.ic), gel = newSize.gel.trim() === '' ? ic : Number(newSize.gel);
    if (!name || !(ic > 0) || !(gel > 0)) { notify('Enter a name and grams', false); return; }
    const { error } = await supabase.from('br_serving_sizes').insert({
      brand_id: BR_BRAND_ID, name, grams_ice_cream: ic, grams_gelato: gel,
      match_words: name.split(/\s+/)[0].toLowerCase(), sort_order: sizes.length + 1,
    });
    if (error) { notify('Could not add: ' + error.message, false); return; }
    setNewSize({ name: '', ic: '', gel: '' });
    notify(`${name} added`);
    loadSizes();
  };

  // ---------- matching ----------
  const saveMatch = async (l: BRSalesLine, ignore: boolean) => {
    const p = pick[l.sales_key] || { item: l.item_id || '', size: l.size_id || '' };
    if (!ignore && (!p.item || !p.size)) { notify('Pick the flavour and the size', false); return; }
    const { error } = await supabase.from('br_sales_map').upsert({
      brand_id: BR_BRAND_ID, sales_key: l.sales_key,
      item_id: ignore ? null : p.item, size_id: ignore ? null : p.size, is_ignored: ignore,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'brand_id,sales_key' });
    if (error) { notify('Could not save: ' + error.message, false); return; }
    notify(ignore ? `"${l.item_name}" marked as not ice cream` : `"${l.item_name}" matched`);
    loadLines();
  };

  const clearMatch = async (l: BRSalesLine) => {
    const { error } = await supabase.from('br_sales_map').delete().eq('brand_id', BR_BRAND_ID).eq('sales_key', l.sales_key);
    if (error) notify('Could not clear: ' + error.message, false); else loadLines();
  };

  const unmatched = lines.filter(l => l.matched_by === 'none');
  const shownLines = showAll ? lines : unmatched;
  const activeSizes = sizes.filter(z => z.is_active);

  return (
    <>
      <div className={styles.card}>
        <h2 className={styles.tierTitle}>Serving sizes <span className={styles.count}>grams of ice cream per item sold</span></h2>
        <p className={styles.subtitle} style={{ marginTop: 0 }}>
          Gelato flavours use the gelato grams. &ldquo;Rista words&rdquo; = words in the Rista item name that mean this size (comma separated).
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9rem' }}>
            <thead><tr>
              <th style={td} align="left">Size</th><th style={td} align="left">Ice cream g</th><th style={td} align="left">Gelato g</th>
              <th style={td} align="left">Rista words</th><th style={td}></th>
            </tr></thead>
            <tbody>
              {sizes.map(z => (
                <tr key={z.id} className={z.is_active ? '' : styles.off}>
                  {canEdit ? (
                    <>
                      <td style={td}><input className={styles.search} style={{ minWidth: 0, width: 150 }} value={val(z, 'name')} onChange={e => setVal(z, 'name', e.target.value)} /></td>
                      <td style={td}><input className={styles.search} style={num} type="number" min="0" value={val(z, 'grams_ice_cream')} onChange={e => setVal(z, 'grams_ice_cream', e.target.value)} /></td>
                      <td style={td}><input className={styles.search} style={num} type="number" min="0" value={val(z, 'grams_gelato')} onChange={e => setVal(z, 'grams_gelato', e.target.value)} /></td>
                      <td style={td}><input className={styles.search} style={{ minWidth: 0, width: 150 }} value={val(z, 'match_words')} onChange={e => setVal(z, 'match_words', e.target.value)} /></td>
                      <td style={{ ...td, whiteSpace: 'nowrap' }}>
                        {edits[z.id] && <button className={styles.primary} onClick={() => saveSize(z)}>Save</button>}{' '}
                        <button className={z.is_active ? styles.danger : styles.secondary} onClick={() => toggleSize(z)}>{z.is_active ? 'Switch off' : 'Switch on'}</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={td}>{z.name}{!z.is_active && ' (off)'}</td><td style={td}>{z.grams_ice_cream} g</td>
                      <td style={td}>{z.grams_gelato} g</td><td style={td}>{z.match_words}</td><td style={td}></td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <div className={styles.formGrid} style={{ marginTop: '0.75rem' }}>
            <label className={styles.field}>New size<input value={newSize.name} placeholder="e.g. Kids Scoop" onChange={e => setNewSize({ ...newSize, name: e.target.value })} /></label>
            <label className={styles.field}>Ice cream g<input type="number" min="1" value={newSize.ic} onChange={e => setNewSize({ ...newSize, ic: e.target.value })} /></label>
            <label className={styles.field}>Gelato g<input type="number" min="1" value={newSize.gel} placeholder="same" onChange={e => setNewSize({ ...newSize, gel: e.target.value })} /></label>
            <button className={styles.secondary} onClick={addSize}>+ Add size</button>
          </div>
        )}
      </div>

      <div className={styles.card}>
        <h2 className={styles.tierTitle}>
          Rista sales → flavour <span className={styles.count}>last 45 days of Sales By Items · {unmatched.length} not matched</span>
        </h2>
        <p className={styles.subtitle} style={{ marginTop: 0 }}>
          Lines that name one flavour and one size are matched automatically. Match the rest once here — the app remembers.
          Lines that aren&apos;t ice cream (cones, toppings, drinks): mark &ldquo;Not ice cream&rdquo;.
        </p>
        <div className={styles.toolbar}>
          <select className={styles.search} style={{ flex: 'none', width: 220 }} value={storeId} onChange={e => setStoreId(e.target.value)}>
            {stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <label className={`${styles.field} ${styles.check}`} style={{ paddingBottom: 0 }}>
            <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} /> Show matched lines too
          </label>
        </div>
        {linesErr && <div className={styles.notice}>Could not load sales lines: {linesErr}</div>}
        {!linesErr && lines.length === 0 && <p className={styles.subtitle}>No Sales By Items uploaded for this store in the last 45 days.</p>}
        {!linesErr && lines.length > 0 && shownLines.length === 0 && <p className={styles.subtitle}>✅ Every sales line is matched.</p>}
        {shownLines.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead><tr>
                <th style={td} align="left">Rista line</th><th style={td} align="right">Qty</th>
                <th style={td} align="left">Flavour</th><th style={td} align="left">Size</th><th style={td}></th>
              </tr></thead>
              <tbody>
                {shownLines.map(l => {
                  const p = pick[l.sales_key] || { item: l.item_id || '', size: l.size_id || '' };
                  const setP = (k: 'item' | 'size', v: string) => setPick(x => ({ ...x, [l.sales_key]: { ...p, [k]: v } }));
                  return (
                    <tr key={l.sales_key}>
                      <td style={td}>
                        <strong>{l.item_name}</strong>{l.variant ? ` · ${l.variant}` : ''}
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          {[l.item_type, l.category].filter(Boolean).join(' · ')}
                          {l.matched_by === 'auto' && ' · matched automatically'}{l.matched_by === 'saved' && ' · saved match'}
                          {l.matched_by === 'ignored' && ' · not ice cream'}
                        </div>
                      </td>
                      <td style={td} align="right">{l.quantity}</td>
                      {canEdit ? (
                        <>
                          <td style={td}>
                            <select className={styles.search} style={{ minWidth: 0, width: 190 }} value={p.item} onChange={e => setP('item', e.target.value)}>
                              <option value="">Flavour…</option>
                              {flavours.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
                            </select>
                          </td>
                          <td style={td}>
                            <select className={styles.search} style={{ minWidth: 0, width: 150 }} value={p.size} onChange={e => setP('size', e.target.value)}>
                              <option value="">Size…</option>
                              {activeSizes.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                            </select>
                          </td>
                          <td style={{ ...td, whiteSpace: 'nowrap' }}>
                            <button className={styles.primary} onClick={() => saveMatch(l, false)}>Save</button>{' '}
                            <button className={styles.secondary} onClick={() => saveMatch(l, true)}>Not ice cream</button>{' '}
                            {(l.matched_by === 'saved' || l.matched_by === 'ignored') &&
                              <button className={styles.secondary} onClick={() => clearMatch(l)}>Clear</button>}
                          </td>
                        </>
                      ) : (
                        <>
                          <td style={td}>{l.flavour_name || '—'}</td><td style={td}>{l.size_name || '—'}</td><td style={td}></td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {msg && <div className={`${styles.toast} ${msg.ok ? styles.ok : styles.err}`}>{msg.text}</div>}
    </>
  );
}
