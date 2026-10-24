'use client';

import React, { useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { displayUnit, toDisplay } from '@/lib/stock/units';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays, displayDate, shortDate, formatDateTime, formatTime } from '@/lib/dates';
import styles from '../store.module.css';
import { isBRStore, toReportRows, BRReportRow, grams, signedGrams, repairLateNightBRCounts } from '@/lib/br';

export default function EODReportPage() {
  const { supabase, store: activeStore, stores, selectStore, profile, loading: storeLoading } = useActiveStore();
  const todayDate = istDate();
  const yesterdayDate = addDays(todayDate, -1);

  const [selectedDate, setSelectedDate] = useState<string>(todayDate);
  const [loading, setLoading] = useState(true);

  const [posSales, setPosSales] = useState<any>(null);
  const [morningCashData, setMorningCashData] = useState<any>(null);
  const [eveningCashData, setEveningCashData] = useState<any>(null);
  const [cashTransactions, setCashTransactions] = useState<any[]>([]);
  const [wastageList, setWastageList] = useState<any[]>([]);
  const [deliveriesList, setDeliveriesList] = useState<any[]>([]);
  const [openingWeighInfo, setOpeningWeighInfo] = useState<{ count: number; time: string | null; sub?: string } | null>(null);
  const [closingWeighInfo, setClosingWeighInfo] = useState<{ count: number; time: string | null } | null>(null);
  const [usageUploadInfo, setUsageUploadInfo] = useState<{ time: string | null } | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [varianceAlerts, setVarianceAlerts] = useState<any[]>([]);
  const [stockNote, setStockNote] = useState<string | null>(null);
  const [stockError, setStockError] = useState<string | null>(null);
  const [brRows, setBrRows] = useState<BRReportRow[] | null>(null);

  // Support ?date=YYYY-MM-DD from All Stores links
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const d = params.get('date');
      if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
        setSelectedDate(d);
      }
    }
  }, []);

  const loadStoreData = useCallback(async () => {
    if (!activeStore) { if (!storeLoading) setLoading(false); return; }
    setLoading(true);
    const storeId = activeStore.id;
    const isBR = isBRStore(activeStore);

    if (isBR) {
      await repairLateNightBRCounts(supabase, storeId);
    }

    const [
      { data: salesData },
      { data: cash },
      { data: txs },
      { data: wastage },
      { data: deliveries },
      { data: flavourCounts },
      { data: generalDayCounts },
      { data: generalPrevCounts },
      { data: usageUploads },
      { data: rpcData, error: rpcErr },
    ] = await Promise.all([
      supabase.from('daily_sales_summary').select('*, staff_members(name)').eq('store_id', storeId).eq('entry_date', selectedDate).maybeSingle(),
      supabase.from('daily_cash_tally').select('*, staff_members(name)').eq('store_id', storeId).eq('entry_date', selectedDate),
      supabase.from('daily_cash_transactions').select('*, staff_members(name)').eq('store_id', storeId).eq('entry_date', selectedDate).order('created_at', { ascending: true }),
      supabase.from('daily_wastage_log').select('id, quantity_wasted, created_at, items(name)').eq('store_id', storeId).eq('entry_date', selectedDate).order('created_at', { ascending: true }),
      supabase.from('purchase_orders').select('id, quantity, created_at, items(name)').eq('store_id', storeId).eq('entry_date', selectedDate).order('created_at', { ascending: true }),
      supabase.from('br_flavour_counts').select('session, created_at, updated_at, staff_members(name)').eq('store_id', storeId).eq('count_date', selectedDate),
      supabase.from('stock_counts').select('item_id, created_at').eq('store_id', storeId).eq('entry_date', selectedDate),
      supabase.from('stock_counts').select('entry_date, created_at').eq('store_id', storeId).lt('entry_date', selectedDate).order('entry_date', { ascending: false }).limit(20),
      supabase.from('rista_consumption_uploads').select('uploaded_at').eq('store_id', storeId).lte('date_from', selectedDate).gte('date_to', selectedDate),
      supabase.rpc('stock_variance_report', { p_store_id: storeId, p_from: null, p_to: selectedDate }),
    ]);

    if (isBR) {
      const { data: br, error: brErr } = await supabase.rpc('br_daily_report', { p_store_id: storeId, p_date: selectedDate });
      setBrRows(brErr ? [] : toReportRows(br));
    } else {
      setBrRows(null);
    }

    setPosSales(salesData && salesData.has_summary !== false ? salesData : null);

    const m = cash?.find(c => c.tally_type === 'morning');
    const e = cash?.find(c => c.tally_type === 'evening');
    setMorningCashData(m || null);
    setEveningCashData(e || null);

    setCashTransactions(txs || []);
    setWastageList(wastage || []);
    setDeliveriesList(deliveries || []);

    if (isBR) {
      // Compute BR flavour count timings
      if (flavourCounts && flavourCounts.length > 0) {
        const openCounts = flavourCounts.filter(f => f.session === 'opening');
        const closeCounts = flavourCounts.filter(f => f.session === 'closing');

        const latestOpen = openCounts.reduce<string | null>((latest, f) => {
          const t = f.updated_at || f.created_at;
          return !latest || (t && t > latest) ? t : latest;
        }, null);

        const latestClose = closeCounts.reduce<string | null>((latest, f) => {
          const t = f.updated_at || f.created_at;
          return !latest || (t && t > latest) ? t : latest;
        }, null);

        setOpeningWeighInfo(openCounts.length > 0 ? { count: openCounts.length, time: latestOpen } : null);
        setClosingWeighInfo(closeCounts.length > 0 ? { count: closeCounts.length, time: latestClose } : null);
      } else {
        setOpeningWeighInfo(null);
        setClosingWeighInfo(null);
      }
      setUsageUploadInfo(null);
    } else {
      // 99 Pancakes: previous closing count is opening baseline; today's stock_counts is closing count
      const prevDate = generalPrevCounts && generalPrevCounts.length > 0 ? (generalPrevCounts[0] as any).entry_date : null;
      const prevRowsForDate = prevDate ? (generalPrevCounts as any[]).filter(c => c.entry_date === prevDate) : [];
      const prevTime = prevRowsForDate.reduce<string | null>((acc, c) => (!acc || (c.created_at && c.created_at > acc) ? c.created_at : acc), null);

      setOpeningWeighInfo(
        prevDate
          ? { count: prevRowsForDate.length, time: prevTime, sub: `From ${shortDate(prevDate)} closing count` }
          : null
      );

      const closeRows = generalDayCounts || [];
      const closeTime = closeRows.reduce<string | null>((acc, c: any) => (!acc || (c.created_at && c.created_at > acc) ? c.created_at : acc), null);
      setClosingWeighInfo(closeRows.length > 0 ? { count: closeRows.length, time: closeTime } : null);

      const uRows = usageUploads || [];
      const uTime = uRows.reduce<string | null>((acc, u: any) => (!acc || (u.uploaded_at && u.uploaded_at > acc) ? u.uploaded_at : acc), null);
      setUsageUploadInfo(uRows.length > 0 ? { time: uTime } : null);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = ((rpcData as any[]) || []);
    setStockError(rpcErr ? rpcErr.message : null);

    // Items counted on this day, checked against their previous count
    const today = rows.filter(r => r.closing_date === selectedDate);
    setVarianceAlerts(today.filter(r => r.status === 'SHORT' || r.status === 'CHECK_RECEIVED'));
    const incomplete = today.filter(r => ['SALES_DATA_MISSING', 'NO_SKU', 'UNIT_MISMATCH'].includes(r.status)).length;
    setStockNote(
      rpcErr ? null
      : today.length === 0 ? 'No stock was counted on this day (or items have no earlier count yet).'
      : incomplete ? `${incomplete} item(s) can't be checked yet — Rista usage not uploaded for some days, or item not linked to Rista.`
      : null
    );
    setLoading(false);
  }, [supabase, activeStore, selectedDate, storeLoading]);

  useEffect(() => { loadStoreData(); }, [loadStoreData]);

  const morningCash = morningCashData ? Number(morningCashData.total_amount) : null;
  const eveningCash = eveningCashData ? Number(eveningCashData.total_amount) : null;

  const expensesTotal = cashTransactions
    .filter(t => t.tx_type === 'expense')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  const depositsTotal = cashTransactions
    .filter(t => t.tx_type === 'bank_deposit')
    .reduce((s, t) => s + Number(t.amount || 0), 0);

  // Cash check: morning cash + cash sales - expenses - bank deposits should equal evening cash
  const expectedCash = morningCash !== null && posSales
    ? morningCash + Number(posSales.cash_amount || 0) - expensesTotal - depositsTotal
    : null;
  const cashDiff = expectedCash !== null && eveningCash !== null ? eveningCash - expectedCash : null;
  const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

  const formatCurrency = (val: number | null | undefined) => {
    if (val === null || val === undefined) return 'N/A';
    return `₹ ${Number(val).toLocaleString('en-IN')}`;
  };

  const isBR = isBRStore(activeStore);
  const isAdminUser = profile?.role === 'super_admin' || profile?.role === 'admin';

  return (
    <div className={styles.container}>
      {/* 1-Click Store Switcher Bar for Admin / Multi-store users */}
      {stores.length > 1 && (
        <div style={{
          marginBottom: '1rem',
          padding: '0.65rem 1.1rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: '12px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.78rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginRight: '0.25rem' }}>
              🏬 Switch Store:
            </span>
            {stores.map(s => {
              const active = activeStore?.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => selectStore(s.id)}
                  style={{
                    padding: '0.4rem 0.85rem',
                    borderRadius: '8px',
                    border: active ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
                    background: active ? 'var(--accent-primary)' : 'var(--bg-card)',
                    color: active ? '#fff' : 'var(--text-primary)',
                    fontWeight: active ? 700 : 500,
                    fontSize: '0.84rem',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span>{isBRStore(s) ? '🍨' : '🥞'}</span>
                  <span>{s.name}</span>
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            {isAdminUser && (
              <>
                <Link href="/super-admin" className={styles.backLink} style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}>
                  ← All Stores
                </Link>
                <Link href={`/super-admin/stock-report?date=${selectedDate}`} className={styles.backLink} style={{ padding: '0.38rem 0.75rem', fontSize: '0.8rem' }}>
                  📊 Stock Report
                </Link>
              </>
            )}
          </div>
        </div>
      )}

      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 className={styles.title}>🖨️ Day Summary (EOD Report){activeStore ? ` — ${activeStore.name}` : ''}</h1>
          <p className={styles.subtitle}>
            Sales Day: <strong>{displayDate(selectedDate)}</strong> · Opening, Closing (including post-midnight up to 6:00 AM), Cash &amp; Stock
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={() => window.print()}
            style={{
              padding: '0.6rem 1.2rem',
              background: 'var(--accent-primary)',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            🖨️ Print / Save PDF
          </button>
          <Link href="/store" className={styles.backLink}>← Back to Store</Link>
        </div>
      </header>

      {/* Unified Sales Day (Operating Shift Date) Bar */}
      <div className={styles.card} style={{
        marginBottom: '1.5rem',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '1rem',
        background: 'linear-gradient(90deg, rgba(95,107,255,0.10), rgba(0,200,83,0.05))',
        border: '1px solid rgba(95,107,255,0.3)',
      }}>
        <div>
          <span style={{ fontSize: '0.78rem', color: '#9aa4ff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            📅 Viewing Sales Day (Shift Operating Date)
          </span>
          <div style={{ fontSize: '1.15rem', fontWeight: 700, marginTop: '0.15rem' }}>
            {displayDate(selectedDate)}
            {selectedDate === todayDate && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(0,200,83,0.18)', color: '#69f0ae', fontWeight: 600 }}>
                Active Shift
              </span>
            )}
            {selectedDate === yesterdayDate && (
              <span style={{ marginLeft: '0.6rem', fontSize: '0.75rem', padding: '0.2rem 0.55rem', borderRadius: '999px', background: 'rgba(255,214,0,0.16)', color: '#ffd740', fontWeight: 600 }}>
                Yesterday&apos;s Shift
              </span>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => setSelectedDate(yesterdayDate)}
            style={{
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              border: selectedDate === yesterdayDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
              background: selectedDate === yesterdayDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: selectedDate === yesterdayDate ? '#fff' : 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            ⏮️ Yesterday ({shortDate(yesterdayDate)})
          </button>
          <button
            type="button"
            onClick={() => setSelectedDate(todayDate)}
            style={{
              padding: '0.45rem 0.85rem',
              borderRadius: '8px',
              border: selectedDate === todayDate ? '1px solid var(--accent-primary)' : '1px solid var(--border-color)',
              background: selectedDate === todayDate ? 'var(--accent-primary)' : 'var(--bg-secondary)',
              color: selectedDate === todayDate ? '#fff' : 'var(--text-primary)',
              fontWeight: 600,
              fontSize: '0.85rem',
              cursor: 'pointer',
            }}
          >
            📅 Active Shift ({shortDate(todayDate)})
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
            max={todayDate}
            onChange={e => e.target.value && setSelectedDate(e.target.value)}
            style={{ padding: '0.45rem 0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
          />
          <button
            type="button"
            onClick={() => selectedDate < todayDate && setSelectedDate(addDays(selectedDate, 1))}
            disabled={selectedDate >= todayDate}
            style={{ padding: '0.45rem 0.7rem', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)', cursor: 'pointer', opacity: selectedDate >= todayDate ? 0.4 : 1 }}
            title="Next Day"
          >
            ›
          </button>
        </div>
      </div>

      {loading ? (
        <div className={styles.card} style={{ textAlign: 'center', padding: '3rem' }}>
          Compiling End-of-Day summary...
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>

          {/* Operations Audit Trail & Timestamps */}
          <div className={styles.timelineCard}>
            <div className={styles.timelineTitle}>
              🕒 Operational Timeline &amp; Exact Activity Timestamps — Sales Day: {displayDate(selectedDate)}
            </div>
            <p className={styles.subtitle} style={{ marginBottom: '1rem' }}>
              Exact date &amp; time when staff recorded each opening, closing, cash, and stock entry for this Sales Day (closing entries after midnight up to 6:00 AM are automatically matched here):
            </p>
            <div className={styles.timelineGrid}>
              {/* Morning Cash */}
              <div className={`${styles.timelineItem} ${morningCashData ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>💰 Opening Cash Count</span>
                  {morningCashData?.created_at ? (
                    <span className={styles.timelineTime}>{formatDateTime(morningCashData.created_at)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>Not counted</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {morningCashData
                    ? `${formatCurrency(morningCashData.total_amount)}${morningCashData.staff_members?.name ? ` · by ${morningCashData.staff_members.name}` : ''}`
                    : 'Drawer cash at opening'}
                </div>
              </div>

              {/* Opening Stock Weigh / Baseline */}
              <div className={`${styles.timelineItem} ${openingWeighInfo ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>
                    {isBR ? '🍨 Opening Flavour Weigh' : '🥞 Opening Stock Baseline'}
                  </span>
                  {openingWeighInfo?.time ? (
                    <span className={styles.timelineTime}>{formatDateTime(openingWeighInfo.time)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>{isBR ? 'Not weighed' : 'No prior count'}</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {isBR
                    ? (openingWeighInfo ? `${openingWeighInfo.count} flavours weighed before opening` : 'Opening stock count')
                    : (openingWeighInfo?.sub || 'Previous closing count serves as opening stock')}
                </div>
              </div>

              {/* Deliveries */}
              <div className={`${styles.timelineItem} ${deliveriesList.length > 0 ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>🚚 Stock Deliveries</span>
                  {deliveriesList.length > 0 ? (
                    <span className={styles.timelineTime}>{formatDateTime(deliveriesList[deliveriesList.length - 1].created_at)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>None</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {deliveriesList.length > 0 ? `${deliveriesList.length} delivery receipt(s) entered` : 'No deliveries recorded'}
                </div>
              </div>

              {/* Wastage */}
              <div className={`${styles.timelineItem} ${wastageList.length > 0 ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>🗑️ Wastage Logged</span>
                  {wastageList.length > 0 ? (
                    <span className={styles.timelineTime}>{formatDateTime(wastageList[wastageList.length - 1].created_at)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>None</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {wastageList.length > 0 ? `${wastageList.length} wastage log(s) recorded` : 'No wastage logged'}
                </div>
              </div>

              {/* Closing Stock Weigh / Count */}
              <div className={`${styles.timelineItem} ${closingWeighInfo ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>
                    {isBR ? '🍨 Closing Flavour Weigh' : '🥞 Closing Stock Count'}
                  </span>
                  {closingWeighInfo?.time ? (
                    <span className={styles.timelineTime}>{formatDateTime(closingWeighInfo.time)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>{isBR ? 'Not weighed' : 'Not counted'}</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {closingWeighInfo
                    ? `${closingWeighInfo.count} ${isBR ? 'flavours weighed' : 'items counted'} at closing`
                    : 'Closing inventory after last bill'}
                </div>
              </div>

              {/* Evening Cash */}
              <div className={`${styles.timelineItem} ${eveningCashData ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>💰 Closing Cash Count</span>
                  {eveningCashData?.created_at ? (
                    <span className={styles.timelineTime}>{formatDateTime(eveningCashData.created_at)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>Not counted</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {eveningCashData
                    ? `${formatCurrency(eveningCashData.total_amount)}${eveningCashData.staff_members?.name ? ` · by ${eveningCashData.staff_members.name}` : ''}`
                    : 'Drawer cash at closing'}
                </div>
              </div>

              {/* Rista Upload */}
              <div className={`${styles.timelineItem} ${posSales ? styles.timelineItemDone : ''}`}>
                <div className={styles.timelineHeader}>
                  <span className={styles.timelineLabel}>📄 Rista Sales Upload</span>
                  {posSales?.created_at ? (
                    <span className={styles.timelineTime}>{formatDateTime(posSales.created_at)}</span>
                  ) : (
                    <span className={styles.timelineTimeMissing}>Not uploaded</span>
                  )}
                </div>
                <div className={styles.timelineMeta}>
                  {posSales ? `Net: ${formatCurrency(posSales.net_sales)} · ${posSales.total_orders || 0} orders` : 'Rista daily sales files'}
                </div>
              </div>

              {/* Rista Usage Upload (for 99 Pancakes) */}
              {!isBR && (
                <div className={`${styles.timelineItem} ${usageUploadInfo ? styles.timelineItemDone : ''}`}>
                  <div className={styles.timelineHeader}>
                    <span className={styles.timelineLabel}>📊 Rista Usage Upload</span>
                    {usageUploadInfo?.time ? (
                      <span className={styles.timelineTime}>{formatDateTime(usageUploadInfo.time)}</span>
                    ) : (
                      <span className={styles.timelineTimeMissing}>Not uploaded</span>
                    )}
                  </div>
                  <div className={styles.timelineMeta}>
                    {usageUploadInfo ? 'Consumption Variance uploaded' : 'Required to calculate recipe usage'}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Section 1: Sales Revenue Summary */}
          <div className={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
              <h3 style={{ margin: 0, color: 'var(--accent-primary)' }}>1. Sales Summary</h3>
              {posSales?.created_at && (
                <span className={styles.timeBadge} style={{ background: 'rgba(0,200,83,0.1)', color: '#81c784' }}>
                  🕒 Uploaded on {formatDateTime(posSales.created_at)}
                </span>
              )}
            </div>
            {posSales ? (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '1rem' }}>
                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Net Sales</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--success)' }}>
                    {formatCurrency(posSales.net_sales)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gross Sales</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>
                    {formatCurrency(posSales.gross_sales)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Discounts</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: 'var(--warning)' }}>
                    {formatCurrency(posSales.total_discount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🛵 Swiggy Revenue</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#fc8019' }}>
                    {formatCurrency(posSales.swiggy_amount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🔴 Zomato Revenue</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, color: '#cb202d' }}>
                    {formatCurrency(posSales.zomato_amount)}
                  </div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>💵 Cash</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.cash_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>📱 UPI</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.upi_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>💳 Card</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{formatCurrency(posSales.card_amount)}</div>
                </div>

                <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🧾 Orders</div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>{posSales.total_orders}</div>
                </div>
              </div>
            ) : (
              <div style={{ padding: '1rem', color: 'var(--warning)', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                ⚠ Sales Summary has not been uploaded for {selectedDate} yet.
              </div>
            )}
          </div>

          {/* Section 2: Cash Denomination Tallies */}
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>2. Cash Reconciliation</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Morning cash count (Opening)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {morningCash !== null ? formatCurrency(morningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
                {morningCashData?.created_at && (
                  <div style={{ fontSize: '0.775rem', color: '#81c784', marginTop: '0.35rem' }}>
                    🕒 Counted at {formatDateTime(morningCashData.created_at)}
                    {morningCashData.staff_members?.name ? ` by ${morningCashData.staff_members.name}` : ''}
                  </div>
                )}
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Evening cash count (Closing)</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, marginTop: '0.25rem' }}>
                  {eveningCash !== null ? formatCurrency(eveningCash) : <span style={{ color: 'var(--warning)', fontSize: '1rem' }}>Pending</span>}
                </div>
                {eveningCashData?.created_at && (
                  <div style={{ fontSize: '0.775rem', color: '#81c784', marginTop: '0.35rem' }}>
                    🕒 Counted at {formatDateTime(eveningCashData.created_at)}
                    {eveningCashData.staff_members?.name ? ` by ${eveningCashData.staff_members.name}` : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Expenses & Deposits Summary */}
            {(expensesTotal > 0 || depositsTotal > 0) && (
              <div style={{ marginTop: '1rem', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,23,68,0.06)', border: '1px solid rgba(255,23,68,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Daily Cash Expenses (Tea, etc.)</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--danger)', marginTop: '0.2rem' }}>
                    - {formatCurrency(expensesTotal)}
                  </div>
                  {cashTransactions.filter(t => t.tx_type === 'expense').length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {cashTransactions.filter(t => t.tx_type === 'expense').map(t => `${t.category}: ₹${t.amount} (${formatTime(t.created_at)})`).join(', ')}
                    </div>
                  )}
                </div>

                <div style={{ padding: '0.75rem 1rem', background: 'rgba(255,214,0,0.06)', border: '1px solid rgba(255,214,0,0.2)', borderRadius: '8px' }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Bank Cash Deposits</div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--warning)', marginTop: '0.2rem' }}>
                    - {formatCurrency(depositsTotal)}
                  </div>
                  {cashTransactions.filter(t => t.tx_type === 'bank_deposit').length > 0 && (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                      {cashTransactions.filter(t => t.tx_type === 'bank_deposit').map(t => `${t.category}: ₹${t.amount} (${formatTime(t.created_at)})`).join(', ')}
                    </div>
                  )}
                </div>
              </div>
            )}

            <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '8px', background: 'var(--bg-secondary)' }}>
              {cashDiff === null ? (
                <span style={{ color: 'var(--text-secondary)' }}>
                  Cash check needs: morning count, evening count and the Sales Summary upload.
                </span>
              ) : (
                <>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                    Morning {formatCurrency(morningCash)} + cash sales {formatCurrency(posSales.cash_amount)}
                    {expensesTotal > 0 ? ` − expenses ${formatCurrency(expensesTotal)}` : ''}
                    {depositsTotal > 0 ? ` − bank deposit ${formatCurrency(depositsTotal)}` : ''}
                    {' '}= expected {formatCurrency(expectedCash)}
                  </div>
                  <div style={{ fontSize: '1.3rem', fontWeight: 700, marginTop: '0.25rem',
                    color: Math.abs(cashDiff) < 1 ? 'var(--success)' : cashDiff < 0 ? 'var(--danger)' : 'var(--warning)' }}>
                    {Math.abs(cashDiff) < 1 ? '✓ Cash matches'
                      : cashDiff < 0 ? `⚠ Short by ${formatCurrency(-cashDiff)}` : `Extra ${formatCurrency(cashDiff)}`}
                  </div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                    ✓ Shift expenses &amp; bank deposits are accounted for in expected cash.
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Section 3 (Baskin Robbins): ice cream per flavour */}
          {brRows && (() => {
            const effectiveAllow = (r: BRReportRow) => Math.max(20, r.allowance > 0 ? r.allowance : Math.round(r.sold * 0.05));
            const counted = brRows.filter(r => r.opening !== null && r.closing !== null).length;
            const bad = brRows.filter(r => {
              const allow = effectiveAllow(r);
              const gap = r.gap ?? 0;
              return r.opening !== null && r.closing !== null && gap > allow;
            });
            const totalShortage = brRows.reduce((sum, r) => {
              const allow = effectiveAllow(r);
              const gap = r.gap ?? 0;
              return sum + (r.opening !== null && r.closing !== null && gap > allow ? gap - allow : 0);
            }, 0);
            const noSales = brRows.some(r => r.status === 'NO_SALES');
            return (
              <div className={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                  <h3 style={{ margin: 0, color: 'var(--accent-primary)' }}>3. Ice Cream Stock &amp; Shortage</h3>
                  {totalShortage > 0 && (
                    <span style={{ fontWeight: 700, color: 'var(--danger)', fontSize: '1.05rem' }}>
                      Overall Shortage: {totalShortage >= 1000 ? `${(totalShortage / 1000).toFixed(2)} kg` : `${Math.round(totalShortage)} g`}
                    </span>
                  )}
                </div>
                <div style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                  {counted} of {brRows.length} bulk flavours weighed at opening and closing. Tasting &amp; thaw allowance applied (minimum 20 g base or 5% of sales, custom per flavour).
                </div>
                {noSales ? (
                  <div style={{ color: 'var(--warning)' }}>⚠ Sales By Items not uploaded for {selectedDate} — flavours can&apos;t be checked yet.</div>
                ) : counted === 0 ? null : bad.length === 0 ? (
                  <div style={{ color: 'var(--success)' }}>✓ Every weighed flavour is within its tasting allowance! (0 g shortage)</div>
                ) : (
                  <table className={styles.table}>
                    <thead><tr><th>Flavour</th><th>Used</th><th>Sold</th><th>Wasted</th><th>Gap</th><th>Allowance</th><th>Shortage</th><th>Status</th></tr></thead>
                    <tbody>
                      {bad.map(r => {
                        const allow = effectiveAllow(r);
                        const gap = r.gap ?? 0;
                        const shortage = gap > allow ? gap - allow : 0;
                        return (
                          <tr key={r.item_id} style={{ background: shortage > 0 ? 'rgba(255,23,68,0.08)' : undefined }}>
                            <td style={{ fontWeight: 600 }}>{r.flavour}</td>
                            <td>{grams(r.used)}</td><td>{grams(r.sold)}</td><td>{r.wasted ? grams(r.wasted) : '—'}</td>
                            <td style={{ fontWeight: 700, color: shortage > 0 ? 'var(--danger)' : undefined }}>{signedGrams(r.gap)}</td>
                            <td>{grams(allow)}</td>
                            <td style={{ fontWeight: 700, color: shortage > 0 ? 'var(--danger)' : 'var(--text-secondary)' }}>
                              {shortage > 0 ? `+${grams(shortage)}` : '0 g'}
                            </td>
                            <td><span className={shortage > 0 ? styles.badgeDanger : styles.badge}>{shortage > 0 ? '⚠ Over' : 'Check count'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })()}

          {/* Section 3: Stock Variance & Audit Highlights (Non-BR stores) */}
          {!brRows && (
            <div className={styles.card}>
              <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>3. Stock Short</h3>
              {stockError ? (
                <div style={{ color: 'var(--danger)' }}>Could not check stock: {stockError}</div>
              ) : varianceAlerts.length === 0 ? (
                <div style={{ color: stockNote ? 'var(--text-secondary)' : 'var(--success)' }}>
                  {stockNote || `✓ Nothing short on ${selectedDate}.`}
                </div>
              ) : (
                <>
                  {stockNote && <p style={{ color: 'var(--text-secondary)' }}>{stockNote}</p>}
                  <table className={styles.table}>
                    <thead>
                      <tr><th>Item</th><th>Expected</th><th>Counted</th><th>Difference</th><th>₹</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {varianceAlerts.map(r => {
                        const u = displayUnit(r.rista_unit, r.uom);
                        const d = (q: number) => toDisplay(Number(q), r.rista_unit, r.uom);
                        return (
                          <tr key={r.item_id} style={{ background: 'rgba(255,23,68,0.08)' }}>
                            <td style={{ fontWeight: 600 }}>{r.item_name}</td>
                            <td>{d(r.system_closing)} {u}</td>
                            <td>{d(r.actual_closing)} {u}</td>
                            <td style={{ color: 'var(--danger)', fontWeight: 700 }}>{signed(d(r.variance))} {u}</td>
                            <td style={{ fontWeight: 700 }}>{r.rate ? `₹${Math.round(Number(r.variance_amount)).toLocaleString('en-IN')}` : '—'}</td>
                            <td><span className={styles.badgeDanger}>{r.status === 'CHECK_RECEIVED' ? '⚠ Delivery not entered?' : '⚠ Short'}</span></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
