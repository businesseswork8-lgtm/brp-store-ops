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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Permission check: Only Admin, Super Admin, or users with can_edit can edit / delete past records or backdate
  const canEdit = profile?.role === 'admin' || profile?.role === 'super_admin' || profile?.can_edit === true;

  // Tab: 'entry' (record / view selected date) vs 'history' (search & view all past records across dates)
  // Both views are accessible to everyone, but editing is restricted to admins!
  const [activeTab, setActiveTab] = useState<'entry' | 'history'>('entry');

  const today = istDate();
  const yesterday = addDays(today, -1);

  // Entry date selection (Admins can pick any past date; store staff defaults to today)
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [loadingDeliveries, setLoadingDeliveries] = useState(false);

  // Entry form state
  const [move, setMove] = useState<Move>('received');
  const [staff, setStaff] = useState('');
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});

  // History / Past records state (Viewable by everyone!)
  const [historyFrom, setHistoryFrom] = useState<string>(addDays(today, -14));
  const [historyTo, setHistoryTo] = useState<string>(today);
  const [historyPreset, setHistoryPreset] = useState<'7d' | '14d' | '30d' | 'custom'>('14d');
  const [historyDeliveries, setHistoryDeliveries] = useState<Delivery[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historySearch, setHistorySearch] = useState('');
  const [historyMoveFilter, setHistoryMoveFilter] = useState<'all' | Move>('all');
  const [historyItemFilter, setHistoryItemFilter] = useState<string>('all');

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

  // Fetch single-day deliveries
  const loadDeliveries = useCallback(async (storeId: string, date: string) => {
    setLoadingDeliveries(true);
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, store_id, item_id, entry_date, quantity, boxes, movement, created_at, po_reference, staff_member_id, items(id, name, uom, tare_grams, rista_unit), staff_members(id, name)')
      .eq('store_id', storeId)
      .eq('entry_date', date)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching deliveries:', error);
    }
    setDeliveries((data || []) as unknown as Delivery[]);
    setLoadingDeliveries(false);
  }, [supabase]);

  // Fetch past records history
  const loadHistory = useCallback(async (storeId: string, fromDate: string, toDate: string) => {
    setLoadingHistory(true);
    const { data, error } = await supabase
      .from('purchase_orders')
      .select('id, store_id, item_id, entry_date, quantity, boxes, movement, created_at, po_reference, staff_member_id, items(id, name, uom, tare_grams, rista_unit), staff_members(id, name)')
      .eq('store_id', storeId)
      .gte('entry_date', fromDate)
      .lte('entry_date', toDate)
      .order('entry_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(1000);

    if (error) {
      console.error('Error fetching delivery history:', error);
      showToast('Could not load history: ' + error.message, 'error');
    }
    setHistoryDeliveries((data || []) as unknown as Delivery[]);
    setLoadingHistory(false);
  }, [supabase]);

  // Initial load of master items and staff
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

    await Promise.all([
      loadDeliveries(store.id, selectedDate),
      loadHistory(store.id, historyFrom, historyTo),
    ]);
    setLoading(false);
  }, [supabase, store, selectedDate, historyFrom, historyTo, loadDeliveries, loadHistory]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store?.id]);

  // Reload single-day deliveries when selectedDate changes
  useEffect(() => {
    if (store?.id) {
      loadDeliveries(store.id, selectedDate);
    }
  }, [store?.id, selectedDate, loadDeliveries]);

  // Apply history preset
  const handleApplyPreset = (preset: '7d' | '14d' | '30d') => {
    setHistoryPreset(preset);
    const days = preset === '7d' ? -7 : preset === '14d' ? -14 : -30;
    const newFrom = addDays(today, days);
    setHistoryFrom(newFrom);
    setHistoryTo(today);
    if (store?.id) {
      loadHistory(store.id, newFrom, today);
    }
  };

  const handleCustomRangeApply = () => {
    setHistoryPreset('custom');
    if (store?.id) {
      loadHistory(store.id, historyFrom, historyTo);
    }
  };

  const filledIds = Object.keys(qty).filter(id => (qty[id] ?? '').trim() !== '');

  const saveAll = async () => {
    if (!store) return;
    if (!staff) { showToast('Please select who received it', 'error'); return; }
    if (!filledIds.length) { showToast('Type a number next to at least one item', 'error'); return; }

    const entryDateToUse = canEdit ? selectedDate : today;

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
      loadDeliveries(store.id, entryDateToUse);
      loadHistory(store.id, historyFrom, historyTo);
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
      loadDeliveries(store.id, selectedDate);
      loadHistory(store.id, historyFrom, historyTo);
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
      loadDeliveries(store.id, selectedDate);
      loadHistory(store.id, historyFrom, historyTo);
    } catch (err) {
      const m = err instanceof Error ? err.message : 'Could not delete.';
      showToast(/row-level security/i.test(m) ? 'Permission error or day locked. Ask your manager.' : m, 'error');
    }
  };

  // Filtered history list
  const filteredHistory = useMemo(() => {
    const s = historySearch.trim().toLowerCase();
    return historyDeliveries.filter(d => {
      if (historyMoveFilter !== 'all' && d.movement !== historyMoveFilter) return false;
      if (historyItemFilter !== 'all' && d.item_id !== historyItemFilter) return false;
      if (s) {
        const itemName = (d.items?.name || '').toLowerCase();
        const noteText = (d.po_reference || '').toLowerCase();
        const staffName = (d.staff_members?.name || '').toLowerCase();
        if (!itemName.includes(s) && !noteText.includes(s) && !staffName.includes(s)) return false;
      }
      return true;
    });
  }, [historyDeliveries, historySearch, historyMoveFilter, historyItemFilter]);

  // History summary stats
  const historyStats = useMemo(() => {
    const totalEntries = filteredHistory.length;
    const totalBoxes = filteredHistory.reduce((sum, d) => sum + (d.boxes || 0), 0);
    const totalWeightKg = filteredHistory.reduce((sum, d) => sum + (Number(d.quantity || 0) / 1000), 0);
    const uniqueDates = new Set(filteredHistory.map(d => d.entry_date)).size;
    return { totalEntries, totalBoxes, totalWeightKg, uniqueDates };
  }, [filteredHistory]);

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const term = search.trim().toLowerCase();
  const shown = items.filter(i => !term || i.name.toLowerCase().includes(term));
  const anyBox = items.some(isBox);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Stock Received &amp; Deliveries</h1>
          <p className={styles.subtitle}>
            {store.name} · Record deliveries or review past received records
          </p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <StockTabs />

      {/* Sub-view switcher: Available to everyone! */}
      <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          type="button"
          onClick={() => setActiveTab('entry')}
          style={{
            padding: '0.55rem 1.25rem',
            borderRadius: '8px',
            border: activeTab === 'entry' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            background: activeTab === 'entry' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeTab === 'entry' ? '#fff' : 'var(--text-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>📥</span>
          <span>Receive Stock</span>
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab('history');
            if (store?.id && historyDeliveries.length === 0) {
              loadHistory(store.id, historyFrom, historyTo);
            }
          }}
          style={{
            padding: '0.55rem 1.25rem',
            borderRadius: '8px',
            border: activeTab === 'history' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            background: activeTab === 'history' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
            color: activeTab === 'history' ? '#fff' : 'var(--text-primary)',
            fontWeight: 600,
            cursor: 'pointer',
            fontSize: '0.9rem',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
          }}
        >
          <span>📜</span>
          <span>Past Records &amp; History ({historyDeliveries.length})</span>
        </button>
        {canEdit && (
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: '#ffb74d', fontWeight: 600, background: 'rgba(255,160,0,0.12)', padding: '0.3rem 0.65rem', borderRadius: '6px' }}>
            👑 Admin Editing Enabled
          </span>
        )}
      </div>

      {/* TAB 1: RECEIVE STOCK (Single Day Entry & Records) */}
      {activeTab === 'entry' && (
        <>
          {/* Shift & Date Navigation Bar */}
          <div className={styles.card} style={{
            marginBottom: '1.5rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '1rem',
            background: selectedDate === today
              ? 'linear-gradient(90deg, rgba(95,107,255,0.08), rgba(0,200,83,0.04))'
              : 'linear-gradient(90deg, rgba(255,160,0,0.12), rgba(255,107,53,0.06))',
            border: selectedDate === today ? '1px solid rgba(95,107,255,0.3)' : '1px solid rgba(255,160,0,0.4)',
          }}>
            <div>
              <span style={{ fontSize: '0.78rem', color: selectedDate === today ? '#9aa4ff' : '#ffb74d', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                📅 Delivery Date:
              </span>
              <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.15rem' }}>
                {displayDate(selectedDate)}
                {selectedDate === today && (
                  <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,83,0.18)', color: '#69f0ae', fontWeight: 600 }}>
                    Active Shift (Today)
                  </span>
                )}
                {selectedDate === yesterday && (
                  <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,214,0,0.16)', color: '#ffd740', fontWeight: 600 }}>
                    Yesterday&apos;s Shift
                  </span>
                )}
                {selectedDate !== today && selectedDate !== yesterday && (
                  <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,152,0,0.2)', color: '#ffb74d', fontWeight: 600 }}>
                    Past Shift Date
                  </span>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setSelectedDate(today)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: selectedDate === today ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: selectedDate === today ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  color: selectedDate === today ? '#fff' : 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                📅 Today ({shortDate(today)})
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(yesterday)}
                style={{
                  padding: '0.45rem 0.85rem',
                  borderRadius: '8px',
                  border: selectedDate === yesterday ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                  background: selectedDate === yesterday ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                  color: selectedDate === yesterday ? '#fff' : 'var(--text-primary)',
                  fontWeight: 600,
                  fontSize: '0.85rem',
                  cursor: 'pointer',
                }}
              >
                ⏮️ Yesterday ({shortDate(yesterday)})
              </button>
              <button
                type="button"
                onClick={() => setSelectedDate(addDays(selectedDate, -1))}
                style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
                title="Previous Day"
              >
                ‹
              </button>
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={e => e.target.value && setSelectedDate(e.target.value)}
                style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
                aria-label="Select date for stock arrival"
              />
              <button
                type="button"
                onClick={() => selectedDate < today && setSelectedDate(addDays(selectedDate, 1))}
                disabled={selectedDate >= today}
                style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', opacity: selectedDate >= today ? 0.4 : 1 }}
                title="Next Day"
              >
                ›
              </button>
            </div>
          </div>

          {selectedDate !== today && (
            <div style={{
              padding: '0.75rem 1rem',
              marginBottom: '1.25rem',
              background: 'rgba(255, 160, 0, 0.1)',
              border: '1px solid rgba(255, 160, 0, 0.3)',
              borderRadius: '8px',
              color: '#ffd54f',
              fontSize: '0.88rem',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem',
            }}>
              <span>
                ✍️ <strong>Viewing / Recording for past date:</strong> {displayDate(selectedDate)}.
                {!canEdit && ' (Note: only Admins can record or edit past date entries).'}
              </span>
              <button
                type="button"
                onClick={() => setSelectedDate(today)}
                style={{ background: 'transparent', border: '1px solid #ffd54f', color: '#ffd54f', borderRadius: '6px', padding: '0.25rem 0.6rem', fontSize: '0.8rem', cursor: 'pointer' }}
              >
                Return to Today
              </button>
            </div>
          )}

          <p className={styles.statusText} style={{ marginBottom: '1rem' }}>
            When stock arrives, type the quantity next to <strong>every item that was received</strong> and press Save once.
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
            placeholder="Search item to enter…"
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
              <p className={styles.statusText}>{filledIds.length} item{filledIds.length === 1 ? '' : 's'} entered for {shortDate(selectedDate)}</p>
              <button className={styles.button} onClick={saveAll} disabled={saving || !filledIds.length}>
                {saving ? 'Saving…' : `Save ${filledIds.length || ''} item${filledIds.length === 1 ? '' : 's'} for ${shortDate(selectedDate)}`}
              </button>
            </div>
          )}

          {/* Records for the Selected Day */}
          <div className={styles.tableContainer} style={{ marginTop: '2.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h2 className={styles.title} style={{ fontSize: '1.25rem', margin: 0 }}>
                {selectedDate === today ? 'Received Today' : `Received on ${displayDate(selectedDate)}`} ({deliveries.length})
              </h2>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('history');
                  setHistoryPreset('30d');
                  setHistoryFrom(addDays(today, -30));
                  setHistoryTo(today);
                  if (store?.id) loadHistory(store.id, addDays(today, -30), today);
                }}
                style={{ background: 'transparent', border: 'none', color: 'var(--accent-primary)', fontSize: '0.88rem', cursor: 'pointer', textDecoration: 'underline' }}
              >
                View all past dates &amp; records →
              </button>
            </div>

            {loadingDeliveries ? (
              <p className={styles.statusText}>Loading deliveries for {shortDate(selectedDate)}…</p>
            ) : deliveries.length === 0 ? (
              <p className={styles.statusText}>
                No stock recorded for {selectedDate === today ? 'today' : shortDate(selectedDate)}. If a delivery arrived, enter quantities above.
              </p>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Item</th>
                      <th>Type</th>
                      <th>Quantity</th>
                      <th>By</th>
                      <th>Challan / Note</th>
                      {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {deliveries.map(d => {
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

      {/* TAB 2: PAST RECORDS & HISTORY BROWSER (Viewable by everyone) */}
      {activeTab === 'history' && (
        <div className={styles.card} style={{ padding: '1.5rem', marginBottom: '2rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
            <div>
              <h2 className={styles.title} style={{ fontSize: '1.3rem', margin: 0 }}>📜 Past Stock Received Records</h2>
              <p className={styles.subtitle}>Check past dates and quantities received across all deliveries</p>
            </div>
            {canEdit && (
              <button
                type="button"
                onClick={() => setActiveTab('entry')}
                style={{
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  background: 'var(--accent-primary)',
                  color: '#fff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.88rem',
                }}
              >
                + Record Stock for a Date
              </button>
            )}
          </div>

          {/* Quick Date Range Filters */}
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>Date range:</span>
            <button
              type="button"
              onClick={() => handleApplyPreset('7d')}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '6px',
                border: historyPreset === '7d' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: historyPreset === '7d' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: historyPreset === '7d' ? '#fff' : 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Past 7 Days
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('14d')}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '6px',
                border: historyPreset === '14d' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: historyPreset === '14d' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: historyPreset === '14d' ? '#fff' : 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Past 14 Days
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('30d')}
              style={{
                padding: '0.4rem 0.8rem',
                borderRadius: '6px',
                border: historyPreset === '30d' ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                background: historyPreset === '30d' ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                color: historyPreset === '30d' ? '#fff' : 'var(--text-primary)',
                fontSize: '0.82rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Past 30 Days
            </button>

            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', marginLeft: 'auto' }}>
              <input
                type="date"
                value={historyFrom}
                max={today}
                onChange={e => setHistoryFrom(e.target.value)}
                style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                aria-label="History start date"
              />
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>to</span>
              <input
                type="date"
                value={historyTo}
                max={today}
                onChange={e => setHistoryTo(e.target.value)}
                style={{ padding: '0.35rem 0.6rem', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.82rem' }}
                aria-label="History end date"
              />
              <button
                type="button"
                onClick={handleCustomRangeApply}
                style={{ padding: '0.35rem 0.75rem', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
              >
                Filter
              </button>
            </div>
          </div>

          {/* Search & Filter Controls */}
          <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
            <input
              type="text"
              className={styles.input}
              style={{ flex: 2, minWidth: 200 }}
              placeholder="Search by flavour / item name, challan, or staff…"
              value={historySearch}
              onChange={e => setHistorySearch(e.target.value)}
            />
            <select
              className={styles.select}
              style={{ flex: 1, minWidth: 160 }}
              value={historyItemFilter}
              onChange={e => setHistoryItemFilter(e.target.value)}
            >
              <option value="all">All Items ({items.length})</option>
              {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
            </select>
            <select
              className={styles.select}
              style={{ flex: 1, minWidth: 160 }}
              value={historyMoveFilter}
              onChange={e => setHistoryMoveFilter(e.target.value as 'all' | Move)}
            >
              <option value="all">All Movements</option>
              <option value="received">Received from Warehouse</option>
              <option value="transfer_in">Transfer IN</option>
              <option value="transfer_out">Transfer OUT</option>
            </select>
          </div>

          {/* History KPI summary banner */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '0.75rem',
            padding: '0.85rem 1rem',
            background: 'var(--bg-secondary)',
            borderRadius: '8px',
            marginBottom: '1.25rem',
            border: '1px solid var(--border-color)',
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Entries Found</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{historyStats.totalEntries}</div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Days With Stock</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{historyStats.uniqueDates}</div>
            </div>
            {historyStats.totalBoxes > 0 && (
              <div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Boxes</div>
                <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--accent-primary)' }}>{historyStats.totalBoxes}</div>
              </div>
            )}
            <div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>Total Weight</div>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{historyStats.totalWeightKg.toFixed(1)} kg</div>
            </div>
          </div>

          {/* History Table */}
          {loadingHistory ? (
            <p className={styles.statusText}>Loading past delivery records…</p>
          ) : filteredHistory.length === 0 ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
              <p style={{ margin: 0, fontSize: '1rem' }}>No delivery records found matching your filters.</p>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedDate(historyTo);
                    setActiveTab('entry');
                  }}
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
                  + Add Missing Delivery for {shortDate(historyTo)}
                </button>
              )}
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Day Received</th>
                    <th>Time</th>
                    <th>Item</th>
                    <th>Type</th>
                    <th>Quantity</th>
                    <th>By</th>
                    <th>Challan / Note</th>
                    {canEdit && <th style={{ textAlign: 'right' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredHistory.map(d => {
                    const isBoxItem = d.boxes !== null || (d.items && Number(d.items.tare_grams || 0) > 0);
                    const shownQty = d.boxes !== null ? d.boxes : d.items ? toDisplay(Number(d.quantity), d.items.rista_unit, d.items.uom) : d.quantity;
                    const unit = isBoxItem ? 'boxes' : d.items ? displayUnit(d.items.rista_unit, d.items.uom) : '';
                    return (
                      <tr key={d.id}>
                        <td style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                          <div>{displayDate(d.entry_date)}</div>
                          {d.entry_date === today && (
                            <span style={{ fontSize: '0.7rem', color: '#69f0ae' }}>Active Shift</span>
                          )}
                        </td>
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
      )}

      {/* EDIT MODAL / POPUP: Restricted to Admin & Super Admin */}
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
