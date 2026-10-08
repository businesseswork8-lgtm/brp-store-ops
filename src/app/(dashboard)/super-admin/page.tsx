'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { istDate, addDays } from '@/lib/dates';
import { Frequency, isDue } from '@/lib/stock/schedule';
import styles from './super-admin.module.css';
import { BR_BRAND_ID } from '@/lib/br';

type StoreRow = {
  id: string; name: string; brand: string; is_active: boolean;
  cash: string; due: number; counted: number;
  salesUploaded: boolean; usageUploaded: boolean;
  short: number; excess: number; problems: number;
  yesterdaySales: number | null;
  br?: { flavours: number; opened: number; closed: number; itemsUploaded: boolean; over: number; checked: boolean; totalKg?: number };
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const RELIABLE = new Set(['SHORT', 'EXCESS', 'OK', 'CHECK_RECEIVED']);

export default function AllStoresPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSuperAdmin, setIsSuperAdmin] = useState(false);
  const [showPilotManager, setShowPilotManager] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const today = istDate();
  const yesterday = addDays(today, -1);

  const load = useCallback(async () => {
    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      const { data: prof } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
      setIsSuperAdmin(prof?.role === 'super_admin');
    }

    // Fetch all stores to allow pilot management
    const { data: stores } = await supabase.from('stores').select('id, name, brand_id, is_active, brands(name)').order('name');
    const out = await Promise.all((stores || []).map(async st => {
      const [{ data: cash }, { data: sales }, { data: usage }, { data: items }, { data: counts }, { data: report }] = await Promise.all([
        supabase.from('daily_cash_tally').select('tally_type').eq('store_id', st.id).eq('entry_date', today),
        supabase.from('daily_sales_summary').select('net_sales, has_summary, has_items').eq('store_id', st.id).eq('entry_date', yesterday).maybeSingle(),
        supabase.from('rista_consumption_uploads').select('id').eq('store_id', st.id).lte('date_from', yesterday).gte('date_to', yesterday).limit(1),
        supabase.from('items').select('id, count_frequency, item_categories!inner(brand_id)')
          .eq('is_active', true).eq('item_categories.brand_id', st.brand_id).neq('count_frequency', 'none'),
        supabase.from('stock_counts').select('item_id, count_date').eq('store_id', st.id)
          .gte('count_date', addDays(today, -62)).order('count_date', { ascending: false }).limit(5000),
        supabase.rpc('stock_variance_report', { p_store_id: st.id, p_from: null, p_to: today }),
      ]);
      let br: StoreRow['br'];
      if (st.brand_id === BR_BRAND_ID) {
        const [{ data: todaySales }, { data: repToday }, { data: repYest }, { data: weighed }] = await Promise.all([
          supabase.from('daily_sales_summary').select('net_sales, has_summary, has_items').eq('store_id', st.id).eq('entry_date', today).maybeSingle(),
          supabase.rpc('br_daily_report', { p_store_id: st.id, p_date: today }),
          supabase.rpc('br_daily_report', { p_store_id: st.id, p_date: yesterday }),
          supabase.from('br_flavour_counts').select('session, grams').eq('store_id', st.id).eq('count_date', today),
        ]);
        const hasTodaySales = Boolean(todaySales?.has_items);
        const rep = (hasTodaySales && (repToday || []).length ? repToday : repYest || []) as { status: string }[];
        const todayGrams = (weighed || []).reduce((sum, w) => sum + Number((w as unknown as { grams: number }).grams || 0), 0);
        br = {
          flavours: rep.length,
          opened: (weighed || []).filter(w => w.session === 'opening').length,
          closed: (weighed || []).filter(w => w.session === 'closing').length,
          itemsUploaded: hasTodaySales || Boolean(sales?.has_items),
          over: rep.filter(x => x.status === 'OVER').length,
          checked: rep.some(x => ['OVER', 'OK', 'CHECK'].includes(x.status)),
          totalKg: todayGrams > 0 ? Math.round(todayGrams / 1000) : undefined,
        };
      }
      const last: Record<string, string> = {};
      (counts || []).forEach(c => { if (!last[c.item_id]) last[c.item_id] = c.count_date; });
      const due = (items || []).filter(i => isDue(i.count_frequency as Frequency, last[i.id] || null, today));
      const rep = (report || []) as { status: string; variance_amount: number }[];
      const ok = rep.filter(r => RELIABLE.has(r.status));
      const m = cash?.some(c => c.tally_type === 'morning'), e = cash?.some(c => c.tally_type === 'evening');
      return {
        id: st.id, name: st.name, brand: (st as unknown as { brands?: { name: string } }).brands?.name || '',
        is_active: Boolean(st.is_active),
        cash: m && e ? 'Both' : m ? 'Morning' : e ? 'Evening only' : 'Not yet',
        due: due.length, counted: due.filter(i => last[i.id] === today).length,
        salesUploaded: Boolean(sales && sales.has_summary !== false), usageUploaded: Boolean(usage?.length),
        short: ok.filter(r => Number(r.variance_amount) < 0).reduce((t, r) => t + Number(r.variance_amount), 0),
        excess: ok.filter(r => Number(r.variance_amount) > 0).reduce((t, r) => t + Number(r.variance_amount), 0),
        problems: rep.filter(r => r.status === 'CHECK_RECEIVED').length,
        yesterdaySales: sales && sales.has_summary !== false ? Number(sales.net_sales) : null,
        br,
      } as StoreRow;
    }));
    setRows(out);
    setLoading(false);
  }, [supabase, today, yesterday]);

  useEffect(() => { load(); }, [load]);

  const toggleStoreActive = async (storeId: string, currentActive: boolean) => {
    setTogglingId(storeId);
    const next = !currentActive;
    const { error } = await supabase.from('stores').update({ is_active: next }).eq('id', storeId);
    if (error) {
      alert('Could not update store status: ' + error.message);
    } else {
      window.dispatchEvent(new Event('storeChange'));
      setRows(prev => prev.map(r => r.id === storeId ? { ...r, is_active: next } : r));
    }
    setTogglingId(null);
  };

  const activeStores = rows.filter(r => r.is_active);
  const visibleRows = showInactive ? rows : activeStores;

  const totalSales = visibleRows.reduce((t, r) => t + (r.yesterdaySales || 0), 0);
  const totalShort = visibleRows.reduce((t, r) => t + (r.br ? 0 : r.short), 0);
  const ok = (b: boolean) => <span className={b ? styles.badgeSuccess : styles.badgeDefault}>{b ? '✓' : 'Pending'}</span>;

  return (
    <div className={styles.container}>
      <div className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>All Stores</h1>
          <p className={styles.subtitle}>
            Showing {activeStores.length} active store{activeStores.length === 1 ? '' : 's'} in pilot. Switch stores on or off as you expand.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {isSuperAdmin && (
            <button
              className={showPilotManager ? styles.primaryButton : styles.secondaryButton}
              onClick={() => setShowPilotManager(v => !v)}
            >
              ⚙️ Pilot Stores ({activeStores.length} Active)
            </button>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.88rem', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
            />
            Show paused stores
          </label>
        </div>
      </div>

      {/* Pilot Store Switcher Panel */}
      {showPilotManager && (
        <div className={styles.card} style={{ marginBottom: '1.5rem', border: '1px solid var(--accent-primary)', background: 'rgba(255,107,53,0.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>⚙️ Pilot Rollout: Switch Stores On / Off</h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                Turn on only the stores currently participating in the pilot. Switched-off stores will be hidden from data entry, header selectors, and stock reports.
              </p>
            </div>
            <button className={styles.secondaryButton} onClick={() => setShowPilotManager(false)}>✕ Close</button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '0.75rem' }}>
            {rows.map(st => (
              <div
                key={st.id}
                style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '0.85rem 1rem', borderRadius: '8px',
                  background: st.is_active ? 'rgba(0,200,83,0.08)' : 'var(--bg-secondary)',
                  border: st.is_active ? '1px solid var(--success)' : '1px solid var(--border-color)',
                }}
              >
                <div>
                  <div style={{ fontWeight: 600 }}>{st.name}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{st.brand}</div>
                </div>
                <button
                  type="button"
                  onClick={() => toggleStoreActive(st.id, st.is_active)}
                  disabled={togglingId === st.id}
                  style={{
                    padding: '0.4rem 0.85rem', borderRadius: '20px', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                    background: st.is_active ? 'var(--success)' : 'var(--bg-card)',
                    color: st.is_active ? '#000' : 'var(--text-secondary)',
                    border: st.is_active ? 'none' : '1px solid var(--border-color)',
                  }}
                >
                  {togglingId === st.id ? 'Saving…' : st.is_active ? '🟢 Active (Pilot)' : '⚪ Paused (Off)'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? <div className={styles.loading}>Loading stores…</div> : (
        <>
          <div className={styles.statGrid} style={{ marginBottom: '1.5rem' }}>
            <div className={styles.statCard}><div className={styles.statLabel}>Yesterday&apos;s sales (uploaded)</div><div className={styles.statValue}>{inr(totalSales)}</div></div>
            <div className={styles.statCard}><div className={styles.statLabel}>Short at latest counts</div>
              <div className={styles.statValue} style={{ color: totalShort < 0 ? 'var(--danger)' : undefined }}>{inr(totalShort)}</div></div>
            <div className={styles.statCard}><div className={styles.statLabel}>Stores with stock counted tonight</div>
              <div className={styles.statValue}>{visibleRows.filter(r => r.br ? r.br.flavours > 0 && r.br.closed >= r.br.flavours : r.due > 0 && r.counted >= r.due).length} / {visibleRows.length}</div></div>
          </div>

          <div className={styles.card} style={{ overflowX: 'auto' }}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Store</th>
                  <th>Pilot Status</th>
                  <th>Cash today</th>
                  <th>Stock counted</th>
                  <th>Yesterday&apos;s Rista files</th>
                  <th>Short / Excess</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map(r => (
                  <tr key={r.id} style={{ opacity: r.is_active ? 1 : 0.6 }}>
                    <td style={{ fontWeight: 600 }}>
                      {r.name}
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.brand}</div>
                    </td>
                    <td>
                      {isSuperAdmin ? (
                        <button
                          type="button"
                          onClick={() => toggleStoreActive(r.id, r.is_active)}
                          disabled={togglingId === r.id}
                          style={{
                            padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer',
                            background: r.is_active ? 'rgba(0,200,83,0.15)' : 'var(--bg-secondary)',
                            color: r.is_active ? 'var(--success)' : 'var(--text-secondary)',
                            border: r.is_active ? '1px solid var(--success)' : '1px solid var(--border-color)',
                          }}
                        >
                          {togglingId === r.id ? '…' : r.is_active ? '🟢 Active' : '⚪ Paused'}
                        </button>
                      ) : (
                        <span
                          style={{
                            padding: '0.25rem 0.6rem', borderRadius: '12px', fontSize: '0.75rem', fontWeight: 600,
                            background: r.is_active ? 'rgba(0,200,83,0.15)' : 'var(--bg-secondary)',
                            color: r.is_active ? 'var(--success)' : 'var(--text-secondary)',
                            border: r.is_active ? '1px solid var(--success)' : '1px solid var(--border-color)',
                          }}
                        >
                          {r.is_active ? '🟢 Active' : '⚪ Paused'}
                        </span>
                      )}
                    </td>
                    <td>{r.cash === 'Both' ? ok(true) : <span className={styles.badgeDefault}>{r.cash}</span>}</td>
                    {r.br ? (
                      <>
                        <td>
                          🍨 Open {r.br.opened >= r.br.flavours && r.br.flavours ? ok(true) : <span className={styles.badgeDefault}>{r.br.opened}/{r.br.flavours}</span>}
                          {' '}Close {r.br.closed >= r.br.flavours && r.br.flavours ? ok(true) : <span className={styles.badgeDefault}>{r.br.closed}/{r.br.flavours}</span>}
                          {r.br.totalKg ? <span style={{ fontSize: '0.82rem', color: 'var(--success)', fontWeight: 600, marginLeft: '0.4rem' }}>({r.br.totalKg} kg)</span> : ''}
                        </td>
                        <td>Sales {ok(r.salesUploaded)} &nbsp; Items {ok(r.br.itemsUploaded)}</td>
                        <td>{!r.br.checked ? <span className={styles.badgeDefault}>Not checked</span>
                          : r.br.over ? <span className={styles.badgeDanger}>{r.br.over} flavour{r.br.over > 1 ? 's' : ''} over yesterday</span>
                          : ok(true)}</td>
                      </>
                    ) : (
                    <>
                    <td>{r.due === 0 ? <span className={styles.badgeDefault}>Nothing due</span>
                      : r.counted >= r.due ? ok(true) : <span className={styles.badgeDefault}>{r.counted} / {r.due}</span>}</td>
                    <td>Sales {ok(r.salesUploaded)} &nbsp; Usage {ok(r.usageUploaded)}</td>
                    <td>
                      <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{inr(r.short)}</span>
                      {' / '}<span style={{ color: 'var(--success)' }}>{inr(r.excess)}</span>
                      {r.problems > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>{r.problems} delivery not entered?</div>}
                    </td>
                    </>
                    )}
                    <td>
                      <Link
                        href="/super-admin/stock-report"
                        className={styles.secondaryButton}
                        onClick={() => {
                          try {
                            localStorage.setItem('selectedStore', r.id);
                            window.dispatchEvent(new Event('storeChange'));
                          } catch { /* ignore */ }
                        }}
                      >
                        Stock report
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
