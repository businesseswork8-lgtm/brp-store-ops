'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';
import styles from '../store.module.css';
import { WASTAGE_REASONS } from '@/lib/types';

type StaffMember = {
  id: string;
  name: string;
};

type Item = {
  id: string;
  name: string;
  uom: string;
};

type WastageEntry = {
  id: string;
  item_id: string;
  quantity_wasted: number;
  reason: string;
  reason_notes: string;
  staff_member_id: string;
  created_at: string;
  items?: { name: string, uom: string };
  staff_members?: { name: string };
};

export default function WastageLogPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const storeId = store?.id ?? null;
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [entries, setEntries] = useState<WastageEntry[]>([]);

  const [form, setForm] = useState({
    item_id: '',
    quantity_wasted: '',
    reason: '',
    reason_notes: '',
    staff_member_id: '',
  });

  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  const todayDate = istDate();

  const init = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: staffData }, { data: itemsData }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      // Only this store's brand
      supabase.from('items')
        .select('id, name, uom, item_categories!inner(brand_id)')
        .eq('is_active', true)
        .eq('item_categories.brand_id', store.brand_id)
        .order('name'),
    ]);
    setStaffList(staffData || []);
    setItems((itemsData || []).map(i => ({ id: i.id, name: i.name, uom: i.uom })));
    await fetchEntries(store.id);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, store]);

  useEffect(() => { init(); }, [init]);

  const fetchEntries = async (sId: string) => {
    const { data } = await supabase
      .from('daily_wastage_log')
      .select(`
        id, item_id, quantity_wasted, reason, reason_notes, created_at,
        items(name, uom),
        staff_members(name)
      `)
      .eq('store_id', sId)
      .eq('entry_date', todayDate)
      .order('created_at', { ascending: false });
      
    if (data) setEntries(data as any);
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async () => {
    if (!form.item_id || !form.quantity_wasted || Number(form.quantity_wasted) <= 0 || !form.reason || !form.staff_member_id) {
      showToast('Please fill all required fields', 'error');
      return;
    }
    if (form.reason === 'other' && !form.reason_notes.trim()) {
      showToast('Please write the reason', 'error');
      return;
    }
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');
      const profileId = user.id;

      const payload = {
        store_id: storeId,
        entry_date: todayDate,
        item_id: form.item_id,
        quantity_wasted: Number(form.quantity_wasted),
        reason: form.reason,
        reason_notes: form.reason === 'other' ? form.reason_notes.trim() : null,
        staff_member_id: form.staff_member_id,
        submitted_by_profile_id: profileId,
      };

      const { error } = await supabase.from('daily_wastage_log').insert(payload);

      if (error) throw error;
      showToast('Wastage entry added', 'success');
      setForm({ ...form, item_id: '', quantity_wasted: '', reason: '', reason_notes: '' });
      fetchEntries(storeId!);

    } catch (error) {
      console.error(error);
      showToast('Failed to save wastage', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this entry?')) return;
    try {
      const { error } = await supabase.from('daily_wastage_log').delete().eq('id', id);
      if (error) throw error;
      fetchEntries(storeId!);
      showToast('Entry deleted', 'success');
    } catch (error) {
      showToast('Failed to delete', 'error');
    }
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!storeId) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const selectedItem = items.find(i => i.id === form.item_id);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title}>Daily Wastage Log</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <div className={styles.message} style={{ marginBottom: '2rem', textAlign: 'left' }}>
        <div style={{ display: 'grid', gap: '1rem', gridTemplateColumns: '1fr 1fr' }}>
          <div>
            <label className={styles.statusText}>Staff Member *</label>
            <select 
              className={styles.select}
              value={form.staff_member_id}
              onChange={(e) => setForm({...form, staff_member_id: e.target.value})}
            >
              <option value="">Select Staff...</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.statusText}>Item *</label>
            <select 
              className={styles.select}
              value={form.item_id}
              onChange={(e) => setForm({...form, item_id: e.target.value})}
            >
              <option value="">Select Item...</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
          </div>
          <div>
            <label className={styles.statusText}>Quantity {selectedItem ? `(${selectedItem.uom})` : ''} *</label>
            <input 
              type="number"
              className={styles.input}
              value={form.quantity_wasted}
              onChange={(e) => setForm({...form, quantity_wasted: e.target.value})}
              placeholder="Quantity"
              min="0"
              step="0.01"
            />
          </div>
          <div>
            <label className={styles.statusText}>Reason *</label>
            <select 
              className={styles.select}
              value={form.reason}
              onChange={(e) => setForm({...form, reason: e.target.value})}
            >
              <option value="">Select Reason...</option>
              {WASTAGE_REASONS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          
          {form.reason === 'other' && (
            <div style={{ gridColumn: '1 / -1' }}>
              <label className={styles.statusText}>Notes (Required for Other) *</label>
              <input 
                type="text"
                className={styles.input}
                value={form.reason_notes}
                onChange={(e) => setForm({...form, reason_notes: e.target.value})}
                placeholder="Specify reason..."
              />
            </div>
          )}
        </div>
        <div className={styles.submitArea} style={{ marginTop: '1rem' }}>
          <button className={styles.button} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Adding...' : 'Add Entry'}
          </button>
        </div>
      </div>

      <div className={styles.tableContainer}>
        <h2 className={styles.title} style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>Today's Wastage</h2>
        {entries.length === 0 ? (
          <p className={styles.statusText}>No wastage logged today.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Time</th>
                <th>Item</th>
                <th>Qty</th>
                <th>Reason</th>
                <th>Staff</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(entry => (
                <tr key={entry.id}>
                  <td>{new Date(entry.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td>
                  <td>{entry.items?.name}</td>
                  <td>{entry.quantity_wasted} {entry.items?.uom}</td>
                  <td>
                    {WASTAGE_REASONS.find(r => r.value === entry.reason)?.label || entry.reason}
                    {entry.reason_notes && <span style={{display: 'block', fontSize: '0.8em', color: 'var(--text-secondary)'}}>{entry.reason_notes}</span>}
                  </td>
                  <td>{entry.staff_members?.name}</td>
                  <td>
                    <button 
                      onClick={() => handleDelete(entry.id)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '0.5rem' }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
