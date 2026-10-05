'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { istDate, addDays } from '@/lib/dates';
import { Frequency, isDue } from '@/lib/stock/schedule';
import styles from './super-admin.module.css';

type StoreRow = {
  id: string; name: string; brand: string;
  cash: string; due: number; counted: number;
  salesUploaded: boolean; usageUploaded: boolean;
  short: number; excess: number; problems: number;
  yesterdaySales: number | null;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const RELIABLE = new Set(['SHORT', 'EXCESS', 'OK', 'CHECK_RECEIVED']);

export default function AllStoresPage() {
  const [supabase] = useState(() => createClient());
  const [rows, setRows] = useState<StoreRow[]>([]);
  const [loading, setLoading] = useState(true);
  const today = istDate();
  const yesterday = addDays(today, -1);

  useEffect(() => {
    const load = async () => {
      const { data: stores } = await supabase.from('stores').select('id, name, brand_id, brands(name)').eq('is_active', true).order('name');
      const out = await Promise.all((stores || []).map(async st => {
        const [{ data: cash }, { data: sales }, { data: usage }, { data: items }, { data: counts }, { data: report }] = await Promise.all([
          supabase.from('daily_cash_tally').select('tally_type').eq('store_id', st.id).eq('entry_date', today),
          supabase.from('daily_sales_summary').select('net_sales, has_summary').eq('store_id', st.id).eq('entry_date', yesterday).maybeSingle(),
          supabase.from('rista_consumption_uploads').select('id').eq('store_id', st.id).lte('date_from', yesterday).gte('date_to', yesterday).limit(1),
          supabase.from('items').select('id, count_frequency, item_categories!inner(brand_id)')
            .eq('is_active', true).eq('item_categories.brand_id', st.brand_id).neq('count_frequency', 'none'),
          supabase.from('stock_counts').select('item_id, count_date').eq('store_id', st.id)
            .gte('count_date', addDays(today, -62)).order('count_date', { ascending: false }).limit(5000),
          supabase.rpc('stock_variance_report', { p_store_id: st.id, p_from: null, p_to: today }),
        ]);
        const last: Record<string, string> = {};
        (counts || []).forEach(c => { if (!last[c.item_id]) last[c.item_id] = c.count_date; });
        const due = (items || []).filter(i => isDue(i.count_frequency as Frequency, last[i.id] || null, today));
        const rep = (report || []) as { status: string; variance_amount: number }[];
        const ok = rep.filter(r => RELIABLE.has(r.status));
        const m = cash?.some(c => c.tally_type === 'morning'), e = cash?.some(c => c.tally_type === 'evening');
        return {
          id: st.id, name: st.name, brand: (st as unknown as { brands?: { name: string } }).brands?.name || '',
          cash: m && e ? 'Both' : m ? 'Morning' : e ? 'Evening only' : 'Not yet',
          due: due.length, counted: due.filter(i => last[i.id] === today).length,
          salesUploaded: Boolean(sales && sales.has_summary !== false), usageUploaded: Boolean(usage?.length),
          short: ok.filter(r => Number(r.variance_amount) < 0).reduce((t, r) => t + Number(r.variance_amount), 0),
          excess: ok.filter(r => Number(r.variance_amount) > 0).reduce((t, r) => t + Number(r.variance_amount), 0),
          problems: rep.filter(r => r.status === 'CHECK_RECEIVED').length,
          yesterdaySales: sales && sales.has_summary !== false ? Number(sales.net_sales) : null,
        } as StoreRow;
      }));
      setRows(out);
      setLoading(false);
    };
    load();
  }, [supabase, today, yesterday]);

  if (loading) return <div className={styles.loading}>Loading stores…</div>;

  const totalSales = rows.reduce((t, r) => t + (r.yesterdaySales || 0), 0);
  const totalShort = rows.reduce((t, r) => t + r.short, 0);
  const ok = (b: boolean) => <span className={b ? styles.badgeSuccess : styles.badgeDefault}>{b ? '✓' : 'Pending'}</span>;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>All Stores</h1>
          <p className={styles.subtitle}>Has each store done tonight&apos;s work, and is anything short?</p>
        </div>
      </div>

      <div className={styles.statGrid} style={{ marginBottom: '1.5rem' }}>
        <div className={styles.statCard}><div className={styles.statLabel}>Yesterday&apos;s sales (uploaded)</div><div className={styles.statValue}>{inr(totalSales)}</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}>Short at latest counts</div>
          <div className={styles.statValue} style={{ color: totalShort < 0 ? 'var(--danger)' : undefined }}>{inr(totalShort)}</div></div>
        <div className={styles.statCard}><div className={styles.statLabel}>Stores with stock counted tonight</div>
          <div className={styles.statValue}>{rows.filter(r => r.due > 0 && r.counted >= r.due).length} / {rows.length}</div></div>
      </div>

      <div className={styles.card} style={{ overflowX: 'auto' }}>
        <table className={styles.table}>
          <thead>
            <tr><th>Store</th><th>Cash today</th><th>Stock counted</th><th>Yesterday&apos;s Rista files</th><th>Short / Excess</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td style={{ fontWeight: 600 }}>{r.name}<div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{r.brand}</div></td>
                <td>{r.cash === 'Both' ? ok(true) : <span className={styles.badgeDefault}>{r.cash}</span>}</td>
                <td>{r.due === 0 ? <span className={styles.badgeDefault}>Nothing due</span>
                  : r.counted >= r.due ? ok(true) : <span className={styles.badgeDefault}>{r.counted} / {r.due}</span>}</td>
                <td>Sales {ok(r.salesUploaded)} &nbsp; Usage {ok(r.usageUploaded)}</td>
                <td>
                  <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{inr(r.short)}</span>
                  {' / '}<span style={{ color: 'var(--success)' }}>{inr(r.excess)}</span>
                  {r.problems > 0 && <div style={{ fontSize: '0.75rem', color: 'var(--warning)' }}>{r.problems} delivery not entered?</div>}
                </td>
                <td><Link href="/super-admin/stock-report" className={styles.secondaryButton}
                  onClick={() => { try { localStorage.setItem('selectedStore', r.id); } catch { /* ignore */ } }}>Stock report</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
