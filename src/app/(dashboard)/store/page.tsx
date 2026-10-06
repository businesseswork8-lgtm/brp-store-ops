'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate } from '@/lib/dates';
import { Frequency, isDue } from '@/lib/stock/schedule';
import styles from './store.module.css';
import { isBRStore } from '@/lib/br';

type Step = { id: string; when: string; title: string; text: string; done: boolean; href: string; icon: string; note?: string };

export default function TonightPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [loading, setLoading] = useState(true);
  const [s, setS] = useState({
    morningCash: false, eveningCash: false,
    salesUploaded: false, usageUploaded: false,
    due: 0, counted: 0, received: 0, wasted: 0,
    // Baskin Robbins
    flavours: 0, opened: 0, closed: 0, todaySummary: false, todayItems: false,
  });
  const br = isBRStore(store);

  const today = istDate();
  const yesterday = addDays(today, -1);

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);
    const [{ data: cash }, { data: sales }, { data: usage }, { data: items }, { data: counts }, { data: rec }, { data: wst }] = await Promise.all([
      supabase.from('daily_cash_tally').select('tally_type').eq('store_id', store.id).eq('entry_date', today),
      supabase.from('daily_sales_summary').select('has_summary').eq('store_id', store.id).eq('entry_date', yesterday).maybeSingle(),
      supabase.from('rista_consumption_uploads').select('id').eq('store_id', store.id).lte('date_from', yesterday).gte('date_to', yesterday).limit(1),
      supabase.from('items').select('id, count_frequency, item_categories!inner(brand_id)')
        .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).neq('count_frequency', 'none'),
      supabase.from('stock_counts').select('item_id, count_date').eq('store_id', store.id)
        .gte('count_date', addDays(today, -62)).order('count_date', { ascending: false }).limit(5000),
      supabase.from('purchase_orders').select('id').eq('store_id', store.id).eq('entry_date', today),
      supabase.from('daily_wastage_log').select('id').eq('store_id', store.id).eq('entry_date', today),
    ]);
    let brx = { flavours: 0, opened: 0, closed: 0, todaySummary: false, todayItems: false };
    if (isBRStore(store)) {
      const [{ count: fl }, { data: weighed }, { data: todaySales }] = await Promise.all([
        supabase.from('items').select('id, item_categories!inner(brand_id, is_flavour)', { count: 'exact', head: true })
          .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).eq('item_categories.is_flavour', true),
        supabase.from('br_flavour_counts').select('session').eq('store_id', store.id).eq('count_date', today),
        supabase.from('daily_sales_summary').select('has_summary, has_items').eq('store_id', store.id).eq('entry_date', today).maybeSingle(),
      ]);
      brx = {
        flavours: fl || 0,
        opened: (weighed || []).filter(w => w.session === 'opening').length,
        closed: (weighed || []).filter(w => w.session === 'closing').length,
        todaySummary: Boolean(todaySales && todaySales.has_summary !== false),
        todayItems: Boolean(todaySales?.has_items),
      };
    }
    const last: Record<string, string> = {};
    (counts || []).forEach(c => { if (!last[c.item_id]) last[c.item_id] = c.count_date; });
    const due = (items || []).filter(i => isDue(i.count_frequency as Frequency, last[i.id] || null, today));
    setS({
      morningCash: Boolean(cash?.some(c => c.tally_type === 'morning')),
      eveningCash: Boolean(cash?.some(c => c.tally_type === 'evening')),
      salesUploaded: Boolean(sales && sales.has_summary !== false),
      usageUploaded: Boolean(usage && usage.length),
      due: due.length,
      counted: due.filter(i => last[i.id] === today).length,
      received: rec?.length || 0,
      wasted: wst?.length || 0,
      ...brx,
    });
    setLoading(false);
  }, [supabase, store, today, yesterday]);

  useEffect(() => { load(); }, [load]);

  if (storeLoading || (loading && store)) return <div className={styles.spinner}></div>;
  if (!store) {
    return (
      <div className={styles.container}>
        <div className={styles.message}>
          <h2>No store assigned</h2>
          <p>This login is not linked to a store yet. Please contact your manager.</p>
        </div>
      </div>
    );
  }

  const weighText = (n: number) => s.flavours ? `${n} of ${s.flavours} flavours weighed` : 'No flavours set up';
  const brSteps: Step[] = [
    { id: 'mcash', when: 'Opening', title: 'Count cash', text: 'Cash in the drawer at opening', done: s.morningCash, href: '/store/cash-tally', icon: '💰' },
    { id: 'open', when: 'Opening', title: 'Weigh ice cream', text: weighText(s.opened), done: s.flavours > 0 && s.opened >= s.flavours, href: '/store/count', icon: '🍨' },
    { id: 'close', when: 'Closing', title: 'Weigh ice cream', text: weighText(s.closed), done: s.flavours > 0 && s.closed >= s.flavours, href: '/store/count', icon: '🍨' },
    { id: 'upload', when: 'Closing', title: "Upload today's Rista files", text: 'After the last bill: Sales Summary + Sales By Items',
      done: s.todaySummary && s.todayItems, href: '/store/upload', icon: '📄',
      note: s.todaySummary !== s.todayItems ? (s.todaySummary ? 'Sales By Items still missing' : 'Sales Summary still missing') : undefined },
    { id: 'ecash', when: 'Closing', title: 'Count cash', text: 'Cash in the drawer at closing', done: s.eveningCash, href: '/store/cash-tally', icon: '💰' },
  ];
  const generalSteps: Step[] = [
    { id: 'mcash', when: 'Opening', title: 'Count cash', text: 'Cash in the drawer at opening', done: s.morningCash, href: '/store/cash-tally', icon: '💰' },
    { id: 'upload', when: 'Opening', title: "Upload yesterday's Rista files", text: 'Sales Summary + Consumption Variance, both for yesterday',
      done: s.salesUploaded && s.usageUploaded, href: '/store/upload', icon: '📄',
      note: s.salesUploaded !== s.usageUploaded ? (s.salesUploaded ? 'Consumption Variance still missing' : 'Sales Summary still missing') : undefined },
    { id: 'count', when: 'Closing', title: 'Count stock', text: s.due ? `${s.counted} of ${s.due} items counted` : 'Nothing due tonight',
      done: s.due === 0 || s.counted >= s.due, href: '/store/count', icon: '📦' },
    { id: 'ecash', when: 'Closing', title: 'Count cash', text: 'Cash in the drawer at closing', done: s.eveningCash, href: '/store/cash-tally', icon: '💰' },
  ];
  const steps = br ? brSteps : generalSteps;
  const doneCount = steps.filter(x => x.done).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>{store.name}</h1>
        <p className={styles.subtitle}>{displayDate()} · {doneCount} of {steps.length} done</p>
      </header>

      <div className={styles.statusGrid}>
        {steps.map((t, n) => (
          <Link key={t.id} href={t.href} className={`${styles.statusCard} ${t.done ? styles.completed : styles.pending}`} style={{ textDecoration: 'none' }}>
            <div className={styles.statusIcon}>{t.done ? '✅' : t.icon}</div>
            <div className={styles.statusContent}>
              <h3 className={styles.statusTitle}>{n + 1}. {t.title} <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)' }}>· {t.when}</span></h3>
              <p className={styles.statusText}>{t.text}</p>
              {t.note && <p className={styles.statusText} style={{ color: 'var(--warning)' }}>{t.note}</p>}
            </div>
          </Link>
        ))}
      </div>

      <h2 className={styles.categoryHeader} style={{ marginTop: '2rem' }}>Whenever it happens</h2>
      <div className={styles.statusGrid}>
        <Link href="/store/deliveries" className={`${styles.statusCard} ${styles.optional}`} style={{ textDecoration: 'none' }}>
          <div className={styles.statusIcon}>🚚</div>
          <div className={styles.statusContent}>
            <h3 className={styles.statusTitle}>{br ? 'Ice cream arrived' : 'Stock arrived'}</h3>
            <p className={styles.statusText}>{s.received ? `${s.received} entered today` : 'Enter it as soon as it arrives'}</p>
          </div>
        </Link>
        <Link href="/store/wastage" className={`${styles.statusCard} ${styles.optional}`} style={{ textDecoration: 'none' }}>
          <div className={styles.statusIcon}>🗑️</div>
          <div className={styles.statusContent}>
            <h3 className={styles.statusTitle}>{br ? 'Ice cream wasted' : 'Something wasted'}</h3>
            <p className={styles.statusText}>{s.wasted ? `${s.wasted} entered today` : 'Spilled, expired or dropped'}</p>
          </div>
        </Link>
      </div>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/store/eod-report" className={styles.backLink}>🖨️ Day Summary (to print or check)</Link>
      </p>
    </div>
  );
}
