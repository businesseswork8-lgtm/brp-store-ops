'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { StockTabs } from '@/components/store/StockTabs';
import { displayUnit, fromDisplay, toDisplay } from '@/lib/stock/units';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatTime } from '@/lib/dates';
import { isBRStore } from '@/lib/br';
import { FULL_BOX_GRAMS } from '@/lib/icecream';

const MOVES = [
  { v: 'received', label: 'Received from warehouse' },
  { v: 'transfer_in', label: 'Transfer IN (from another store)' },
  { v: 'transfer_out', label: 'Transfer OUT (to another store)' },
] as const;
type Move = typeof MOVES[number]['v'];

type Item = {
  id: string;
  name: string;
  uom: string;
  tare_grams: number;
  rista_unit: string | null;
};

type StaffMember = { id: string; name: string };

type Delivery = {
  id: string;
  store_id: string;
  item_id: string;
  entry_date: string;
  quantity: number;
  boxes: number | null;
  movement?: Move | string;
  created_at: string;
  po_reference: string | null;
  staff_member_id: string | null;
  items: { id?: string; name: string; uom: string; tare_grams?: number; rista_unit: string | null } | null;
  staff_members: { id?: string; name: string } | null;
};

type EditModalState = {
  id: string;
  itemName: string;
  isBox: boolean;
  unit: string;
  entry_date: string;
  qty: string;
  movement: Move;
  staff_member_id: string;
  po_reference: string;
};

export default function DeliveriesPage() {
  const { supabase, store, profile, loading: storeLoading } = useActiveStore();
  const [items, setItems] = useState<Item[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [allDeliveries, setAllDeliveries] = useState<Delivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Permission check: Only Admin, Super Admin, or users with can_edit can edit / delete or backdate
  const canEdit = profile?.role === 'admin' || profile?.role === 'super_admin' || profile?.can_edit === true;

  const today = istDate();

  // Active view:
  // 'today' = Quick entry for Today's shift
  // 'dates' = List of all dates on which stock was received
  // 'date_detail' = Details of deliveries for a specific chosen date
  const [viewMode, setViewMode] = useState<'today' | 'dates' | 'date_detail'>('dates');
  const [selectedDate, setSelectedDate] = useState<string>(today);

  // Entry form state (when logging new stock for selectedDate)
  const [showAddForm, setShowAddForm] = useState(false);
  const [move, setMove] = useState<Move>('received');
  const [staff, setStaff] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});

  // Search filter for dates list
  const [dateSearch, setDateSearch] = useState('');

  // Date picker for manually adding a delivery to a past date
  const [customNewDate, setCustomNewDate] = useState('');

  // Edit record state (Admin only)
  const [editItem, setEditItem] = useState<EditModalState | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);

  // Feedback toast
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  };

  const isBox = useCallback((i: { tare_grams?: number; boxes?: number | null }) => {
    if (i.boxes !== null && i.boxes !== undefined) return true;
    return Number(i.tare_grams || 0) > 0;
  }, []);

  // Fetch all deliveries for the store (to list all dates stock was received)
  const fetchDeliveries = useCallback(async (storeId: string) => {
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, store_id, item_id, entry_date, quantity, boxes, movement, created_at, po_reference, staff_member_id, items(id, name, uom, tare_grams, rista_unit), staff_members(id, name)')
      .eq('store_id', storeId)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3000);

    if (error) {
      console.error('Error fetching deliveries:', error);
      showToast('Could not load deliveries: ' + error.message, 'error');
    }
    setAllDeliveries((data || []) as unknown as Delivery[]);
  }, [supabase]);

  // Initial load
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

    const br = isBRStore(store);
    const rows = (itemRows || []).filter(i => !br || (i as unknown as { item_categories: { is_flavour: boolean } }).item_categories?.is_flavour);
    setStaffList(st || []);
    setItems(rows.map(i => ({ id: i.id, name: i.name, uom: i.uom, tare_grams: Number(i.tare_grams) || 0, rista_unit: i.rista_unit })));

    await fetchDeliveries(store.id);
    setLoading(false);
  }, [supabase, store, fetchDeliveries]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id]);

  // Group deliveries by entry_date to show all dates stock was received
  const dateGroups = useMemo(() => {
    const map = new Map<string, Delivery[]>();
    for (const d of allDeliveries) {
      const arr = map.get(d.entry_date) || [];
      arr.push(d);
      map.set(d.entry_date, arr);
    }
    const groups = Array.from(map.entries()).map(([date, entries]) => {
      const totalBoxes = entries.reduce((sum, i) => sum + (i.boxes || 0), 0);
      const totalQuantity = entries.reduce((sum, i) => sum + Number(i.quantity || 0), 0);
      const receivers = Array.from(new Set(entries.map(i => i.staff_members?.name).filter(Boolean))) as string[];
      const notes = Array.from(new Set(entries.map(i => i.po_reference).filter(Boolean))) as string[];
      return {
        date,
        entries,
        count: entries.length,
        totalBoxes,
        totalKg: totalQuantity / 1000,
        receivers,
        notes,
      };
    });
    // Sort newest date first
    groups.sort((a, b) => b.date.localeCompare(a.date));
    return groups;
  }, [allDeliveries]);

  // Filtered dates based on search
  const filteredDateGroups = useMemo(() => {
    const s = dateSearch.trim().toLowerCase();
    if (!s) return dateGroups;
    return dateGroups.filter(g => {
      if (g.date.includes(s) || displayDate(g.date).toLowerCase().includes(s)) return true;
      if (g.receivers.some(r => r.toLowerCase().includes(s))) return true;
      if (g.notes.some(n => n.toLowerCase().includes(s))) return true;
      if (g.entries.some(e => (e.items?.name || '').toLowerCase().includes(s))) return true;
      return false;
    });
  }, [dateGroups, dateSearch]);

  // Deliveries for the currently selected date
  const selectedDateEntries = useMemo(() => {
    return allDeliveries.filter(d => d.entry_date === selectedDate);
  }, [allDeliveries, selectedDate]);

  // Drill into a specific date
  const handleOpenDate = (date: string) => {
    setSelectedDate(date);
    setViewMode('date_detail');
    setShowAddForm(false);
    setQty({});
    setSearch('');
  };

  const filledIds = Object.keys(qty).filter(id => (qty[id] ?? '').trim() !== '');

  // Save new items for selectedDate
  const saveAll = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who received it', 'error'); return; }
    if (!filledIds.length) { showToast('Type a number next to at least one item', 'error'); return; }

    const entryDateToUse = selectedDate;

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
        entry_date: entryDateToUse,
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
      const boxesCount = rows.reduce((t, r) => t + (r.boxes || 0), 0);
      showToast(`${rows.length} item${rows.length > 1 ? 's' : ''} saved for ${shortDate(entryDateToUse)}${boxesCount ? ` · ${boxesCount} boxes` : ''}`, 'success');
      setQty({});
      setNote('');
      setShowAddForm(false);
      await fetchDeliveries(store.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not save. Please try again.';
      showToast(/row-level security/i.test(m) ? 'Permission error or day locked. Ask your manager.' : m, 'error');
    } finally {
      setSaving(false);
    }
  };

  // Open edit modal for any record (Admin only)
  const startEdit = (d: Delivery) => {
    if (!canEdit) {
      showToast('Only Admin or Super Admin can edit delivery records.', 'error');
      return;
    }
    const isBoxItem = d.boxes !== null || (d.items && Number(d.items.tare_grams || 0) > 0);
    const unit = isBoxItem ? 'boxes' : d.items ? displayUnit(d.items.rista_unit, d.items.uom) : '';
    const shownQty = d.boxes !== null
      ? d.boxes
      : d.items
      ? toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom)
      : d.quantity;

    setEditItem({
      id: d.id,
      itemName: d.items?.name || 'Item',
      isBox: Boolean(isBoxItem),
      unit,
      entry_date: d.entry_date || today,
      qty: String(shownQty),
      movement: (d.movement as Move) || 'received',
      staff_member_id: d.staff_member_id || d.staff_members?.id || '',
      po_reference: d.po_reference || '',
    });
  };

  // Save changes to edited record (Admin only)
  const saveEditedItem = async () => {
    if (!canEdit) {
      showToast('Only Admin or Super Admin can edit delivery records.', 'error');
      return;
    }
    if (!editItem || !store) return;
    const raw = (editItem.qty || '').trim();
    const n = Number(raw);
    if (raw === '' || isNaN(n) || n <= 0) {
      showToast('Enter a number above 0 (or delete the entry)', 'error');
      return;
    }
    if (editItem.isBox && !Number.isInteger(n)) {
      showToast('Enter whole boxes for ice cream', 'error');
      return;
    }
    if (!editItem.entry_date) {
      showToast('Please select a valid date', 'error');
      return;
    }

    setSavingEdit(true);
    try {
      const matchingItem = items.find(i => i.name === editItem.itemName);
      const ristaUnit = matchingItem?.rista_unit || null;
      const uom = matchingItem?.uom || 'grams';
      const quantity = editItem.isBox ? n * FULL_BOX_GRAMS : fromDisplay(n, ristaUnit, uom);

      const { error } = await supabase
        .from('purchase_orders')
        .update({
          quantity,
          boxes: editItem.isBox ? n : null,
          entry_date: editItem.entry_date,
          movement: editItem.movement,
          staff_member_id: editItem.staff_member_id || null,
          po_reference: editItem.po_reference.trim() || null,
        })
        .eq('id', editItem.id);

      if (error) throw error;

      showToast(`Updated ${editItem.itemName} (${shortDate(editItem.entry_date)})`, 'success');
      setEditItem(null);
      await fetchDeliveries(store.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not update delivery.';
      showToast(/row-level security/i.test(m) ? 'Permission error or day locked. Ask your manager.' : m, 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  // Delete delivery entry (Admin only)
  const remove = async (d: Delivery) => {
    if (!canEdit) {
      showToast('Only Admin or Super Admin can delete delivery records.', 'error');
      return;
    }
    if (!store || !confirm(`Delete delivery of ${d.items?.name || 'this item'} on ${shortDate(d.entry_date)}?`)) return;
    try {
      const { error } = await supabase.from('purchase_orders').delete().eq('id', d.id);
      if (error) throw error;
      showToast('Delivery entry removed', 'success');
      await fetchDeliveries(store.id);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not delete.';
      showToast(/row-level security/i.test(m) ? 'Permission error or day locked. Ask your manager.' : m, 'error');
    }
  };

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const term = search.trim().toLowerCase();
  const shown = items.filter(i => !term || i.name.toLowerCase().includes(term));
  const anyBox = items.some(isBox);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>🚚 Stock Received &amp; Deliveries</h1>
          <p className={styles.subtitle}>
            {store.name} · View dates stock was received, browse individual deliveries, or record arrivals
          </p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <StockTabs />

      {/* Main Mode Navigation Bar */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => {
            setViewMode('dates');
            setShowAddForm(false);
          }}
          style={{
            padding: '0.55rem 1.25rem',
            borderRadius: '8px',
            border: viewMode === 'dates' || viewMode === 'date_detail' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            background: viewMode === 'dates' || viewMode === 'date_detail' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: viewMode === 'dates' || viewMode === 'date_detail' ? '#fff' : 'var(--text-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>📅</span>
          <span>Dates Stock Received ({dateGroups.length} days)</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setSelectedDate(today);
            setViewMode('today');
            setShowAddForm(true);
          }}
          style={{
            padding: '0.55rem 1.25rem',
            borderRadius: '8px',
            border: viewMode === 'today' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            background: viewMode === 'today' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: viewMode === 'today' ? '#fff' : 'var(--text-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>📥</span>
          <span>Receive Today&apos;s Stock</span>
        </button>

        {canEdit && (
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#ffb74d', fontWeight: 600, background: 'rgba(255,160,0,0.12)', padding: '0.3rem 0.65rem', borderRadius: '6px' }}>
            👑 Admin Editing Enabled
          </span>
        )}
      </div>

      {/* VIEW 1: LIST OF ALL DATES STOCK WAS RECEIVED */}
      {viewMode === 'dates' && (
        <div className={styles.card} style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h2 className={styles.title} style={{ fontSize: '1.3rem', margin: 0 }}>📅 All Dates Stock Was Received</h2>
              <p className={styles.subtitle}>Click any date below to see all flavours and quantities received on that day</p>
            </div>

            {/* Quick date picker to log missing delivery for a past date */}
            {canEdit && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Log missing date:</span>
                <input
                  type="date"
                  value={customNewDate}
                  max={today}
                  onChange={e => setCustomNewDate(e.target.value)}
                  style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.84rem' }}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!customNewDate) {
                      showToast('Please pick a date first', 'error');
                      return;
                    }
                    handleOpenDate(customNewDate);
                    setShowAddForm(true);
                  }}
                  style={{
                    padding: '0.45rem 0.9rem',
                    background: 'var(--accent-primary)',
                    color: '#fff',
                    border: 'none',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.84rem',
                  }}
                >
                  + Add Stock for Date
                </button>
              </div>
            )}
          </div>

          {/* Search bar */}
          <div style={{ marginBottom: '1.25rem' }}>
            <input
              type="text"
              className={styles.input}
              placeholder="Search by date (e.g. 24 Oct), flavour name, receiver, or challan…"
              value={dateSearch}
              onChange={e => setDateSearch(e.target.value)}
            />
          </div>

          {/* List of Dates */}
          {filteredDateGroups.length === 0 ? (
            <div style={{ padding: '2.5rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <p style={{ fontSize: '1.05rem', margin: 0 }}>No delivery dates found{dateSearch ? ' matching your search' : ' yet'}.</p>
              <button
                type="button"
                onClick={() => {
                  setSelectedDate(today);
                  setViewMode('today');
                  setShowAddForm(true);
                }}
                style={{
                  marginTop: '1rem',
                  padding: '0.55rem 1.25rem',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '6px',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                + Record Today&apos;s Stock
              </button>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '0.85rem' }}>
              {filteredDateGroups.map(group => {
                const isToday = group.date === today;
                return (
                  <div
                    key={group.date}
                    onClick={() => handleOpenDate(group.date)}
                    style={{
                      background: 'var(--bg-secondary)',
                      border: isToday ? '1px solid rgba(0,200,83,0.35)' : '1px solid var(--border-color)',
                      borderRadius: '10px',
                      padding: '1.1rem 1.35rem',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease-in-out',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.borderColor = 'var(--accent-primary)')}
                    onMouseLeave={e => (e.currentTarget.style.borderColor = isToday ? 'rgba(0,200,83,0.35)' : 'var(--border-color)')}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
                        <span style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                          {displayDate(group.date)}
                        </span>
                        {isToday && (
                          <span style={{ fontSize: '0.72rem', padding: '0.15rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,83,0.18)', color: '#69f0ae', fontWeight: 600 }}>
                            Today / Active Shift
                          </span>
                        )}
                      </div>

                      <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.35rem', fontSize: '0.88rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--accent-primary)', fontWeight: 600 }}>
                          📦 {group.count} item{group.count === 1 ? '' : 's'}
                        </span>
                        {group.totalBoxes > 0 && (
                          <span style={{ fontWeight: 600 }}>
                            🍨 {group.totalBoxes} packed box{group.totalBoxes === 1 ? '' : 'es'} ({group.totalKg.toFixed(2)} kg)
                          </span>
                        )}
                        {group.receivers.length > 0 && (
                          <span>👤 Received by {group.receivers.join(', ')}</span>
                        )}
                        {group.notes.length > 0 && (
                          <span style={{ color: 'var(--text-secondary)' }}>📝 {group.notes.join(' · ')}</span>
                        )}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontSize: '0.9rem', color: 'var(--accent-primary)', fontWeight: 600 }}>
                        View Stock →
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* VIEW 2: DETAILS OF DELIVERIES FOR THE SELECTED DATE */}
      {viewMode === 'date_detail' && (
        <div>
          {/* Back button and Date Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <button
              type="button"
              onClick={() => setViewMode('dates')}
              style={{
                background: 'transparent',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                cursor: 'pointer',
                fontSize: '0.88rem',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontWeight: 600,
              }}
            >
              ← Back to All Dates
            </button>

            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setShowAddForm(!showAddForm)}
                  style={{
                    padding: '0.5rem 1.1rem',
                    borderRadius: '8px',
                    background: showAddForm ? 'var(--bg-secondary)' : 'var(--accent-primary)',
                    color: '#fff',
                    border: '1px solid var(--border-color)',
                    fontWeight: 600,
                    cursor: 'pointer',
                    fontSize: '0.88rem',
                  }}
                >
                  {showAddForm ? '✕ Close Entry Form' : `+ Add Missing Item to ${shortDate(selectedDate)}`}
                </button>
              )}
            </div>
          </div>

          {/* Date Summary Card */}
          <div className={styles.card} style={{
            marginBottom: '1.5rem',
            padding: '1.25rem 1.5rem',
            background: 'linear-gradient(90deg, rgba(95,107,255,0.10), rgba(0,200,83,0.05))',
            border: '1px solid rgba(95,107,255,0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
              <div>
                <span style={{ fontSize: '0.78rem', color: '#9aa4ff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Viewing Stock Received For:
                </span>
                <div style={{ fontSize: '1.35rem', fontWeight: 700, marginTop: '0.2rem' }}>
                  {displayDate(selectedDate)}
                  {selectedDate === today && (
                    <span style={{ marginLeft: '0.65rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,83,0.18)', color: '#69f0ae', fontWeight: 600 }}>
                      Active Shift
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Items Received</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{selectedDateEntries.length}</div>
                </div>
                {selectedDateEntries.some(d => (d.boxes || 0) > 0) && (
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Boxes</div>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--accent-primary)' }}>
                      {selectedDateEntries.reduce((s, d) => s + (d.boxes || 0), 0)}
                    </div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Weight</div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                    {(selectedDateEntries.reduce((s, d) => s + Number(d.quantity || 0), 0) / 1000).toFixed(2)} kg
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Form to add missing items to this specific date */}
          {showAddForm && (
            <div className={styles.card} style={{ padding: '1.5rem', marginBottom: '2rem', border: '1px solid var(--accent-primary)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--accent-primary)' }}>
                  ✍️ Add Items Received on {displayDate(selectedDate)}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowAddForm(false)}
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', fontSize: '1.1rem' }}
                >
                  ✕
                </button>
              </div>

              <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
                <select className={styles.select} value={move} onChange={e => setMove(e.target.value as Move)}>
                  {MOVES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
                <select className={styles.select} value={staff} onChange={e => setStaff(e.target.value)}>
                  <option value="">Who received it? *</option>
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <input
                  type="text"
                  className={styles.input}
                  style={{ flex: 1, minWidth: 160 }}
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Challan # / PO Note (optional)"
                />
              </div>

              <input
                className={styles.input}
                style={{ width: '100%', marginBottom: '1rem' }}
                placeholder="Search flavour / item to enter…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />

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
                        <input
                          type="number"
                          inputMode={isBox(i) ? 'numeric' : 'decimal'}
                          min="0"
                          step={isBox(i) ? 1 : 'any'}
                          className={styles.input}
                          value={v}
                          placeholder="0"
                          aria-label={`${i.name} ${isBox(i) ? 'packed boxes' : 'quantity'} received`}
                          onChange={e => setQty(q => ({ ...q, [i.id]: e.target.value }))}
                        />
                        {isBox(i) && v.trim() !== '' && n > 0 && (
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                            = {(n * FULL_BOX_GRAMS / 1000).toFixed(2)} kg
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className={styles.submitArea} style={{ marginTop: '1.25rem' }}>
                <p className={styles.statusText}>{filledIds.length} item{filledIds.length === 1 ? '' : 's'} entered for {shortDate(selectedDate)}</p>
                <button className={styles.button} onClick={saveAll} disabled={saving || !filledIds.length}>
                  {saving ? 'Saving…' : `Save ${filledIds.length || ''} item${filledIds.length === 1 ? '' : 's'} for ${shortDate(selectedDate)}`}
                </button>
              </div>
            </div>
          )}

          {/* Table of all items received on this day */}
          <div className={styles.card} style={{ padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.2rem' }}>
              Stock Received on this Day ({selectedDateEntries.length} entries)
            </h3>

            {selectedDateEntries.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p style={{ margin: 0 }}>No stock was recorded for this day yet.</p>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => setShowAddForm(true)}
                    style={{
                      marginTop: '0.75rem',
                      padding: '0.5rem 1rem',
                      background: 'var(--accent-primary)',
                      color: '#fff',
                      border: 'none',
                      borderRadius: '6px',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    + Add Missing Delivery for this Day
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Flavour / Item</th>
                      <th>Type</th>
                      <th>Quantity Received</th>
                      <th>Received By</th>
                      <th>Challan / Note</th>
                      {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDateEntries.map(d => {
                      const isBoxItem = d.boxes !== null || (d.items && Number(d.items.tare_grams || 0) > 0);
                      const shownQty = d.boxes !== null ? d.boxes : d.items ? toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom) : d.quantity;
                      const unit = isBoxItem ? 'boxes' : d.items ? displayUnit(d.items.rista_unit, d.items.uom) : '';
                      return (
                        <tr key={d.id}>
                          <td>{formatTime(d.created_at)}</td>
                          <td style={{ fontWeight: 600 }}>{d.items?.name || '—'}</td>
                          <td>
                            <span className={styles.badge} style={{ background: d.movement === 'transfer_out' ? 'rgba(255,23,68,0.15)' : 'rgba(0,200,83,0.12)', color: d.movement === 'transfer_out' ? 'var(--danger)' : 'var(--success)' }}>
                              {d.movement === 'transfer_out' ? 'Transfer out' : d.movement === 'transfer_in' ? 'Transfer in' : 'Received'}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {shownQty} {unit}
                            {isBoxItem && <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '0.4rem', fontSize: '0.85rem' }}>= {(Number(d.quantity) / 1000).toFixed(2)} kg</span>}
                          </td>
                          <td>{d.staff_members?.name || '—'}</td>
                          <td style={{ color: d.po_reference ? 'inherit' : 'var(--text-secondary)' }}>{d.po_reference || '—'}</td>
                          {canEdit && (
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => startEdit(d)}
                                style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', marginRight: '0.85rem', fontWeight: 600 }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => remove(d)}
                                style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* VIEW 3: TODAY'S STOCK ENTRY (Quick entry for active shift) */}
      {viewMode === 'today' && (
        <>
          <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
            When stock arrives today, type the quantity next to <strong>every item that was received</strong> and press Save once.
            {anyBox && <> Ice cream: enter number of <strong>packed boxes</strong> (1 box = {FULL_BOX_GRAMS} g).</>}
          </p>

          <div className={styles.controls} style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <select className={styles.select} value={move} onChange={e => setMove(e.target.value as Move)}>
              {MOVES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
            </select>
            <select className={styles.select} value={staff} onChange={e => setStaff(e.target.value)}>
              <option value="">Who received it? *</option>
              {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input
              type="text"
              className={styles.input}
              style={{ flex: 1, minWidth: 160 }}
              value={note}
              onChange={e => setNote(e.target.value)}
              placeholder="Challan # / PO Note (optional)"
            />
          </div>

          <input
            className={styles.input}
            style={{ width: '100%', marginBottom: '1rem' }}
            placeholder="Search flavour / item to enter…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />

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
                    <input
                      type="number"
                      inputMode={isBox(i) ? 'numeric' : 'decimal'}
                      min="0"
                      step={isBox(i) ? 1 : 'any'}
                      className={styles.input}
                      value={v}
                      placeholder="0"
                      aria-label={`${i.name} ${isBox(i) ? 'packed boxes' : 'quantity'} received`}
                      onChange={e => setQty(q => ({ ...q, [i.id]: e.target.value }))}
                    />
                    {isBox(i) && v.trim() !== '' && n > 0 && (
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                        = {(n * FULL_BOX_GRAMS / 1000).toFixed(2)} kg
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {items.length > 0 && (
            <div className={styles.submitArea} style={{ marginTop: '1.25rem' }}>
              <p className={styles.statusText}>{filledIds.length} item{filledIds.length === 1 ? '' : 's'} entered for {shortDate(today)}</p>
              <button className={styles.button} onClick={saveAll} disabled={saving || !filledIds.length}>
                {saving ? 'Saving…' : `Save ${filledIds.length || ''} item${filledIds.length === 1 ? '' : 's'} for ${shortDate(today)}`}
              </button>
            </div>
          )}

          {/* Today's Entries Table */}
          <div className={styles.tableContainer} style={{ marginTop: '2.5rem' }}>
            <h2 className={styles.title} style={{ fontSize: '1.25rem', marginBottom: '1rem' }}>
              Received Today ({selectedDateEntries.length})
            </h2>

            {selectedDateEntries.length === 0 ? (
              <p className={styles.statusText}>Nothing received today yet.</p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Flavour / Item</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>By</th>
                      <th>Challan / Note</th>
                      {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDateEntries.map(d => {
                      const isBoxItem = d.boxes !== null || (d.items && Number(d.items.tare_grams || 0) > 0);
                      const shownQty = d.boxes !== null ? d.boxes : d.items ? toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom) : d.quantity;
                      const unit = isBoxItem ? 'boxes' : d.items ? displayUnit(d.items.rista_unit, d.items.uom) : '';
                      return (
                        <tr key={d.id}>
                          <td>{formatTime(d.created_at)}</td>
                          <td style={{ fontWeight: 600 }}>{d.items?.name || '—'}</td>
                          <td>
                            <span className={styles.badge} style={{ background: d.movement === 'transfer_out' ? 'rgba(255,23,68,0.15)' : 'rgba(0,200,83,0.12)', color: d.movement === 'transfer_out' ? 'var(--danger)' : 'var(--success)' }}>
                              {d.movement === 'transfer_out' ? 'Transfer out' : d.movement === 'transfer_in' ? 'Transfer in' : 'Received'}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {shownQty} {unit}
                            {isBoxItem && <span style={{ color: 'var(--text-secondary)', fontWeight: 400, marginLeft: '0.4rem', fontSize: '0.85rem' }}>= {(Number(d.quantity) / 1000).toFixed(2)} kg</span>}
                          </td>
                          <td>{d.staff_members?.name || '—'}</td>
                          <td style={{ color: d.po_reference ? 'inherit' : 'var(--text-secondary)' }}>{d.po_reference || '—'}</td>
                          {canEdit && (
                            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                              <button
                                onClick={() => startEdit(d)}
                                style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', cursor: 'pointer', marginRight: '0.85rem', fontWeight: 600 }}
                              >
                                Edit
                              </button>
                              <button
                                onClick={() => remove(d)}
                                style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontWeight: 600 }}
                              >
                                Delete
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* EDIT MODAL: Restricted to Admin & Super Admin */}
      {canEdit && editItem && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          padding: '1rem',
        }}>
          <div style={{
            background: 'var(--bg-card, #1a1a24)',
            border: '1px solid var(--border-color)',
            borderRadius: '12px',
            maxWidth: '520px',
            width: '100%',
            padding: '1.75rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.25rem', color: 'var(--text-primary)' }}>✏️ Update Delivery Record</h3>
                <div style={{ fontSize: '0.95rem', color: 'var(--accent-primary)', fontWeight: 600, marginTop: '0.25rem' }}>
                  {editItem.itemName}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-secondary)', fontSize: '1.25rem', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'grid', gap: '1rem' }}>
              {/* Day Received */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Received Date (Booking Day) *
                </label>
                <input
                  type="date"
                  className={styles.input}
                  value={editItem.entry_date}
                  max={today}
                  onChange={e => setEditItem({ ...editItem, entry_date: e.target.value })}
                  aria-label="Edit delivery date"
                />
              </div>

              {/* Quantity */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Quantity ({editItem.unit}) *
                </label>
                <input
                  type="number"
                  step={editItem.isBox ? 1 : 'any'}
                  min="0"
                  className={styles.input}
                  value={editItem.qty}
                  onChange={e => setEditItem({ ...editItem, qty: e.target.value })}
                  aria-label="Edit quantity"
                />
                {editItem.isBox && Number(editItem.qty) > 0 && (
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                    = {(Number(editItem.qty) * FULL_BOX_GRAMS / 1000).toFixed(2)} kg ice cream
                  </div>
                )}
              </div>

              {/* Movement Type */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Delivery Type
                </label>
                <select
                  className={styles.select}
                  value={editItem.movement}
                  onChange={e => setEditItem({ ...editItem, movement: e.target.value as Move })}
                >
                  {MOVES.map(m => <option key={m.v} value={m.v}>{m.label}</option>)}
                </select>
              </div>

              {/* Received By */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Who Received It
                </label>
                <select
                  className={styles.select}
                  value={editItem.staff_member_id}
                  onChange={e => setEditItem({ ...editItem, staff_member_id: e.target.value })}
                >
                  <option value="">Select staff member…</option>
                  {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>

              {/* Challan / Note */}
              <div>
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.35rem' }}>
                  Challan / PO Note (Optional)
                </label>
                <input
                  type="text"
                  className={styles.input}
                  value={editItem.po_reference}
                  onChange={e => setEditItem({ ...editItem, po_reference: e.target.value })}
                  placeholder="e.g. Challan #10492"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button
                type="button"
                onClick={() => setEditItem(null)}
                style={{
                  padding: '0.6rem 1.25rem',
                  borderRadius: '8px',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-primary)',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={saveEditedItem}
                disabled={savingEdit}
                style={{
                  padding: '0.6rem 1.5rem',
                  borderRadius: '8px',
                  background: 'var(--accent-primary)',
                  border: 'none',
                  color: '#fff',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                {savingEdit ? 'Updating…' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
