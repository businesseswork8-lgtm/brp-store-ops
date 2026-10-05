'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';

type Item = { id: string; name: string; uom: string; tare_grams: number; full_box_grams: number | null };
type StaffMember = { id: string; name: string };
type Delivery = {
  id: string;
  quantity: number;
  boxes: number | null;
  created_at: string;
  po_reference: string | null;
  items: { name: string; uom: string } | null;
  staff_members: { name: string } | null;
};

export default function DeliveriesPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [items, setItems] = useState<Item[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ staff: '', item_id: '', qty: '', note: '' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadDeliveries = useCallback(async (storeId: string) => {
    const { data } = await supabase
      .from('purchase_orders')
      .select('id, quantity, boxes, created_at, po_reference, items(name, uom), staff_members(name)')
      .eq('store_id', storeId)
      .eq('entry_date', today)
      .order('created_at', { ascending: false });
    setDeliveries((data || []) as unknown as Delivery[]);
  }, [supabase, today]);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: staff }, { data: itemRows }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('items')
        .select('id, name, uom, tare_grams, full_box_grams, item_categories!inner(brand_id)')
        .eq('is_active', true)
        .eq('item_categories.brand_id', store.brand_id)
        .order('name'),
    ]);
    setStaffList(staff || []);
    setItems((itemRows || []).map(i => ({ id: i.id, name: i.name, uom: i.uom, tare_grams: Number(i.tare_grams) || 0, full_box_grams: i.full_box_grams === null ? null : Number(i.full_box_grams) })));
    await loadDeliveries(store.id);
    setLoading(false);
  }, [supabase, store, loadDeliveries]);

  useEffect(() => { load(); }, [load]);

  const item = items.find(i => i.id === form.item_id);
  // Ice cream arrives in sealed boxes: staff enter the number of boxes, we convert to grams
  const box = Boolean(item && item.tare_grams > 0);
  const boxGrams = Number(item?.full_box_grams) || 0;
  const qtyNum = form.qty === '' ? null : Number(form.qty);
  const net = qtyNum === null ? null : box ? qtyNum * boxGrams : qtyNum;

  const save = async () => {
    if (!store) return;
    if (!form.staff) { showToast('Please select who received it', 'error'); return; }
    if (!item) { showToast('Please select the item', 'error'); return; }
    if (box && !boxGrams) { showToast(`Full box weight for ${item.name} is not set — ask your manager (Ice Cream Flavours page)`, 'error'); return; }
    if (box && !Number.isInteger(qtyNum)) { showToast('Enter a whole number of boxes', 'error'); return; }
    if (net === null || !(net > 0)) { showToast('Please enter the quantity received', 'error'); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');
      const { error } = await supabase.from('purchase_orders').insert({
        store_id: store.id,
        item_id: item.id,
        entry_date: today,
        quantity: net,
        boxes: box ? qtyNum : null,
        supplier_name: 'Warehouse',
        po_reference: form.note.trim() || null,
        staff_member_id: form.staff,
        submitted_by_profile_id: user.id,
      });
      if (error) throw error;
      showToast(`${item.name}: ${net} ${item.uom} received`, 'success');
      setForm(f => ({ ...f, item_id: '', qty: '', note: '' }));
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
        <h1 className={styles.title}>Stock Received</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
        Enter everything that arrived from the warehouse today, as soon as it arrives.
      </p>

      <div className={styles.message} style={{ textAlign: 'left', marginBottom: '2rem' }}>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <label className={styles.statusText}>Received by *</label>
            <select className={styles.select} value={form.staff} onChange={e => setForm({ ...form, staff: e.target.value })}>
              <option value="">Who received it?</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.statusText}>Item *</label>
            <select className={styles.select} value={form.item_id} onChange={e => setForm({ ...form, item_id: e.target.value, qty: '' })}>
              <option value="">Select item…</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.statusText}>
              {box ? 'Sealed boxes received *' : `Quantity${item ? ` (${item.uom})` : ''} *`}
            </label>
            <input type="number" inputMode="decimal" min="0" className={styles.input}
              value={form.qty} onChange={e => setForm({ ...form, qty: e.target.value })} placeholder="0" />
          </div>
          <div>
            <label className={styles.statusText}>Challan / note (optional)</label>
            <input type="text" className={styles.input} value={form.note}
              onChange={e => setForm({ ...form, note: e.target.value })} placeholder="e.g. Challan 1234" />
          </div>
        </div>
        {box && (
          <p className={styles.statusText} style={{ marginTop: '0.75rem' }}>
            {boxGrams
              ? <>One sealed box = {boxGrams} g{net !== null && net > 0 ? <> · Ice cream received: <strong>{net} g</strong></> : null}</>
              : <span style={{ color: 'var(--danger)' }}>Full box weight is not set for this flavour — ask your manager.</span>}
          </p>
        )}
        <div className={styles.submitArea} style={{ marginTop: '1rem' }}>
          <button className={styles.button} onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Add'}
          </button>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <h2 className={styles.title} style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Received today</h2>
        {deliveries.length === 0 ? (
          <p className={styles.statusText}>Nothing received today.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr><th>Time</th><th>Item</th><th>Qty</th><th>Received by</th><th>Note</th><th></th></tr>
            </thead>
            <tbody>
              {deliveries.map(d => (
                <tr key={d.id}>
                  <td>{new Date(d.created_at).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{d.items?.name}</td>
                  <td>{d.boxes ? `${d.boxes} box${d.boxes > 1 ? 'es' : ''} = ` : ''}{d.quantity} {d.items?.uom}</td>
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
