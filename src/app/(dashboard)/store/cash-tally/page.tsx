'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { DENOMINATIONS, DailyCashTransaction } from '@/lib/types';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatDateTime, formatTime } from '@/lib/dates';

type StaffMember = { id: string; name: string };

type HistoryDayRow = {
  date: string;
  morningCash: number | null;
  posCash: number | null;
  expenses: number;
  deposits: number;
  expectedCash: number | null;
  eveningCash: number | null;
  diff: number | null;
  status: 'MATCH' | 'SHORT' | 'EXTRA' | 'PENDING';
};

// ₹2000 notes are withdrawn — not shown to staff (column kept in DB for old data)
const NOTES = DENOMINATIONS.filter(d => d.value !== 2000);

const EXPENSE_CATEGORIES = [
  'Tea & Snacks',
  'Milk & Dairy',
  'Store Supplies / Cleaning',
  'Repairs & Maintenance',
  'Staff Conveyance / Transport',
  'Other Store Expense',
];

const DEPOSIT_CATEGORIES = [
  'Bank Cash Deposit',
  'Cash Handover to Owner / Office',
  'Other Deposit',
];

export default function CashTallyPage() {
  const { supabase, store, profile, loading: storeLoading } = useActiveStore();
  const todayDate = istDate();
  const yesterdayDate = addDays(todayDate, -1);

  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [tab, setTab] = useState<'morning' | 'evening' | 'history'>('morning');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);
  const [selectedStaff, setSelectedStaff] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [hasSavedTally, setHasSavedTally] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // Daily cash transactions (expenses & deposits)
  const [transactions, setTransactions] = useState<DailyCashTransaction[]>([]);
  const [txType, setTxType] = useState<'expense' | 'bank_deposit'>('expense');
  const [txCategory, setTxCategory] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [txAmount, setTxAmount] = useState<string>('');
  const [txDescription, setTxDescription] = useState<string>('');
  const [txStaff, setTxStaff] = useState<string>('');
  const [savingTx, setSavingTx] = useState(false);

  // Morning count & POS cash for live evening reconciliation
  const [morningTotal, setMorningTotal] = useState<number | null>(null);
  const [posCashSales, setPosCashSales] = useState<number | null>(null);
  const [savedTallyInfo, setSavedTallyInfo] = useState<{ time: string; amount: number; staffId: string } | null>(null);

  // Multi-day history state
  const [historyRows, setHistoryRows] = useState<HistoryDayRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // URL query param support: ?date=YYYY-MM-DD and ?tab=history|morning|evening
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const d = params.get('date');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        setSelectedDate(d);
        if (d < todayDate) {
          setTab('evening');
        }
      }
      const t = params.get('tab');
      if (t === 'history' || t === 'morning' || t === 'evening') {
        setTab(t);
      }
    }
  }, [todayDate]);

  const loadHistory = useCallback(async () => {
    if (!store) return;
    setHistoryLoading(true);
    try {
      const startDate = addDays(todayDate, -30);
      const [
        { data: tallies },
        { data: salesList },
        { data: txsList },
      ] = await Promise.all([
        supabase.from('daily_cash_tally')
          .select('entry_date, tally_type, total_amount, created_at')
          .eq('store_id', store.id)
          .gte('entry_date', startDate)
          .lte('entry_date', todayDate),
        supabase.from('daily_sales_summary')
          .select('entry_date, cash_amount')
          .eq('store_id', store.id)
          .gte('entry_date', startDate)
          .lte('entry_date', todayDate),
        supabase.from('daily_cash_transactions')
          .select('entry_date, tx_type, amount')
          .eq('store_id', store.id)
          .gte('entry_date', startDate)
          .lte('entry_date', todayDate),
      ]);

      const rowsMap = new Map<string, {
        morning: number | null;
        evening: number | null;
        posCash: number | null;
        expenses: number;
        deposits: number;
      }>();

      let cur = todayDate;
      while (cur >= startDate) {
        rowsMap.set(cur, {
          morning: null,
          evening: null,
          posCash: null,
          expenses: 0,
          deposits: 0,
        });
        cur = addDays(cur, -1);
      }

      (tallies || []).forEach(t => {
        const row = rowsMap.get(t.entry_date);
        if (row) {
          if (t.tally_type === 'morning') row.morning = Number(t.total_amount);
          if (t.tally_type === 'evening') row.evening = Number(t.total_amount);
        }
      });

      (salesList || []).forEach(s => {
        const row = rowsMap.get(s.entry_date);
        if (row && s.cash_amount !== null && s.cash_amount !== undefined) {
          row.posCash = Number(s.cash_amount);
        }
      });

      (txsList || []).forEach(tx => {
        const row = rowsMap.get(tx.entry_date);
        if (row) {
          const amt = Number(tx.amount || 0);
          if (tx.tx_type === 'expense') row.expenses += amt;
          if (tx.tx_type === 'bank_deposit') row.deposits += amt;
        }
      });

      const calculatedRows: HistoryDayRow[] = [];
      rowsMap.forEach((val, dt) => {
        const hasActivity = val.morning !== null || val.evening !== null || val.posCash !== null || val.expenses > 0 || val.deposits > 0;
        // Keep any day with activity, or the last 7 days so current shifts are visible
        if (!hasActivity && dt < addDays(todayDate, -7)) {
          return;
        }

        const expected = val.morning !== null && val.posCash !== null
          ? val.morning + val.posCash - val.expenses - val.deposits
          : null;

        const diff = expected !== null && val.evening !== null
          ? val.evening - expected
          : null;

        let status: HistoryDayRow['status'] = 'PENDING';
        if (diff !== null) {
          if (Math.abs(diff) < 1) status = 'MATCH';
          else if (diff < 0) status = 'SHORT';
          else status = 'EXTRA';
        }

        calculatedRows.push({
          date: dt,
          morningCash: val.morning,
          posCash: val.posCash,
          expenses: val.expenses,
          deposits: val.deposits,
          expectedCash: expected,
          eveningCash: val.evening,
          diff,
          status,
        });
      });

      calculatedRows.sort((a, b) => b.date.localeCompare(a.date));
      setHistoryRows(calculatedRows);
    } catch (err) {
      console.error('Error loading cash history:', err);
    } finally {
      setHistoryLoading(false);
    }
  }, [supabase, store, todayDate]);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const activeMode = tab === 'history' ? 'evening' : tab;
    const [
      { data: staff },
      { data: tally },
      { data: morningTally },
      { data: txs },
      { data: salesSummary },
    ] = await Promise.all([
      supabase.from('staff_members').select('id, name').eq('store_id', store.id).eq('is_active', true).order('name'),
      supabase.from('daily_cash_tally').select('*')
        .eq('store_id', store.id).eq('entry_date', selectedDate).eq('tally_type', activeMode).maybeSingle(),
      supabase.from('daily_cash_tally').select('total_amount')
        .eq('store_id', store.id).eq('entry_date', selectedDate).eq('tally_type', 'morning').maybeSingle(),
      supabase.from('daily_cash_transactions').select('*, staff_members(name)')
        .eq('store_id', store.id).eq('entry_date', selectedDate).order('created_at', { ascending: false }),
      supabase.from('daily_sales_summary').select('cash_amount')
        .eq('store_id', store.id).eq('entry_date', selectedDate).maybeSingle(),
    ]);

    setStaffList(staff || []);
    setTransactions((txs as unknown as DailyCashTransaction[]) || []);
    setMorningTotal(morningTally ? Number(morningTally.total_amount) : null);
    setPosCashSales(salesSummary ? Number(salesSummary.cash_amount) : null);

    if (tally) {
      setHasSavedTally(true);
      setSavedTallyInfo({
        time: tally.created_at,
        amount: Number(tally.total_amount),
        staffId: tally.staff_member_id || '',
      });
      setSelectedStaff(tally.staff_member_id || '');
      const c: Record<string, number> = {};
      NOTES.forEach(d => { c[d.key] = tally[d.key] || 0; });
      setCounts(c);
    } else {
      setHasSavedTally(false);
      setSavedTallyInfo(null);
      setCounts({});
      setSelectedStaff('');
    }
    setLoading(false);
  }, [supabase, store, tab, selectedDate]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const total = NOTES.reduce((sum, d) => sum + (counts[d.key] || 0) * d.value, 0);

  const totalExpenses = transactions
    .filter(t => t.tx_type === 'expense')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  const totalDeposits = transactions
    .filter(t => t.tx_type === 'bank_deposit')
    .reduce((sum, t) => sum + Number(t.amount || 0), 0);

  // Expected evening drawer cash = Morning Opening + Cash Sales - Expenses - Bank Deposits
  const expectedEveningCash = morningTotal !== null && posCashSales !== null
    ? morningTotal + posCashSales - totalExpenses - totalDeposits
    : null;

  const eveningDiff = expectedEveningCash !== null && total > 0
    ? total - expectedEveningCash
    : null;

  const showToast = (message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const isSuperAdminOrAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';
  const isPastDate = selectedDate < todayDate;
  const isLockedForStore = (hasSavedTally || isPastDate) && !isSuperAdminOrAdmin;

  const handleSubmit = async () => {
    if (!store) return;
    if (isLockedForStore) {
      showToast(isPastDate ? 'Past shift records are locked. Only an Admin can edit them.' : 'Cash count is locked. Only an Admin can edit it.', 'error');
      return;
    }
    if (!selectedStaff) { showToast('Please select who is counting', 'error'); return; }
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      const activeMode = tab === 'history' ? 'evening' : tab;
      const payload: Record<string, unknown> = {
        store_id: store.id,
        entry_date: selectedDate,
        tally_type: activeMode,
        staff_member_id: selectedStaff,
        submitted_by_profile_id: user.id,
      };
      NOTES.forEach(d => { payload[d.key] = counts[d.key] || 0; });

      const { error } = await supabase
        .from('daily_cash_tally')
        .upsert(payload, { onConflict: 'store_id,entry_date,tally_type' });
      if (error) throw error;
      setHasSavedTally(true);
      showToast(`${activeMode === 'morning' ? 'Morning' : 'Evening'} cash saved: ₹${total.toLocaleString('en-IN')}`, 'success');
      load();
      loadHistory();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || '';
      showToast(/row-level security/i.test(msg) ? 'This day is closed for changes. Ask your manager to correct it.' : msg || 'Could not save. Please try again.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleAddTransaction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!store) return;
    if (isLockedForStore) {
      showToast('Transactions for locked days can only be entered by an Admin.', 'error');
      return;
    }
    const amountNum = parseFloat(txAmount);
    if (isNaN(amountNum) || amountNum <= 0) {
      showToast('Please enter a valid amount greater than 0', 'error');
      return;
    }
    setSavingTx(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      const { error } = await supabase.from('daily_cash_transactions').insert({
        store_id: store.id,
        entry_date: selectedDate,
        tx_type: txType,
        amount: amountNum,
        category: txCategory,
        description: txDescription.trim() || null,
        staff_member_id: txStaff || null,
        submitted_by_profile_id: user.id,
      });

      if (error) throw error;
      showToast(`Added ${txType === 'expense' ? 'expense' : 'deposit'}: ₹${amountNum.toLocaleString('en-IN')}`, 'success');
      setTxAmount('');
      setTxDescription('');
      load();
      loadHistory();
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || '';
      showToast(msg || 'Could not add transaction.', 'error');
    } finally {
      setSavingTx(false);
    }
  };

  const handleDeleteTransaction = async (id: string) => {
    if (isLockedForStore) {
      showToast('Transactions for locked days can only be modified by an Admin.', 'error');
      return;
    }
    if (!confirm('Are you sure you want to remove this entry?')) return;
    try {
      const { error } = await supabase.from('daily_cash_transactions').delete().eq('id', id);
      if (error) throw error;
      showToast('Entry removed', 'success');
      load();
      loadHistory();
    } catch (err) {
      console.error(err);
      showToast('Could not remove entry', 'error');
    }
  };

  // Inspect a specific past date from the history log
  const handleInspectDate = (date: string) => {
    setSelectedDate(date);
    setTab('evening');
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  if (storeLoading || (loading && store && tab !== 'history')) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const historyMatches = historyRows.filter(r => r.status === 'MATCH').length;
  const historyShorts = historyRows.filter(r => r.status === 'SHORT');
  const totalShortAmount = historyShorts.reduce((sum, r) => sum + (r.diff !== null && r.diff < 0 ? Math.abs(r.diff) : 0), 0);

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className={styles.title}>Cash Drawer &amp; Reconciliation</h1>
          <p className={styles.subtitle} style={{ margin: '0.2rem 0 0' }}>
            Count cash drawer, log expenses/deposits, and track daily cash match for <strong>{store.name}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <Link href={`/store/eod-report?date=${selectedDate}`} className={styles.backLink} style={{ padding: '0.45rem 0.85rem' }}>
            🖨️ Day Summary
          </Link>
          <Link href="/store" className={styles.backLink}>← Back</Link>
        </div>
      </header>

      {/* Date Navigation Bar */}
      <div className={styles.card} style={{
        marginBottom: '1.25rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '0.75rem',
        background: 'linear-gradient(90deg, rgba(95,107,255,0.08), rgba(0,200,83,0.04))',
        border: '1px solid rgba(95,107,255,0.25)',
      }}>
        <div>
          <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', fontWeight: 600 }}>
            📅 Sales Day (Shift Date)
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span>{displayDate(selectedDate)}</span>
            {selectedDate === todayDate ? (
              <span className={styles.badgeSuccess}>Active Shift (Today)</span>
            ) : selectedDate === yesterdayDate ? (
              <span className={styles.badgeWarning}>Yesterday&apos;s Shift</span>
            ) : (
              <span className={styles.badgeDefault}>Past Shift</span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.45rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSelectedDate(yesterdayDate)}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              background: selectedDate === yesterdayDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: selectedDate === yesterdayDate ? '#fff' : 'var(--text-primary)',
              border: selectedDate === yesterdayDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            }}
          >
            ⏮️ Yesterday
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(todayDate)}
            style={{
              padding: '0.4rem 0.75rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              background: selectedDate === todayDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: selectedDate === todayDate ? '#fff' : 'var(--text-primary)',
              border: selectedDate === todayDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
            }}
          >
            📅 Active Shift
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(addDays(selectedDate, -1))}
            style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer' }}
            title="Previous Day"
          >
            ‹
          </button>
          <input
            type="date"
            value={selectedDate}
            max={todayDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', fontSize: '0.85rem' }}
          />
          <button
            type="button"
            onClick={() => selectedDate < todayDate && setSelectedDate(addDays(selectedDate, 1))}
            disabled={selectedDate >= todayDate}
            style={{ padding: '0.4rem 0.65rem', borderRadius: '6px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', opacity: selectedDate >= todayDate ? 0.4 : 1 }}
            title="Next Day"
          >
            ›
          </button>
        </div>
      </div>

      {/* Mode Tabs */}
      <div className={styles.tabs} style={{ marginBottom: '1.5rem' }}>
        <button
          className={`${styles.tab} ${tab === 'morning' ? styles.active : ''}`}
          onClick={() => setTab('morning')}
        >
          🌅 Morning Count (Opening Drawer)
        </button>
        <button
          className={`${styles.tab} ${tab === 'evening' ? styles.active : ''}`}
          onClick={() => setTab('evening')}
        >
          🌙 Evening Count (Closing Drawer)
        </button>
        <button
          className={`${styles.tab} ${tab === 'history' ? styles.active : ''}`}
          onClick={() => setTab('history')}
        >
          📜 Cash Discrepancy History &amp; Audit Log
          {historyShorts.length > 0 && (
            <span style={{ marginLeft: '0.45rem', padding: '0.1rem 0.45rem', borderRadius: '999px', fontSize: '0.72rem', background: 'var(--danger)', color: '#fff', fontWeight: 700 }}>
              {historyShorts.length} Short
            </span>
          )}
        </button>
      </div>

      {/* ========================================================================= */}
      {/* VIEW 1: MULTI-DAY CASH DISCREPANCY HISTORY TAB */}
      {/* ========================================================================= */}
      {tab === 'history' ? (
        <div>
          {/* History KPI Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            <div style={{ padding: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Days Tracked (Last 30 Days)</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, marginTop: '0.2rem' }}>
                {historyRows.length} shifts
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Exact Cash Matches</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)', marginTop: '0.2rem' }}>
                ✓ {historyMatches} days
              </div>
            </div>

            <div style={{ padding: '1rem', background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderRadius: '10px' }}>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Cash Shortages Flagged</div>
              <div style={{ fontSize: '1.5rem', fontWeight: 700, color: historyShorts.length > 0 ? 'var(--danger)' : 'var(--success)', marginTop: '0.2rem' }}>
                {historyShorts.length > 0 ? `⚠ ${historyShorts.length} days (-₹${totalShortAmount.toLocaleString('en-IN')})` : '✓ 0 Shortages'}
              </div>
            </div>
          </div>

          {/* History Audit Table */}
          <div className={styles.card} style={{ overflowX: 'auto', padding: '0.75rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem', padding: '0.5rem' }}>
              <h3 style={{ margin: 0, fontSize: '1.05rem', color: 'var(--accent-primary)' }}>
                Historical Cash Reconciliation by Sales Day
              </h3>
              <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                Click any row or &ldquo;Inspect Day&rdquo; to drill down into that date
              </span>
            </div>

            {historyLoading ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>Loading historical cash log…</div>
            ) : historyRows.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-secondary)' }}>No cash logs recorded in the last 30 days.</div>
            ) : (
              <table className={styles.table} style={{ width: '100%', fontSize: '0.88rem' }}>
                <thead>
                  <tr>
                    <th>Sales Day</th>
                    <th>🌅 Morning (Open)</th>
                    <th>💵 POS Sales</th>
                    <th>💸 Expenses &amp; Deposits</th>
                    <th>⚖️ Expected Close</th>
                    <th>🌙 Closing (Counted)</th>
                    <th>Cash Difference</th>
                    <th>Status</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {historyRows.map(r => {
                    const isSelected = r.date === selectedDate;
                    return (
                      <tr
                        key={r.date}
                        style={{
                          background: isSelected ? 'rgba(95,107,255,0.09)' : undefined,
                          borderLeft: isSelected ? '3px solid var(--accent-primary)' : undefined,
                        }}
                      >
                        <td style={{ fontWeight: 600 }}>
                          <div>{shortDate(r.date)}</div>
                          <div style={{ fontSize: '0.74rem', color: 'var(--text-secondary)' }}>{r.date}</div>
                        </td>
                        <td>
                          {r.morningCash !== null ? `₹${r.morningCash.toLocaleString('en-IN')}` : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ color: r.posCash !== null ? 'var(--success)' : 'var(--text-secondary)' }}>
                          {r.posCash !== null ? `+₹${r.posCash.toLocaleString('en-IN')}` : 'Pending upload'}
                        </td>
                        <td>
                          {r.expenses > 0 || r.deposits > 0 ? (
                            <span style={{ color: 'var(--danger)' }}>
                              -₹{(r.expenses + r.deposits).toLocaleString('en-IN')}
                            </span>
                          ) : '₹0'}
                        </td>
                        <td style={{ fontWeight: 600 }}>
                          {r.expectedCash !== null ? `₹${r.expectedCash.toLocaleString('en-IN')}` : <span style={{ color: 'var(--text-secondary)' }}>—</span>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {r.eveningCash !== null ? `₹${r.eveningCash.toLocaleString('en-IN')}` : <span className={styles.badgeDefault}>Pending</span>}
                        </td>
                        <td style={{ fontWeight: 700 }}>
                          {r.diff !== null ? (
                            <span style={{ color: Math.abs(r.diff) < 1 ? 'var(--success)' : r.diff < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                              {Math.abs(r.diff) < 1 ? '₹0 (Match)' : r.diff < 0 ? `-₹${Math.abs(r.diff).toLocaleString('en-IN')}` : `+₹${r.diff.toLocaleString('en-IN')}`}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--text-secondary)' }}>—</span>
                          )}
                        </td>
                        <td>
                          {r.status === 'MATCH' && <span className={styles.badgeSuccess}>✓ Matched</span>}
                          {r.status === 'SHORT' && <span className={styles.badgeDanger}>⚠ Short</span>}
                          {r.status === 'EXTRA' && <span className={styles.badgeWarning}>Extra</span>}
                          {r.status === 'PENDING' && <span className={styles.badgeDefault}>Pending</span>}
                        </td>
                        <td>
                          <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center' }}>
                            <button
                              type="button"
                              onClick={() => handleInspectDate(r.date)}
                              style={{
                                padding: '0.3rem 0.65rem', borderRadius: '6px', fontSize: '0.78rem', fontWeight: 600,
                                background: 'var(--accent-primary)', color: '#fff', border: 'none', cursor: 'pointer',
                              }}
                            >
                              🔍 Inspect
                            </button>
                            <Link
                              href={`/store/eod-report?date=${r.date}`}
                              style={{
                                padding: '0.3rem 0.55rem', borderRadius: '6px', fontSize: '0.78rem',
                                background: 'var(--bg-secondary)', color: 'var(--text-primary)', border: '1px solid var(--border-color)',
                                textDecoration: 'none',
                              }}
                            >
                              🖨️
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : (
        /* ========================================================================= */
        /* VIEW 2: MORNING OR EVENING COUNT & RECONCILIATION FOR SELECTED DATE */
        /* ========================================================================= */
        <div>
          {hasSavedTally && savedTallyInfo && (
            <div style={{ maxWidth: '640px', margin: '0 auto 1.5rem', padding: '0.85rem 1rem', background: 'rgba(0,200,83,0.08)', border: '1px solid rgba(0,200,83,0.3)', borderRadius: '10px', textAlign: 'center' }}>
              ✅ <strong>{tab === 'morning' ? 'Morning' : 'Evening'} cash counted and saved on {formatDateTime(savedTallyInfo.time)}</strong>
              <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--success)', marginTop: '0.2rem' }}>
                Counted Drawer Amount: ₹{savedTallyInfo.amount.toLocaleString('en-IN')}
                {staffList.find(s => s.id === savedTallyInfo.staffId)?.name ? ` · by ${staffList.find(s => s.id === savedTallyInfo.staffId)?.name}` : ''}
              </div>
              {isLockedForStore && (
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
                  🔒 Locked for store editing. {isPastDate ? 'Viewing past shift date. Contact an Admin for adjustments.' : 'If an adjustment is needed, contact an Admin or Super Admin.'}
                </div>
              )}
            </div>
          )}

          {isPastDate && !hasSavedTally && !isSuperAdminOrAdmin && (
            <div style={{ maxWidth: '640px', margin: '0 auto 1.5rem', padding: '0.85rem 1rem', background: 'rgba(255,214,0,0.08)', border: '1px solid rgba(255,214,0,0.3)', borderRadius: '10px', textAlign: 'center', fontSize: '0.88rem', color: 'var(--warning)' }}>
              🔒 <strong>Past Shift Date ({shortDate(selectedDate)}):</strong> No count was recorded. Past shift records are locked for store staff; only an Admin can enter past counts.
            </div>
          )}

          {hasSavedTally && isSuperAdminOrAdmin && (
            <div style={{ maxWidth: '640px', margin: '0 auto 1.5rem', padding: '0.75rem 1rem', background: 'rgba(0,200,83,0.1)', border: '1px solid var(--success)', borderRadius: '8px', textAlign: 'center', fontSize: '0.88rem' }}>
              👑 <strong>Admin Mode:</strong> You have permission to edit and update this saved cash count for {displayDate(selectedDate)}.
            </div>
          )}

          {/* Staff Selector */}
          <div className={styles.controls} style={{ maxWidth: '640px', margin: '0 auto 1.5rem' }}>
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

          {/* Denominations Table */}
          <div className={styles.cashGrid} style={{ maxWidth: '640px', margin: '0 auto' }}>
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

          {/* Total Drawer Cash */}
          <div className={styles.totalArea} style={{ maxWidth: '640px', margin: '1.5rem auto' }}>
            <div className={styles.totalLabel}>{tab === 'morning' ? 'Morning Drawer Total' : 'Evening Drawer Total'}</div>
            <div className={styles.totalAmount}>₹{total.toLocaleString('en-IN')}</div>
          </div>

          <div className={styles.submitArea} style={{ maxWidth: '640px', margin: '0 auto 2.5rem' }}>
            {isLockedForStore ? (
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', textAlign: 'center' }}>
                Count locked (₹{total.toLocaleString('en-IN')})
              </div>
            ) : (
              <button className={styles.button} onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Saving...' : hasSavedTally && isSuperAdminOrAdmin ? `Update ${tab === 'morning' ? 'Morning' : 'Evening'} Cash` : `Save ${tab === 'morning' ? 'Morning' : 'Evening'} Cash`}
              </button>
            )}
          </div>

          {/* ========================================================================= */}
          {/* SECTION 2: DAILY CASH OUTFLOWS (EXPENSES & BANK DEPOSITS) */}
          {/* ========================================================================= */}
          <div className={styles.card} style={{ maxWidth: '640px', margin: '0 auto 2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.15rem', color: 'var(--accent-primary)' }}>
                  🍵 Daily Expenses &amp; 🏦 Bank Deposits ({shortDate(selectedDate)})
                </h3>
                <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                  Shift expenses (tea, milk, cleaning) and cash deposited to the bank for this Sales Day.
                </p>
              </div>
            </div>

            {/* Form to add an expense or deposit */}
            {!isLockedForStore && (
              <form onSubmit={handleAddTransaction} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', background: 'var(--bg-secondary)', padding: '1rem', borderRadius: '8px', marginBottom: '1.25rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    type="button"
                    onClick={() => { setTxType('expense'); setTxCategory(EXPENSE_CATEGORIES[0]); }}
                    style={{
                      flex: 1, padding: '0.5rem', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: 'pointer',
                      background: txType === 'expense' ? 'var(--danger)' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                    }}
                  >
                    💸 Daily Expense (Payout)
                  </button>
                  <button
                    type="button"
                    onClick={() => { setTxType('bank_deposit'); setTxCategory(DEPOSIT_CATEGORIES[0]); }}
                    style={{
                      flex: 1, padding: '0.5rem', borderRadius: '6px', border: 'none', fontWeight: 600, cursor: 'pointer',
                      background: txType === 'bank_deposit' ? 'var(--accent-primary)' : 'rgba(255,255,255,0.06)',
                      color: '#fff',
                    }}
                  >
                    🏦 Bank Deposit
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Category</label>
                    <select
                      className={styles.select}
                      style={{ width: '100%', padding: '0.5rem' }}
                      value={txCategory}
                      onChange={e => setTxCategory(e.target.value)}
                    >
                      {(txType === 'expense' ? EXPENSE_CATEGORIES : DEPOSIT_CATEGORIES).map(c => (
                        <option key={c} value={c}>{c}</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Amount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      placeholder="Amount in ₹"
                      className={styles.input}
                      style={{ width: '100%', padding: '0.5rem' }}
                      value={txAmount}
                      onChange={e => setTxAmount(e.target.value)}
                    />
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Description / Details</label>
                    <input
                      type="text"
                      placeholder={txType === 'expense' ? 'e.g. Evening tea for staff' : 'e.g. HDFC Bank branch deposit'}
                      className={styles.input}
                      style={{ width: '100%', padding: '0.5rem' }}
                      value={txDescription}
                      onChange={e => setTxDescription(e.target.value)}
                    />
                  </div>

                  <div>
                    <label style={{ display: 'block', fontSize: '0.78rem', color: 'var(--text-secondary)', marginBottom: '0.2rem' }}>Staff Member (Optional)</label>
                    <select
                      className={styles.select}
                      style={{ width: '100%', padding: '0.5rem' }}
                      value={txStaff}
                      onChange={e => setTxStaff(e.target.value)}
                    >
                      <option value="">Select staff</option>
                      {staffList.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={savingTx}
                  style={{
                    padding: '0.6rem 1rem', background: 'var(--accent-primary)', color: '#fff', border: 'none',
                    borderRadius: '6px', fontWeight: 600, cursor: 'pointer', marginTop: '0.25rem',
                  }}
                >
                  {savingTx ? 'Saving…' : `+ Add ${txType === 'expense' ? 'Expense' : 'Deposit'}`}
                </button>
              </form>
            )}

            {/* List of transactions for this date */}
            {transactions.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem', fontSize: '0.88rem' }}>
                No cash expenses or bank deposits recorded for {shortDate(selectedDate)}.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-secondary)', paddingBottom: '0.25rem', borderBottom: '1px solid var(--border-color)' }}>
                  <span>Cash Outflows ({shortDate(selectedDate)})</span>
                  <span>Total: ₹{(totalExpenses + totalDeposits).toLocaleString('en-IN')} (Exp: ₹{totalExpenses.toLocaleString('en-IN')}, Dep: ₹{totalDeposits.toLocaleString('en-IN')})</span>
                </div>
                {transactions.map(t => (
                  <div
                    key={t.id}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '0.6rem 0.8rem', background: 'var(--bg-secondary)', borderRadius: '6px',
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display: 'inline-block', fontSize: '0.72rem', fontWeight: 700, padding: '0.15rem 0.4rem',
                          borderRadius: '4px', marginRight: '0.5rem',
                          background: t.tx_type === 'expense' ? 'rgba(255,23,68,0.15)' : 'rgba(0,200,83,0.15)',
                          color: t.tx_type === 'expense' ? 'var(--danger)' : 'var(--success)',
                        }}
                      >
                        {t.tx_type === 'expense' ? 'EXPENSE' : 'DEPOSIT'}
                      </span>
                      <strong style={{ fontSize: '0.9rem' }}>{t.category}</strong>
                      {t.description && <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginLeft: '0.5rem' }}>— {t.description}</span>}
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', display: 'block', marginTop: '0.15rem' }}>
                        🕒 {formatTime(t.created_at)} {t.staff_member?.name ? `· by ${t.staff_member.name}` : ''}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '0.95rem', color: t.tx_type === 'expense' ? 'var(--danger)' : 'var(--accent-primary)' }}>
                        ₹{Number(t.amount).toLocaleString('en-IN')}
                      </span>
                      {!isLockedForStore && (
                        <button
                          onClick={() => handleDeleteTransaction(t.id)}
                          title="Remove entry"
                          style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem' }}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ========================================================================= */}
          {/* SECTION 3: CASH RECONCILIATION FOR SELECTED DATE */}
          {/* ========================================================================= */}
          <div className={styles.card} style={{ maxWidth: '640px', margin: '0 auto' }}>
            <h3 style={{ margin: '0 0 0.75rem', fontSize: '1.1rem', color: 'var(--accent-primary)' }}>
              ⚖️ Cash Reconciliation for {shortDate(selectedDate)}
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>Morning Opening Drawer:</span>
                <strong>{morningTotal !== null ? `₹${morningTotal.toLocaleString('en-IN')}` : 'Pending morning count'}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>(+) POS Cash Sales:</span>
                <strong style={{ color: 'var(--success)' }}>
                  {posCashSales !== null ? `₹${posCashSales.toLocaleString('en-IN')}` : 'Pending POS sales upload'}
                </strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>(-) Daily Cash Expenses (Tea, etc.):</span>
                <strong style={{ color: 'var(--danger)' }}>-₹{totalExpenses.toLocaleString('en-IN')}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ color: 'var(--text-secondary)' }}>(-) Cash Deposited in Bank:</span>
                <strong style={{ color: 'var(--warning)' }}>-₹{totalDeposits.toLocaleString('en-IN')}</strong>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.6rem 0', borderTop: '2px solid var(--border-color)', fontWeight: 700, fontSize: '1rem' }}>
                <span>(=) Expected Evening Drawer Cash:</span>
                <span>{expectedEveningCash !== null ? `₹${expectedEveningCash.toLocaleString('en-IN')}` : 'Need morning count & POS sales'}</span>
              </div>

              {tab === 'evening' && expectedEveningCash !== null && total > 0 && eveningDiff !== null && (
                <div
                  style={{
                    marginTop: '0.5rem', padding: '0.75rem', borderRadius: '8px', textAlign: 'center',
                    background: Math.abs(eveningDiff) < 1 ? 'rgba(0,200,83,0.1)' : eveningDiff < 0 ? 'rgba(255,23,68,0.1)' : 'rgba(255,214,0,0.1)',
                    border: `1px solid ${Math.abs(eveningDiff) < 1 ? 'var(--success)' : eveningDiff < 0 ? 'var(--danger)' : 'var(--warning)'}`,
                  }}
                >
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                    Counted Drawer: ₹{total.toLocaleString('en-IN')} vs Expected: ₹{expectedEveningCash.toLocaleString('en-IN')}
                  </div>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, marginTop: '0.2rem', color: Math.abs(eveningDiff) < 1 ? 'var(--success)' : eveningDiff < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {Math.abs(eveningDiff) < 1 ? '✓ Exact Cash Match! (₹0 diff)' : eveningDiff < 0 ? `⚠ Cash Shortage: -₹${Math.abs(eveningDiff).toLocaleString('en-IN')}` : `Excess Cash: +₹${eveningDiff.toLocaleString('en-IN')}`}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {toast && <div className={`${styles.toast} ${styles[toast.type]}`}>{toast.message}</div>}
    </div>
  );
}
