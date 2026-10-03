'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
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
  const [storeId, setStoreId] = useState<string | null>(null);
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

  const supabase = createClient();
  const todayDate = new Date().toISOString().split('T')[0];
  const reasons = WASTAGE_REASONS || ['Spilled', 'Expired', 'Dropped', 'Burnt', 'Other'];

  useEffect(() => {
    const init = async () => {
      const storedStoreId = localStorage.getItem('brp_selected_store');
      if (!storedStoreId) {
        setLoading(false);
        return;
      }
      setStoreId(storedStoreId);

      try {
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('id, name')
          .eq('store_id', storedStoreId)
          .eq('is_active', true);
        if (staffData) setStaffList(staffData);

        const { data: itemsData } = await supabase
          .from('items')
          .select('id, name, uom')
          .eq('is_active', true)
          .eq('is_daily_tracked', true);
        if (itemsData) setItems(itemsData);

        fetchEntries(storedStoreId);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [supabase]);

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
    if (!form.item_id || !form.quantity_wasted || !form.reason || !form.staff_member_id) {
      showToast('Please fill all required fields', 'error');
      return;
    }
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const profileId = user?.id;

      const payload = {
        store_id: storeId,
        entry_date: todayDate,
        item_id: form.item_id,
        quantity_wasted: Number(form.quantity_wasted),
        reason: form.reason,
        reason_notes: form.reason === 'Other' ? form.reason_notes : null,
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
      await supabase.from('daily_wastage_log').delete().eq('id', id);
      fetchEntries(storeId!);
      showToast('Entry deleted', 'success');
    } catch (error) {
      showToast('Failed to delete', 'error');
    }
  };

  if (loading) return <div className={styles.spinner}></div>;
  if (!storeId) return <div className={styles.container}>Please select a store.</div>;

  const selectedItem = items.find(i => i.id === form.item_id);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Wastage Log</h1>
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
          
          {form.reason === 'Other' && (
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
                    {entry.reason}
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
