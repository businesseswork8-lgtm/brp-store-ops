'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../store.module.css';
import { toDisplay, fromDisplay, displayUnit } from '@/lib/stock/units';
import { businessDate } from '@/lib/dates';

type Move = 'received' | 'transfer_in' | 'transfer_out';
const MOVES: { v: Move; label: string }[] = [
  { v: 'received', label: 'Received stock' },
  { v: 'transfer_in', label: 'Transfer IN (from another store)' },
  { v: 'transfer_out', label: 'Transfer OUT (to another store)' }
];

const StockTabs = () => (
  <div className={styles.tabs} style={{ marginBottom: '1.5rem' }}>
    <Link href="/store/count" className={styles.tab}>Counts</Link>
    <Link href="/store/deliveries" className={`${styles.tab} ${styles.active}`}>Received</Link>
    <Link href="/store/wastage" className={styles.tab}>Wastage</Link>
  </div>
);


type Item = { id: string; name: string; uom: string; rista_unit: string | null; tare_grams: number; full_box_grams: number | null };
type Delivery = { id: string; created_at: string; quantity: number; boxes: number | null; movement: string; supplier_name: string | null; po_reference: string | null; items: { name: string; uom: string; rista_unit: string | null } | null; staff_members: { name: string } | null };

export default function DeliveriesPage() {
  const supabase = createClient();
  const [store, setStore] = useState<{id: string, name: string} | null>(null);
  const [storeLoading, setStoreLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  const [staffList, setStaffList] = useState<{id: string, name: string}[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const today = businessDate();

  // Top level form
  const [move, setMove] = useState<Move>('received');
  const [staff, setStaff] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  
  // Item values: { [item_id]: string }
  const [values, setValues] = useState<Record<string, string>>({});

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => {
    const id = localStorage.getItem('brp_selected_store');
    const name = localStorage.getItem('brp_selected_store_name');
    if (id && name) setStore({ id, name });
    setStoreLoading(false);
  }, []);

  const loadDeliveries = useCallback(async (storeId: string) => {
    const { data } = await supabase.from('purchase_orders')
      .select('id, created_at, quantity, boxes, movement, supplier_name, po_reference, items(name, uom, rista_unit), staff_members(name)')
      .eq('store_id', storeId)
      .eq('entry_date', today)
      .order('created_at', { ascending: false });
    setDeliveries((data as any) || []);
  }, [supabase, today]);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const { data: staffData } = await supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name');
    setStaffList(staffData || []);
    
    // For BR, we typically receive Flavours. For 99P, other items. Load all active items.
    // To make it easy to mass-add, we list them alphabetically.
    const { data: rows } = await supabase
      .from('items')
      .select('id, name, uom, rista_unit, tare_grams, full_box_grams')
      .eq('is_active', true)
      .order('name');
      
    setItems((rows || []).map(i => ({ 
      id: i.id, name: i.name, uom: i.uom, 
      tare_grams: Number(i.tare_grams) || 0, 
      full_box_grams: i.full_box_grams === null ? null : Number(i.full_box_grams), 
      rista_unit: i.rista_unit 
    })));
    
    await loadDeliveries(store.id);
    setLoading(false);
  }, [supabase, store, loadDeliveries]);

  useEffect(() => { load(); }, [load]);

  const shown = items.filter(i => !search.trim() || i.name.toLowerCase().includes(search.trim().toLowerCase()));

  const saveAll = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who received it', 'error'); return; }
    
    const entriesToSave: any[] = [];
    
    for (const item of items) {
      const val = (values[item.id] || '').trim();
      if (!val) continue;
      
      const box = item.tare_grams > 0;
      const boxGrams = item.full_box_grams || 0;
      const qtyNum = Number(val);
      
      if (box && !boxGrams) { showToast(`Full box weight for ${item.name} is not set — ask your manager`, 'error'); return; }
      if (box && !Number.isInteger(qtyNum)) { showToast(`Enter a whole number of boxes for ${item.name}`, 'error'); return; }
      if (isNaN(qtyNum) || qtyNum <= 0) { showToast(`Check the number for ${item.name}`, 'error'); return; }
      
      const net = box ? qtyNum * boxGrams : fromDisplay(qtyNum, item.rista_unit, item.uom);
      
      entriesToSave.push({
        store_id: store.id,
        item_id: item.id,
        entry_date: today,
        quantity: net,
        boxes: box ? qtyNum : null,
        movement: move,
        supplier_name: 'Warehouse',
        po_reference: note.trim() || null,
        staff_member_id: staff,
      });
    }
    
    if (entriesToSave.length === 0) { showToast('Enter at least one quantity', 'error'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');
      
      const inserts = entriesToSave.map(e => ({ ...e, submitted_by_profile_id: user.id }));
      const { error } = await supabase.from('purchase_orders').insert(inserts);
      
      if (error) throw error;
      
      showToast(`Saved ${inserts.length} items successfully`, 'success');
      setValues({});
      setNote('');
      setSearch('');
      loadDeliveries(store.id);
    } catch (err) {
      console.error(err);
      showToast(err instanceof Error ? err.message : 'Could not save. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (d: Delivery) => {
    if (!store || !confirm(`Delete ${d.items?.name} (${d.quantity} ${d.items?.uom})?`)) return;
    const { error } = await supabase.from('purchase_orders').delete().eq('id', d.id);
    if (error) showToast(/row-level security/i.test(error.message) ? 'This day is closed for changes. Ask your manager.' : 'Could not delete: ' + error.message, 'error');
    else loadDeliveries(store.id);
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title}>Stock</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <StockTabs />

      <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
        Enter stock as soon as it arrives — and anything sent to or received from another store.
      </p>

      <div className={styles.message} style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 200px' }}>
            <label className={styles.statusText}>What happened? *</label>
            <select className={styles.select} value={move} onChange={e => setMove(e.target.value as Move)}>
              {MOVES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label className={styles.statusText}>Entered by *</label>
            <select className={styles.select} value={staff} onChange={e => setStaff(e.target.value)}>
              <option value="">Who received it?</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label className={styles.statusText}>Challan / note (optional)</label>
            <input type="text" className={styles.input} value={note}
              onChange={e => setNote(e.target.value)} placeholder="e.g. Challan 1234" />
          </div>
        </div>
      </div>
      
      <div className={styles.controls} style={{ marginBottom: '1rem' }}>
        <input className={styles.input} style={{ width: '100%' }} placeholder="Search item to quickly add..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      <div className={styles.formContainer}>
        <div className={styles.itemGrid}>
          {shown.map(i => {
            const box = i.tare_grams > 0;
            return (
              <div key={i.id} className={styles.itemRow}>
                <div className={styles.itemInfo}>
                  <span className={styles.itemName}>{i.name}</span>
                  <span className={styles.badge}>{box ? 'Sealed boxes' : displayUnit(i.rista_unit, i.uom)}</span>
                </div>
                <input type="number" inputMode="decimal" min="0" className={styles.input} style={{ maxWidth: 140 }}
                  value={values[i.id] ?? ''} placeholder={box ? "Boxes" : "Qty"}
                  aria-label={`${i.name} received quantity`}
                  onChange={e => setValues(v => ({ ...v, [i.id]: e.target.value }))} />
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.submitArea} style={{ marginTop: '1.5rem', marginBottom: '2rem' }}>
        <button className={styles.button} onClick={saveAll} disabled={saving || Object.values(values).filter(v => v.trim()).length === 0}>
          {saving ? 'Saving…' : `Save ${Object.values(values).filter(v => v.trim()).length} Items`}
        </button>
      </div>

      <div className={styles.tableContainer}>
        <h2 className={styles.title} style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Received today</h2>
        {deliveries.length === 0 ? (
          <p className={styles.statusText}>Nothing received today.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Time</th><th>Item</th><th>Type</th><th>Qty</th><th>By</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td>{new Date(d.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{d.items?.name}</td>
                  <td>{d.movement === 'transfer_out' ? 'Transfer out' : d.movement === 'transfer_in' ? 'Transfer in' : 'Received'}</td>
                  <td>{d.boxes ? `${d.boxes} box${d.boxes > 1 ? 'es' : ''} = ` : ''}{d.items ? `${toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom)} ${displayUnit(d.items.rista_unit, d.items.uom)}` : d.quantity}</td>
                  <td>{d.staff_members?.name || '—'}</td>
                  <td>{d.po_reference || ''}</td>
                  <td>
                    <button onClick={() => remove(d)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer' }}>
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
