'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { DENOMINATIONS } from '@/lib/types';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate } from '@/lib/dates';

type StaffMember = { id: string; name: string };

// ₹2000 notes are withdrawn — not shown to staff (column kept in DB for old data)
const NOTES = DENOMINATIONS.filter(d => d.value !== 2000);

export default function CashTallyPage() {
  const { supabase, store, profile, loading: storeLoading } = useActiveStore();
  const [mode, setMode] = useState<'morning' | 'evening'>('morning');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasSavedTally, setHasSavedTally] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const today = istDate();

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: staff }, { data: tally }] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('daily_cash_tally').select('*')
        .eq('store_id', store.id).eq('entry_date', today).eq('tally_type', mode).maybeSingle(),
    ]);
    setStaffList(staff || []);
    if (tally) {
      setHasSavedTally(true);
      setSelectedStaff(tally.staff_member_id || '');
      const c: Record<string, number> = {};
      NOTES.forEach(d => { c[d.key] = tally[d.key] || 0; });
      setCounts(c);
    } else {
      setHasSavedTally(false);
      setCounts({});
      setSelectedStaff('');
    }
    setLoading(false);
  }, [supabase, store, mode, today]);

  useEffect(() => { load(); }, [load]);

  const total = NOTES.reduce((sum, d) => sum + (counts[d.key] || 0) * d.value, 0);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isSuperAdminOrAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const isLockedForStore = hasSavedTally && !isSuperAdminOrAdmin;

  const handleSubmit = async () => {
    if (!store) return;
    if (isLockedForStore) {
      showToast('Cash count is locked. Only an Admin can edit it.', 'error');
      return;
    }
    if (!selectedStaff) { showToast('Please select who is counting', 'error'); return; }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      // total_amount is calculated by the database — never send it
      const payload: Record<string, unknown> = {
        store_id: store.id,
        entry_date: today,
        tally_type: mode,
        staff_member_id: selectedStaff,
        submitted_by_profile_id: user.id,
      };
      NOTES.forEach(d => { payload[d.key] = counts[d.key] || 0; });

      const { error } = await supabase
        .from('daily_cash_tally')
        .upsert(payload, { onConflict: 'store_id,entry_date,tally_type' });
      if (error) throw error;
      setHasSavedTally(true);
      showToast(`${mode === 'morning' ? 'Morning' : 'Evening'} cash saved: ₹${total.toLocaleString('en-IN')}`, 'success');
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || '';
      showToast(/row-level security/i.test(msg) ? 'This day is closed for changes. Ask your manager to correct it.' : msg || 'Could not save. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1 className={styles.title}>Cash Count</h1>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <div className={styles.tabs}>
        <button className={`${styles.tab} ${mode === 'morning' ? styles.active : ''}`} onClick={() => setMode('morning')}>
          Morning
        </button>
        <button className={`${styles.tab} ${mode === 'evening' ? styles.active : ''}`} onClick={() => setMode('evening')}>
          Evening
        </button>
      </div>

      {isLockedForStore && (
        <div style={{ maxWidth: '600px', margin: '0 auto 1.5rem', padding: '1rem', background: 'rgba(255,214,0,0.1)', border: '1px solid var(--warning)', borderRadius: '8px', textAlign: 'center' }}>
          🔒 <strong>{mode === 'morning' ? 'Morning' : 'Evening'} cash has been submitted and locked.</strong>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            Store staff cannot edit a saved cash count. If an adjustment is needed, contact an Admin or Super Admin.
          </div>
        </div>
      )}

      {hasSavedTally && isSuperAdminOrAdmin && (
        <div style={{ maxWidth: '600px', margin: '0 auto 1.5rem', padding: '0.75rem 1rem', background: 'rgba(0,200,83,0.1)', border: '1px solid var(--success)', borderRadius: '8px', textAlign: 'center', fontSize: '0.88rem' }}>
          👑 <strong>Admin Mode:</strong> You have permission to edit and update this saved cash count.
        </div>
      )}

      <div className={styles.controls} style={{ maxWidth: '600px', margin: '0 auto 2rem' }}>
        <select
          className={styles.select}
          value={selectedStaff}
          onChange={e => setSelectedStaff(e.target.value)}
          disabled={isLockedForStore}
        >
          <option value="">Who is counting?</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className={styles.cashGrid}>
        {NOTES.map(d => (
          <div key={d.key} className={styles.cashRow}>
            <div className={styles.denomination}>{d.label}</div>
            <input
              type="number"
              inputMode="numeric"
              className={styles.input}
              value={counts[d.key] ? counts[d.key] : ''}
              onChange={e => {
                const n = parseInt(e.target.value, 10);
                setCounts(prev => ({ ...prev, [d.key]: isNaN(n) || n < 0 ? 0 : n }));
              }}
              placeholder="0"
              min="0"
              disabled={isLockedForStore}
            />
            <div className={styles.subtotal}>₹{((counts[d.key] || 0) * d.value).toLocaleString('en-IN')}</div>
          </div>
        ))}
      </div>

      <div className={styles.totalArea} style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <div className={styles.totalLabel}>Total</div>
        <div className={styles.totalAmount}>₹{total.toLocaleString('en-IN')}</div>
      </div>

      <div className={styles.submitArea} style={{ maxWidth: '600px', margin: '0 auto' }}>
        {isLockedForStore ? (
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
            Count locked (₹{total.toLocaleString('en-IN')})
          </div>
        ) : (
          <button className={styles.button} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving...' : hasSavedTally && isSuperAdminOrAdmin ? `Update ${mode === 'morning' ? 'Morning' : 'Evening'} Cash` : `Save ${mode === 'morning' ? 'Morning' : 'Evening'} Cash`}
          </button>
        )}
      </div>

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
