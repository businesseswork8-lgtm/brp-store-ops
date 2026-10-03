'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../store.module.css';
import { DENOMINATIONS } from '@/lib/types';

type StaffMember = {
  id: string;
  name: string;
};

export default function CashTallyPage() {
  const [mode, setMode] = useState<'morning' | 'evening'>('morning');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  const [recordId, setRecordId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  const supabase = createClient();
  const todayDate = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const init = async () => {
      let storedStoreId = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');
      if (!storedStoreId) {
        const { data: stores } = await supabase.from('stores').select('id').order('name');
        if (stores && stores.length > 0) {
          storedStoreId = stores[0].id;
        }
      }
      if (!storedStoreId) {
        setLoading(false);
        return;
      }
      localStorage.setItem('selectedStore', storedStoreId);
      localStorage.setItem('brp_selected_store', storedStoreId);
      setStoreId(storedStoreId);

      try {
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('id, name')
          .eq('store_id', storedStoreId)
          .eq('is_active', true);
        if (staffData) setStaffList(staffData);

        fetchTally(storedStoreId, mode);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [supabase, mode]);

  const fetchTally = async (sId: string, currentMode: string) => {
    const { data } = await supabase
      .from('daily_cash_tally')
      .select('*')
      .eq('store_id', sId)
      .eq('entry_date', todayDate)
      .eq('tally_type', currentMode)
      .single();

    if (data) {
      setRecordId(data.id);
      setSelectedStaff(data.staff_member_id || '');
      const initialCounts: Record<string, number> = {};
      DENOMINATIONS.forEach(d => {
        initialCounts[d.key] = data[d.key] || 0;
      });
      setCounts(initialCounts);
    } else {
      setRecordId(null);
      setCounts({});
    }
  };

  const handleCountChange = (denomKey: string, val: string) => {
    const num = parseInt(val, 10);
    setCounts(prev => ({
      ...prev,
      [denomKey]: isNaN(num) ? 0 : num
    }));
  };

  const calculateTotal = () => {
    let total = 0;
    DENOMINATIONS.forEach(d => {
      total += (counts[d.key] || 0) * d.value;
    });
    return total;
  };

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleSubmit = async () => {
    if (!selectedStaff) {
      showToast('Please select a staff member', 'error');
      return;
    }
    setSubmitting(true);
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const profileId = user?.id;

      const total_amount = calculateTotal();
      const payload: any = {
        store_id: storeId,
        entry_date: todayDate,
        tally_type: mode,
        staff_member_id: selectedStaff,
        submitted_by_profile_id: profileId,
        total_amount,
      };

      DENOMINATIONS.forEach(d => {
        payload[d.key] = counts[d.key] || 0;
      });

      if (recordId) {
        payload.id = recordId;
      }

      const { error, data } = await supabase.from('daily_cash_tally').upsert(payload).select().single();

      if (error) throw error;
      if (data) setRecordId(data.id);
      showToast('Cash tally saved successfully', 'success');

    } catch (error) {
      console.error(error);
      showToast('Failed to save tally', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className={styles.spinner}></div>;
  if (!storeId) return <div className={styles.container}>Please select a store.</div>;

  const totalAmount = calculateTotal();

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Cash Tally</h1>
      </header>

      <div className={styles.tabs}>
        <button 
          className={`${styles.tab} ${mode === 'morning' ? styles.active : ''}`}
          onClick={() => { setMode('morning'); fetchTally(storeId, 'morning'); }}
        >
          Morning Shift
        </button>
        <button 
          className={`${styles.tab} ${mode === 'evening' ? styles.active : ''}`}
          onClick={() => { setMode('evening'); fetchTally(storeId, 'evening'); }}
        >
          Evening Shift
        </button>
      </div>

      <div className={styles.controls} style={{ maxWidth: '600px', margin: '0 auto 2rem' }}>
        <select 
          className={styles.select}
          value={selectedStaff}
          onChange={(e) => setSelectedStaff(e.target.value)}
        >
          <option value="">Select Staff Member...</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className={styles.cashGrid}>
        {DENOMINATIONS.map(d => (
          <div key={d.key} className={styles.cashRow}>
            <div className={styles.denomination}>{d.label}</div>
            <input 
              type="number"
              className={styles.input}
              value={counts[d.key] || ''}
              onChange={(e) => handleCountChange(d.key, e.target.value)}
              placeholder="Count"
              min="0"
            />
            <div className={styles.subtotal}>
              ₹{((counts[d.key] || 0) * d.value).toLocaleString('en-IN')}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.totalArea} style={{ maxWidth: '600px', margin: '2rem auto' }}>
        <div className={styles.totalLabel}>Total Amount</div>
        <div className={styles.totalAmount}>₹{totalAmount.toLocaleString('en-IN')}</div>
      </div>

      <div className={styles.submitArea} style={{ maxWidth: '600px', margin: '0 auto' }}>
        <button 
          className={styles.button}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : `Save ${mode === 'morning' ? 'Morning' : 'Evening'} Tally`}
        </button>
      </div>

      {toast && (
        <div className={`${styles.toast} ${styles[toast.type]}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

