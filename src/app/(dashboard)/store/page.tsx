'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, formatTime } from '@/lib/dates';
import { Frequency, isDue } from '@/lib/stock/schedule';
import styles from './store.module.css';
import { isBRStore } from '@/lib/br';

type Step = {
  id: string;
  when: string;
  title: string;
  text: string;
  done: boolean;
  href: string;
  icon: string;
  time?: string | null;
  amount?: string | null;
  note?: string;
};

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

export default function TonightPage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const [loading, setLoading] = useState(true);

  const [s, setS] = useState({
    morningCash: false,
    morningCashTime: null as string | null,
    morningCashAmount: null as number | null,
    eveningCash: false,
    eveningCashTime: null as string | null,
    eveningCashAmount: null as number | null,
    salesUploaded: false,
    salesUploadTime: null as string | null,
    salesUploadNet: null as number | null,
    usageUploaded: false,
    usageUploadTime: null as string | null,
    due: 0,
    counted: 0,
    received: 0,
    latestDeliveryTime: null as string | null,
    wasted: 0,
    latestWastageTime: null as string | null,
    // Baskin Robbins
    flavours: 0,
    opened: 0,
    openedTime: null as string | null,
    closed: 0,
    closedTime: null as string | null,
    todaySummary: false,
    todayItems: false,
    todaySalesTime: null as string | null,
    todaySalesNet: null as number | null,
  });

  const br = isBRStore(store);
  const today = istDate();
  const yesterday = addDays(today, -1);

  // Determine if it's late-night post-midnight closing hours (between 12:00 AM and 5:00 AM)
  const currentHour = new Date().getHours();
  const isLateNight = currentHour < 5;

  const load = useCallback(async () => {
    if (!store) return;
    setLoading(true);

    const [
      { data: cash },
      { data: sales },
      { data: usage },
      { data: items },
      { data: counts },
      { data: rec },
      { data: wst },
    ] = await Promise.all([
      supabase.from('daily_cash_tally').select('tally_type, total_amount, created_at')
        .eq('store_id', store.id).eq('entry_date', today),
      supabase.from('daily_sales_summary').select('has_summary, net_sales, created_at')
        .eq('store_id', store.id).eq('entry_date', yesterday).maybeSingle(),
      supabase.from('rista_consumption_uploads').select('id, created_at')
        .eq('store_id', store.id).lte('date_from', yesterday).gte('date_to', yesterday).order('created_at', { ascending: false }).limit(1),
      supabase.from('items').select('id, count_frequency, item_categories!inner(brand_id)')
        .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).neq('count_frequency', 'none'),
      supabase.from('stock_counts').select('item_id, count_date, created_at, updated_at')
        .eq('store_id', store.id).gte('count_date', addDays(today, -62)).order('count_date', { ascending: false }).limit(5000),
      supabase.from('purchase_orders').select('id, created_at')
        .eq('store_id', store.id).eq('entry_date', today).order('created_at', { ascending: false }),
      supabase.from('daily_wastage_log').select('id, created_at')
        .eq('store_id', store.id).eq('entry_date', today).order('created_at', { ascending: false }),
    ]);

    let brx = {
      flavours: 0,
      opened: 0,
      openedTime: null as string | null,
      closed: 0,
      closedTime: null as string | null,
      todaySummary: false,
      todayItems: false,
      todaySalesTime: null as string | null,
      todaySalesNet: null as number | null,
    };

    if (isBRStore(store)) {
      const [{ count: fl }, { data: weighed }, { data: todaySales }] = await Promise.all([
        supabase.from('items').select('id, item_categories!inner(brand_id, is_flavour)', { count: 'exact', head: true })
          .eq('is_active', true).eq('item_categories.brand_id', store.brand_id).eq('item_categories.is_flavour', true),
        supabase.from('br_flavour_counts').select('session, created_at, updated_at')
          .eq('store_id', store.id).eq('count_date', today),
        supabase.from('daily_sales_summary').select('has_summary, has_items, net_sales, created_at')
          .eq('store_id', store.id).eq('entry_date', today).maybeSingle(),
      ]);

      const openWeighed = (weighed || []).filter(w => w.session === 'opening');
      const closeWeighed = (weighed || []).filter(w => w.session === 'closing');

      const latestOpenTime = openWeighed.reduce<string | null>((latest, w) => {
        const t = w.updated_at || w.created_at;
        return !latest || (t && t > latest) ? t : latest;
      }, null);

      const latestCloseTime = closeWeighed.reduce<string | null>((latest, w) => {
        const t = w.updated_at || w.created_at;
        return !latest || (t && t > latest) ? t : latest;
      }, null);

      brx = {
        flavours: fl || 0,
        opened: openWeighed.length,
        openedTime: latestOpenTime ? formatTime(latestOpenTime) : null,
        closed: closeWeighed.length,
        closedTime: latestCloseTime ? formatTime(latestCloseTime) : null,
        todaySummary: Boolean(todaySales && todaySales.has_summary !== false),
        todayItems: Boolean(todaySales?.has_items),
        todaySalesTime: todaySales?.created_at ? formatTime(todaySales.created_at) : null,
        todaySalesNet: todaySales ? Number(todaySales.net_sales) : null,
      };
    }

    const mCash = cash?.find(c => c.tally_type === 'morning');
    const eCash = cash?.find(c => c.tally_type === 'evening');

    const last: Record<string, string> = {};
    (counts || []).forEach(c => { if (!last[c.item_id]) last[c.item_id] = c.count_date; });
    const due = (items || []).filter(i => isDue(i.count_frequency as Frequency, last[i.id] || null, today));

    setS({
      morningCash: Boolean(mCash),
      morningCashTime: mCash?.created_at ? formatTime(mCash.created_at) : null,
      morningCashAmount: mCash ? Number(mCash.total_amount) : null,
      eveningCash: Boolean(eCash),
      eveningCashTime: eCash?.created_at ? formatTime(eCash.created_at) : null,
      eveningCashAmount: eCash ? Number(eCash.total_amount) : null,
      salesUploaded: Boolean(sales && sales.has_summary !== false),
      salesUploadTime: sales?.created_at ? formatTime(sales.created_at) : null,
      salesUploadNet: sales ? Number(sales.net_sales) : null,
      usageUploaded: Boolean(usage && usage.length),
      usageUploadTime: usage?.[0]?.created_at ? formatTime(usage[0].created_at) : null,
      due: due.length,
      counted: due.filter(i => last[i.id] === today).length,
      received: rec?.length || 0,
      latestDeliveryTime: rec?.[0]?.created_at ? formatTime(rec[0].created_at) : null,
      wasted: wst?.length || 0,
      latestWastageTime: wst?.[0]?.created_at ? formatTime(wst[0].created_at) : null,
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

  // Descriptions with exact recorded times and amounts
  const brSteps: Step[] = [
    {
      id: 'mcash',
      when: 'Opening',
      title: 'Count cash',
      text: s.morningCash
        ? `Counted at ${s.morningCashTime}${s.morningCashAmount !== null ? ` · ${inr(s.morningCashAmount)}` : ''}`
        : 'Count drawer cash before store opening',
      done: s.morningCash,
      href: '/store/cash-tally',
      icon: '💰',
      time: s.morningCashTime,
    },
    {
      id: 'open',
      when: 'Opening',
      title: 'Weigh ice cream',
      text: s.flavours > 0 && s.opened >= s.flavours
        ? `All ${s.flavours} flavours weighed at ${s.openedTime}`
        : s.opened > 0
          ? `${s.opened} of ${s.flavours} weighed · Last at ${s.openedTime}`
          : s.flavours > 0 ? `Weigh ${s.flavours} tubs before store opening` : 'No flavours set up',
      done: s.flavours > 0 && s.opened >= s.flavours,
      href: '/store/count',
      icon: '🍨',
      time: s.openedTime,
    },
    {
      id: 'close',
      when: 'Closing',
      title: 'Weigh ice cream',
      text: s.flavours > 0 && s.closed >= s.flavours
        ? `All ${s.flavours} flavours weighed at ${s.closedTime}`
        : s.closed > 0
          ? `${s.closed} of ${s.flavours} weighed · Last at ${s.closedTime}`
          : 'Weigh all tubs after last bill at closing',
      done: s.flavours > 0 && s.closed >= s.flavours,
      href: '/store/count',
      icon: '🍨',
      time: s.closedTime,
    },
    {
      id: 'upload',
      when: 'Closing',
      title: "Upload today's Rista files",
      text: s.todaySummary && s.todayItems
        ? `Uploaded at ${s.todaySalesTime}${s.todaySalesNet !== null ? ` · Net ${inr(s.todaySalesNet)}` : ''}`
        : 'After last bill: Sales Summary + Sales By Items',
      done: s.todaySummary && s.todayItems,
      href: '/store/upload',
      icon: '📄',
      time: s.todaySalesTime,
      note: s.todaySummary !== s.todayItems
        ? (s.todaySummary ? 'Sales By Items still missing' : 'Sales Summary still missing')
        : undefined,
    },
    {
      id: 'ecash',
      when: 'Closing',
      title: 'Count cash',
      text: s.eveningCash
        ? `Counted at ${s.eveningCashTime}${s.eveningCashAmount !== null ? ` · ${inr(s.eveningCashAmount)}` : ''}`
        : 'Count drawer cash at closing',
      done: s.eveningCash,
      href: '/store/cash-tally',
      icon: '💰',
      time: s.eveningCashTime,
    },
  ];

  const generalSteps: Step[] = [
    {
      id: 'mcash',
      when: 'Opening',
      title: 'Count cash',
      text: s.morningCash
        ? `Counted at ${s.morningCashTime}${s.morningCashAmount !== null ? ` · ${inr(s.morningCashAmount)}` : ''}`
        : 'Cash in drawer at opening',
      done: s.morningCash,
      href: '/store/cash-tally',
      icon: '💰',
      time: s.morningCashTime,
    },
    {
      id: 'upload',
      when: 'Opening',
      title: "Upload yesterday's Rista files",
      text: s.salesUploaded && s.usageUploaded
        ? `Uploaded at ${s.salesUploadTime}`
        : 'Sales Summary + Consumption Variance for yesterday',
      done: s.salesUploaded && s.usageUploaded,
      href: '/store/upload',
      icon: '📄',
      time: s.salesUploadTime,
      note: s.salesUploaded !== s.usageUploaded
        ? (s.salesUploaded ? 'Consumption Variance still missing' : 'Sales Summary still missing')
        : undefined,
    },
    {
      id: 'count',
      when: 'Closing',
      title: 'Count stock',
      text: s.due ? `${s.counted} of ${s.due} items counted` : 'Nothing due tonight',
      done: s.due === 0 || s.counted >= s.due,
      href: '/store/count',
      icon: '📦',
    },
    {
      id: 'ecash',
      when: 'Closing',
      title: 'Count cash',
      text: s.eveningCash
        ? `Counted at ${s.eveningCashTime}${s.eveningCashAmount !== null ? ` · ${inr(s.eveningCashAmount)}` : ''}`
        : 'Cash in drawer at closing',
      done: s.eveningCash,
      href: '/store/cash-tally',
      icon: '💰',
      time: s.eveningCashTime,
    },
  ];

  const steps = br ? brSteps : generalSteps;
  const doneCount = steps.filter(x => x.done).length;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>{store.name}</h1>
          <p className={styles.subtitle}>{displayDate()} · {doneCount} of {steps.length} done</p>
        </div>
      </header>

      {/* Real-time Shift & Clock context banner */}
      <div className={styles.shiftBanner}>
        <div className={styles.shiftInfo}>
          <span className={styles.shiftLabel}>Active Shift Operating Date</span>
          <strong className={styles.shiftDate}>{displayDate()}</strong>
        </div>
        <div className={styles.clockInfo}>
          <span className={styles.clockTime}>🕒 Current Time: {formatTime(new Date())}</span>
          {isLateNight && (
            <span className={styles.lateNightBadge}>
              🌙 Post-midnight closing shift (activities recorded for {displayDate()})
            </span>
          )}
        </div>
      </div>

      <div className={styles.statusGrid}>
        {steps.map((t, n) => (
          <Link
            key={t.id}
            href={t.href}
            className={`${styles.statusCard} ${t.done ? styles.completed : styles.pending}`}
            style={{ textDecoration: 'none' }}
          >
            <div className={styles.statusIcon}>{t.done ? '✅' : t.icon}</div>
            <div className={styles.statusContent}>
              <h3 className={styles.statusTitle}>
                {n + 1}. {t.title}{' '}
                <span style={{ fontSize: '0.75rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                  · {t.when}
                </span>
              </h3>
              <p className={styles.statusText}>{t.text}</p>
              {t.time && (
                <span className={`${styles.timeBadge} ${t.done ? styles.timeBadgeDone : ''}`}>
                  🕒 {t.time}
                </span>
              )}
              {t.note && <p className={styles.statusText} style={{ color: 'var(--warning)', marginTop: '0.35rem' }}>{t.note}</p>}
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
            <p className={styles.statusText}>
              {s.received
                ? `${s.received} entered today${s.latestDeliveryTime ? ` · Last at ${s.latestDeliveryTime}` : ''}`
                : 'Enter it as soon as it arrives'}
            </p>
            {s.latestDeliveryTime && (
              <span className={styles.timeBadge}>
                🕒 Last: {s.latestDeliveryTime}
              </span>
            )}
          </div>
        </Link>
        <Link href="/store/wastage" className={`${styles.statusCard} ${styles.optional}`} style={{ textDecoration: 'none' }}>
          <div className={styles.statusIcon}>🗑️</div>
          <div className={styles.statusContent}>
            <h3 className={styles.statusTitle}>{br ? 'Ice cream wasted' : 'Something wasted'}</h3>
            <p className={styles.statusText}>
              {s.wasted
                ? `${s.wasted} entered today${s.latestWastageTime ? ` · Last at ${s.latestWastageTime}` : ''}`
                : 'Spilled, expired or dropped'}
            </p>
            {s.latestWastageTime && (
              <span className={styles.timeBadge}>
                🕒 Last: {s.latestWastageTime}
              </span>
            )}
          </div>
        </Link>
      </div>

      <p style={{ marginTop: '2rem' }}>
        <Link href="/store/eod-report" className={styles.backLink}>🖨️ Day Summary (to print or check)</Link>
      </p>
    </div>
  );
}
