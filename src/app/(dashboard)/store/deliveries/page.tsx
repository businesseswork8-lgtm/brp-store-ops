'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { StockTabs } from '@/components/store/StockTabs';
import { displayUnit, fromDisplay, toDisplay } from '@/lib/stock/units';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';
import { isBRStore } from '@/lib/br';
import { FULL_BOX_GRAMS } from '@/lib/icecream';

const MOVES = [
  { v: 'received', label: 'Received from warehouse' },
  { v: 'transfer_in', label: 'Transfer IN (from another store)' },
  { v: 'transfer_out', label: 'Transfer OUT (to another store)' },
] as const;
type Move = typeof MOVES[number]['v'];

type Item = { id: string; name: string; uom: string; tare_grams: number; rista_unit: string | null };
type StaffMember = { id: string; name: string };
type Delivery = {
  id: string;
  quantity: number;
  boxes: number | null;
  movement?: string;
  created_at: string;
  po_reference: string | null;
  items: { name: string; uom: string; rista_unit: string | null } | null;
  staff_members: { name: string } | null;
};

/** Received / transfers: the whole delivery is entered in one go (type a number next to each item, save once). */
export default function DeliveriesPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [items, setItems] = useState<Item[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [move, setMove] = useState<Move>('received');
  const [staff, setStaff] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadDeliveries = useCallback(async (storeId: string) => {
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, quantity, boxes, movement, created_at, po_reference, items(name, uom, rista_unit), staff_members(name)')
      .eq('store_id', storeId)
      .eq('entry_date', today)
      .order('created_at', { ascending: false });
    setDeliveries((data || []) as unknown as Delivery[]);
  }, [supabase, today]);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: st }, { data: itemRows }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('items')
        .select('id, name, uom, tare_grams, rista_unit, item_categories!inner(brand_id, is_flavour)')
        .eq('is_active', true)
        .eq('item_categories.brand_id', store.brand_id)
        .order('name'),
    ]);
    // Baskin Robbins: only ice cream flavours are tracked
    const br = isBRStore(store);
    const rows = (itemRows || []).filter(i => !br || (i as unknown as { item_categories: { is_flavour: boolean } }).item_categories?.is_flavour);
    setStaffList(st || []);
    setItems(rows.map(i => ({ id: i.id, name: i.name, uom: i.uom, tare_grams: Number(i.tare_grams) || 0, rista_unit: i.rista_unit })));
    await loadDeliveries(store.id);
    setLoading(false);
  }, [supabase, store, loadDeliveries]);

  useEffect(() => { load(); }, [load]);

  const isBox = (i: Item) => i.tare_grams > 0;
  const filledIds = Object.keys(qty).filter(id => (qty[id] ?? '').trim() !== '');

  const saveAll = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who received it', 'error'); return; }
    if (!filledIds.length) { showToast('Type a number next to at least one item', 'error'); return; }

    const rows = [];
    for (const id of filledIds) {
      const item = items.find(i => i.id === id);
      if (!item) continue;
      const n = Number(qty[id]);
      if (isNaN(n) || n < 0) { showToast(`Check the number for ${item.name}`, 'error'); return; }
      if (n === 0) continue;
      if (isBox(item) && !Number.isInteger(n)) { showToast(`${item.name}: enter whole boxes`, 'error'); return; }
      rows.push({
        store_id: store.id,
        item_id: item.id,
        entry_date: today,
        quantity: isBox(item) ? n * FULL_BOX_GRAMS : fromDisplay(n, item.rista_unit, item.uom),
        boxes: isBox(item) ? n : null,
        movement: move,
        supplier_name: move === 'received' ? 'Warehouse' : null,
        po_reference: note.trim() || null,
        staff_member_id: staff,
      });
    }
    if (!rows.length) { showToast('All numbers are 0 — nothing to save', 'error'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');
      const { error } = await supabase.from('purchase_orders').insert(rows.map(r => ({ ...r, submitted_by_profile_id: user.id })));
      if (error) throw error;
      const boxes = rows.reduce((t, r) => t + (r.boxes || 0), 0);
      showToast(`${rows.length} item${rows.length > 1 ? 's' : ''} saved${boxes ? ` · ${boxes} boxes` : ''}`, 'success');
      setQty({});
      setNote('');
      loadDeliveries(store.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not save. Please try again.';
      showToast(/row-level security/i.test(m) ? 'This day is closed for changes. Ask your manager.' : m, 'error');
    } finally {
      setSaving(false);
    }
  };

  /** Fix the number of boxes / quantity on an entry already saved today. */
  const saveEdit = async (d: Delivery) => {
    const raw = (editing[d.id] ?? '').trim();
    const n = Number(raw);
    if (raw === '' || isNaN(n) || n <= 0) { showToast('Enter a number above 0 (or use Delete)', 'error'); return; }
    const box = d.boxes !== null;
    if (box && !Number.isInteger(n)) { showToast('Enter whole boxes', 'error'); return; }
    const quantity = box ? n * FULL_BOX_GRAMS : d.items ? fromDisplay(n, d.items.rista_unit, d.items.uom) : n;
    const { error } = await supabase.from('purchase_orders').update({ quantity, boxes: box ? n : null }).eq('id', d.id);
    if (error) { showToast(/row-level security/i.test(error.message) ? 'This day is closed for changes. Ask your manager.' : 'Could not update: ' + error.message, 'error'); return; }
    setEditing(e => { const x = { ...e }; delete x[d.id]; return x; });
    showToast(`${d.items?.name}: updated`, 'success');
    if (store) loadDeliveries(store.id);
  };

  const remove = async (d: Delivery) => {
    if (!store || !confirm(`Delete ${d.items?.name}?`)) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', d.id);
    if (error) showToast(/row-level security/i.test(error.message) ? 'This day is closed for changes. Ask your manager.' : 'Could not delete: ' + error.message, 'error');
    else loadDeliveries(store.id);
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const term = search.trim().toLowerCase();
  const shown = items.filter(i => !term || i.name.toLowerCase().includes(term));
  const anyBox = items.some(isBox);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title}>Stock</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <StockTabs />

      <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
        When stock arrives, type the number next to <strong>every item that came</strong> and press Save once.
        {anyBox && <> Ice cream: number of <strong>packed boxes</strong> (1 box = {FULL_BOX_GRAMS} g).</>}
      </p>

      <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        <select className={styles.select} value={move} onChange={e => setMove(e.target.value as Move)}>
          {MOVES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
        </select>
        <select className={styles.select} value={staff} onChange={e => setStaff(e.target.value)}>
          <option value="">Who received it?</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="text" className={styles.input} style={{ flex: 1, minWidth: 160 }} value={note}
          onChange={e => setNote(e.target.value)} placeholder="Challan / note (optional)" />
      </div>

      <input className={styles.input} style={{ width: '100%', marginBottom: '1rem' }} placeholder="Search item…"
        value={search} onChange={e => setSearch(e.target.value)} />

      {items.length === 0 && <p className={styles.statusText}>No items set up yet — ask your manager.</p>}

      <div className={styles.formContainer}>
        <div className={styles.itemGrid}>
          {shown.map(i => {
            const v = qty[i.id] ?? '';
            const n = Number(v);
            return (
              <div key={i.id} className={styles.itemRow}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{i.name}</span>
                  <span className={styles.badge}>{isBox(i) ? 'boxes' : displayUnit(i.rista_unit, i.uom)}</span>
                </div>
                <input type="number" inputMode={isBox(i) ? 'numeric' : 'decimal'} min="0" step={isBox(i) ? 1 : 'any'}
                  className={styles.input} value={v} placeholder="0"
                  aria-label={`${i.name} ${isBox(i) ? 'packed boxes' : 'quantity'} received`}
                  onChange={e => setQty(q => ({ ...q, [i.id]: e.target.value }))} />
                {isBox(i) && v.trim() !== '' && n > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>= {(n * FULL_BOX_GRAMS / 1000).toFixed(2)} kg</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {items.length > 0 && (
        <div className={styles.submitArea}>
          <p className={styles.statusText}>{filledIds.length} item{filledIds.length === 1 ? '' : 's'} entered</p>
          <button className={styles.button} onClick={saveAll} disabled={saving || !filledIds.length}>
            {saving ? 'Saving…' : `Save ${filledIds.length || ''} item${filledIds.length === 1 ? '' : 's'}`}
          </button>
        </div>
      )}

      <div className={styles.tableContainer} style={{ marginTop: '2rem' }}>
        <h2 className={styles.title} style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Received today</h2>
        {deliveries.length === 0 ? (
          <p className={styles.statusText}>Nothing received today.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Time</th><th>Item</th><th>Type</th><th>Qty</th><th>By</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {deliveries.map(d => {
                const isEditing = editing[d.id] !== undefined;
                const shownQty = d.boxes !== null ? d.boxes : d.items ? toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom) : d.quantity;
                const unit = d.boxes !== null ? 'boxes' : d.items ? displayUnit(d.items.rista_unit, d.items.uom) : '';
                return (
                  <tr key={d.id}>
                    <td>{new Date(d.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</td>
                    <td>{d.items?.name}</td>
                    <td>{d.movement === 'transfer_out' ? 'Transfer out' : d.movement === 'transfer_in' ? 'Transfer in' : 'Received'}</td>
                    <td>
                      {isEditing ? (
                        <span style={{ display: 'inline-flex', gap: '0.35rem', alignItems: 'center' }}>
                          <input type="number" min="0" className={styles.input} style={{ width: 80, padding: '0.3rem' }}
                            value={editing[d.id]} onChange={e => setEditing(x => ({ ...x, [d.id]: e.target.value }))} /> {unit}
                        </span>
                      ) : (
                        <>{shownQty} {unit}{d.boxes !== null ? ` = ${(Number(d.quantity) / 1000).toFixed(2)} kg` : ''}</>
                      )}
                    </td>
                    <td>{d.staff_members?.name || '—'}</td>
                    <td>{d.po_reference || ''}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {isEditing ? (
                        <>
                          <button onClick={() => saveEdit(d)} style={{ background: 'transparent', border: 'none', color: 'var(--success)', cursor: 'pointer' }}>Save</button>
                          <button onClick={() => setEditing(x => { const y = { ...x }; delete y[d.id]; return y; })}
                            style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer' }}>Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setEditing(x => ({ ...x, [d.id]: String(shownQty) }))}
                            style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer' }}>Edit</button>
                          <button onClick={() => remove(d)}
                            style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>Delete</button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
