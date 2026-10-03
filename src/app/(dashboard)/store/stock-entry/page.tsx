'use client';

import React, { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import styles from '../store.module.css';

type Item = {
  id: string;
  name: string;
  uom: string;
  category_id: string;
  item_categories?: {
    name: string;
    sort_order: number;
  };
};

type StockEntry = {
  id?: string;
  item_id: string;
  opening_stock: string | number;
  closing_stock: string | number | null;
  today_opening?: number | null; // UI helper for closing mode
};

type StaffMember = {
  id: string;
  name: string;
};

export default function StockEntryPage() {
  const [mode, setMode] = useState<'opening' | 'closing'>('opening');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  
  const [items, setItems] = useState<Item[]>([]);
  const [entries, setEntries] = useState<Record<string, StockEntry>>({});
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<string>('');
  
  const [toast, setToast] = useState<{message: string, type: 'success' | 'error'} | null>(null);

  const supabase = createClient();
  const todayDate = new Date().toISOString().split('T')[0];

  useEffect(() => {
    const init = async () => {
      const storedStoreId = localStorage.getItem('brp_selected_store');
      if (!storedStoreId) {
        setLoading(false);
        return;
      }
      setStoreId(storedStoreId);

      try {
        // Fetch active staff
        const { data: staffData } = await supabase
          .from('staff_members')
          .select('id, name')
          .eq('store_id', storedStoreId)
          .eq('is_active', true);
        if (staffData) setStaffList(staffData);

        // Fetch daily tracked items
        const { data: itemsData } = await supabase
          .from('items')
          .select(`
            id, name, uom, category_id,
            item_categories(name, sort_order)
          `)
          .eq('is_active', true)
          .eq('is_daily_tracked', true);
        
        if (itemsData) {
          const sortedItems = (itemsData as unknown as Item[]).sort((a, b) => {
            const orderA = a.item_categories?.sort_order ?? 999;
            const orderB = b.item_categories?.sort_order ?? 999;
            return orderA - orderB;
          });
          setItems(sortedItems);
        }

        fetchDataForMode(mode, storedStoreId, (itemsData as unknown as Item[]) || []);
      } catch (error) {
        console.error(error);
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [supabase, mode]);

  const fetchDataForMode = async (currentMode: 'opening' | 'closing', sId: string, currentItems: Item[]) => {
    // Fetch today's entries
    const { data: todayEntries } = await supabase
      .from('daily_stock_entries')
      .select('*')
      .eq('store_id', sId)
      .eq('entry_date', todayDate);

    const entriesMap: Record<string, StockEntry> = {};

    if (currentMode === 'opening') {
      // Pre-fill with previous day's closing stock if today doesn't exist
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];
      
      const { data: yesterdayEntries } = await supabase
        .from('daily_stock_entries')
        .select('*')
        .eq('store_id', sId)
        .eq('entry_date', yesterdayDate);

      currentItems.forEach(item => {
        const todayEntry = todayEntries?.find(e => e.item_id === item.id);
        const ydayEntry = yesterdayEntries?.find(e => e.item_id === item.id);
        entriesMap[item.id] = {
          id: todayEntry?.id,
          item_id: item.id,
          opening_stock: todayEntry ? todayEntry.opening_stock : (ydayEntry?.closing_stock || ''),
          closing_stock: todayEntry?.closing_stock || null,
        };
      });
    } else {
      // Closing mode
      currentItems.forEach(item => {
        const todayEntry = todayEntries?.find(e => e.item_id === item.id);
        entriesMap[item.id] = {
          id: todayEntry?.id,
          item_id: item.id,
          opening_stock: todayEntry?.opening_stock || '',
          closing_stock: todayEntry?.closing_stock || '',
          today_opening: todayEntry ? Number(todayEntry.opening_stock) : null,
        };
      });
    }
    
    setEntries(entriesMap);
  };

  const handleInputChange = (itemId: string, value: string) => {
    setEntries(prev => ({
      ...prev,
      [itemId]: {
        ...prev[itemId],
        [mode === 'opening' ? 'opening_stock' : 'closing_stock']: value,
      }
    }));
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

      const upsertData = items.map(item => {
        const entry = entries[item.id];
        return {
          id: entry.id || undefined, // undefined will create new record
          store_id: storeId,
          item_id: item.id,
          entry_date: todayDate,
          opening_stock: Number(entry.opening_stock) || 0,
          closing_stock: entry.closing_stock ? Number(entry.closing_stock) : null,
          staff_member_id: selectedStaff,
          submitted_by_profile_id: profileId,
        };
      });

      const { error } = await supabase.from('daily_stock_entries').upsert(upsertData, {
        onConflict: 'store_id, item_id, entry_date'
      });

      if (error) throw error;
      showToast('Stock entries saved successfully', 'success');
      
      // Update entry IDs after insert
      fetchDataForMode(mode, storeId!, items);

    } catch (error) {
      console.error(error);
      showToast('Failed to save entries', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <div className={styles.spinner}></div>;
  if (!storeId) return <div className={styles.container}>Please select a store.</div>;

  // Group items by category
  const groupedItems = items.reduce((acc, item) => {
    const catName = item.item_categories?.name || 'Uncategorized';
    if (!acc[catName]) acc[catName] = [];
    acc[catName].push(item);
    return acc;
  }, {} as Record<string, Item[]>);

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>Stock Entry</h1>
      </header>

      <div className={styles.tabs}>
        <button 
          className={`${styles.tab} ${mode === 'opening' ? styles.active : ''}`}
          onClick={() => { setMode('opening'); fetchDataForMode('opening', storeId, items); }}
        >
          Opening Stock
        </button>
        <button 
          className={`${styles.tab} ${mode === 'closing' ? styles.active : ''}`}
          onClick={() => { setMode('closing'); fetchDataForMode('closing', storeId, items); }}
        >
          Closing Stock
        </button>
      </div>

      <div className={styles.controls}>
        <select 
          className={styles.select}
          value={selectedStaff}
          onChange={(e) => setSelectedStaff(e.target.value)}
        >
          <option value="">Select Staff Member...</option>
          {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className={styles.formContainer}>
        {Object.entries(groupedItems).map(([category, catItems]) => (
          <div key={category} className={styles.categorySection}>
            <h2 className={styles.categoryHeader}>{category}</h2>
            <div className={styles.itemGrid}>
              {catItems.map(item => {
                const entry = entries[item.id];
                const val = mode === 'opening' ? entry?.opening_stock : entry?.closing_stock;
                const showConsumption = mode === 'closing' && entry?.today_opening !== null;
                const consumption = showConsumption ? Number(entry?.today_opening) - Number(val || 0) : null;

                return (
                  <div key={item.id} className={styles.itemRow}>
                    <div className={styles.itemInfo}>
                      <span className={styles.itemName}>{item.name}</span>
                      <span className={styles.badge}>{item.uom}</span>
                    </div>
                    {mode === 'closing' && (
                      <div style={{ color: 'var(--text-secondary)' }}>
                        Opening: {entry?.today_opening ?? '-'}
                      </div>
                    )}
                    <input 
                      type="number"
                      className={styles.input}
                      value={val || ''}
                      onChange={(e) => handleInputChange(item.id, e.target.value)}
                      placeholder={mode === 'opening' ? 'Opening qty' : 'Closing qty'}
                    />
                    {showConsumption && (
                      <div style={{ color: consumption && consumption < 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                        Used: {consumption}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className={styles.submitArea}>
        <button 
          className={styles.button}
          onClick={handleSubmit}
          disabled={submitting}
        >
          {submitting ? 'Saving...' : `Save ${mode === 'opening' ? 'Opening' : 'Closing'} Stock`}
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
