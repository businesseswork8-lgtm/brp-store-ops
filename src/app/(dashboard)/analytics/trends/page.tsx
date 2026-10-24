'use client';

import { businessDate, addDays, shortDate, displayDate } from '@/lib/dates';
import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import styles from '../analytics.module.css';

type Store = { id: string; name: string; code: string };

type DayRevenue = {
  date: string;
  net_sales: number;
  gross_sales: number;
  total_discount: number;
  total_orders: number;
  swiggy: number;
  zomato: number;
  cash: number;
  has_data: boolean;
};

type StoreAggregate = {
  id: string;
  name: string;
  code: string;
  net_sales: number;
  gross_sales: number;
  total_orders: number;
};

type HorizonType = '7' | '14' | '30' | 'this_month' | 'custom';

export default function HistoricalTrendsPage() {
  const supabase = createClient();
  const activeBusinessDate = businessDate();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [horizonType, setHorizonType] = useState<HorizonType>('7');
  const [customStartDate, setCustomStartDate] = useState<string>(addDays(activeBusinessDate, -6));
  const [customEndDate, setCustomEndDate] = useState<string>(activeBusinessDate);

  const [trendData, setTrendData] = useState<DayRevenue[]>([]);
  const [storeAggregates, setStoreAggregates] = useState<StoreAggregate[]>([]);
  const [hoveredDay, setHoveredDay] = useState<DayRevenue | null>(null);
  const [loading, setLoading] = useState(true);

  // Compute effective start and end dates
  const { startDateStr, endDateStr, horizonLabel } = useMemo(() => {
    if (horizonType === '7') {
      return {
        startDateStr: addDays(activeBusinessDate, -6),
        endDateStr: activeBusinessDate,
        horizonLabel: 'Last 7 Days',
      };
    }
    if (horizonType === '14') {
      return {
        startDateStr: addDays(activeBusinessDate, -13),
        endDateStr: activeBusinessDate,
        horizonLabel: 'Last 14 Days',
      };
    }
    if (horizonType === '30') {
      return {
        startDateStr: addDays(activeBusinessDate, -29),
        endDateStr: activeBusinessDate,
        horizonLabel: 'Last 30 Days',
      };
    }
    if (horizonType === 'this_month') {
      const monthStart = `${activeBusinessDate.slice(0, 7)}-01`;
      return {
        startDateStr: monthStart,
        endDateStr: activeBusinessDate,
        horizonLabel: 'This Month',
      };
    }
    // Custom range
    const start = customStartDate || addDays(activeBusinessDate, -6);
    const end = customEndDate || activeBusinessDate;
    const finalStart = start <= end ? start : end;
    const finalEnd = start <= end ? end : start;
    return {
      startDateStr: finalStart,
      endDateStr: finalEnd,
      horizonLabel: `${shortDate(finalStart)} - ${shortDate(finalEnd)}`,
    };
  }, [horizonType, customStartDate, customEndDate, activeBusinessDate]);

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    fetchTrends();
  }, [selectedStoreId, startDateStr, endDateStr]);

  async function fetchStores() {
    const { data } = await supabase.from('stores').select('id, name, code').eq('is_active', true).order('name');
    if (data) setStores(data);
  }

  async function fetchTrends() {
    setLoading(true);

    // Build continuous date list for time horizon
    const dateRangeList: string[] = [];
    let curr = startDateStr;
    let guard = 0;
    while (curr <= endDateStr && guard < 366) {
      dateRangeList.push(curr);
      curr = addDays(curr, 1);
      guard++;
    }

    let query = supabase
      .from('daily_sales_summary')
      .select('*, stores:store_id (id, name, code)')
      .gte('entry_date', startDateStr)
      .lte('entry_date', endDateStr)
      .order('entry_date', { ascending: true });

    if (selectedStoreId !== 'all') {
      query = query.eq('store_id', selectedStoreId);
    }

    const { data, error } = await query;

    // Initialize daily map with 0s for all dates in horizon
    const dayMap = new Map<string, DayRevenue>();
    dateRangeList.forEach(d => {
      dayMap.set(d, {
        date: d,
        net_sales: 0,
        gross_sales: 0,
        total_discount: 0,
        total_orders: 0,
        swiggy: 0,
        zomato: 0,
        cash: 0,
        has_data: false,
      });
    });

    const storeMap = new Map<string, StoreAggregate>();

    if (!error && data) {
      data.filter(row => row.has_summary !== false).forEach(row => {
        const d = row.entry_date;
        if (dayMap.has(d)) {
          const item = dayMap.get(d)!;
          item.net_sales += Number(row.net_sales || 0);
          item.gross_sales += Number(row.gross_sales || 0);
          item.total_discount += Number(row.total_discount || 0);
          item.total_orders += Number(row.total_orders || 0);
          item.swiggy += Number(row.swiggy_amount || 0);
          item.zomato += Number(row.zomato_amount || 0);
          item.cash += Number(row.cash_amount || 0);
          item.has_data = true;
        }

        // Store breakdown
        const storeInfo = (row as any).stores;
        const sId = row.store_id;
        if (sId) {
          if (!storeMap.has(sId)) {
            storeMap.set(sId, {
              id: sId,
              name: storeInfo?.name || 'Unknown Store',
              code: storeInfo?.code || '',
              net_sales: 0,
              gross_sales: 0,
              total_orders: 0,
            });
          }
          const sAgg = storeMap.get(sId)!;
          sAgg.net_sales += Number(row.net_sales || 0);
          sAgg.gross_sales += Number(row.gross_sales || 0);
          sAgg.total_orders += Number(row.total_orders || 0);
        }
      });
    }

    setTrendData(dateRangeList.map(d => dayMap.get(d)!));
    setStoreAggregates(Array.from(storeMap.values()).sort((a, b) => b.net_sales - a.net_sales));
    setLoading(false);
  }

  const formatCurrency = (val: number) => `₹ ${Math.round(val).toLocaleString('en-IN')}`;

  // KPI calculations
  const totals = useMemo(() => {
    return trendData.reduce(
      (acc, d) => {
        acc.net_sales += d.net_sales;
        acc.gross_sales += d.gross_sales;
        acc.total_discount += d.total_discount;
        acc.total_orders += d.total_orders;
        acc.swiggy += d.swiggy;
        acc.zomato += d.zomato;
        acc.cash += d.cash;
        if (d.has_data) acc.active_days += 1;
        return acc;
      },
      {
        net_sales: 0,
        gross_sales: 0,
        total_discount: 0,
        total_orders: 0,
        swiggy: 0,
        zomato: 0,
        cash: 0,
        active_days: 0,
      }
    );
  }, [trendData]);

  const maxNet = useMemo(() => {
    return Math.max(...trendData.map(t => t.net_sales), 1);
  }, [trendData]);

  const bestDay = useMemo(() => {
    if (trendData.length === 0) return null;
    return [...trendData].sort((a, b) => b.net_sales - a.net_sales)[0];
  }, [trendData]);

  const avgDailyNet = totals.active_days > 0 ? totals.net_sales / totals.active_days : 0;
  const avgOrderValue = totals.total_orders > 0 ? totals.net_sales / totals.total_orders : 0;

  // Channel shares
  const channelTotal = totals.swiggy + totals.zomato + totals.cash || 1;
  const swiggyPct = Math.round((totals.swiggy / channelTotal) * 100);
  const zomatoPct = Math.round((totals.zomato / channelTotal) * 100);
  const cashPct = Math.max(0, 100 - swiggyPct - zomatoPct);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Multi-Day Revenue & Historical Performance Trends</h1>
          <p className={styles.subtitle}>
            Analyze multi-day sales trajectories, channel distribution trends, and order volumes with custom date range
          </p>
        </div>
        <Link href="/analytics/sales" className={styles.primaryButton}>
          📊 Daily Sales Analytics
        </Link>
      </div>

      {/* Control / Filter Bar with Custom Date Range Selector */}
      <div className={styles.filterBar} style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ minWidth: '220px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary, #a0a0b0)', marginBottom: '0.35rem', fontWeight: 500 }}>
            Store Filter
          </label>
          <select
            value={selectedStoreId}
            onChange={e => setSelectedStoreId(e.target.value)}
            className={styles.selectFilter}
            style={{ width: '100%' }}
          >
            <option value="all">All Stores</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary, #a0a0b0)', marginBottom: '0.35rem', fontWeight: 500 }}>
            Time Horizon
          </label>
          <select
            value={horizonType}
            onChange={e => setHorizonType(e.target.value as HorizonType)}
            className={styles.selectFilter}
            style={{ width: '100%' }}
          >
            <option value="7">Last 7 Days</option>
            <option value="14">Last 14 Days</option>
            <option value="30">Last 30 Days</option>
            <option value="this_month">This Month</option>
            <option value="custom">📅 Custom Date Range</option>
          </select>
        </div>

        {/* Custom Date Pickers */}
        {horizonType === 'custom' && (
          <>
            <div style={{ minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary, #a0a0b0)', marginBottom: '0.35rem', fontWeight: 500 }}>
                Start Date
              </label>
              <input
                type="date"
                value={customStartDate}
                max={customEndDate || activeBusinessDate}
                onChange={e => setCustomStartDate(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '0.62rem 0.75rem', colorScheme: 'dark' }}
              />
            </div>

            <div style={{ minWidth: '160px' }}>
              <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary, #a0a0b0)', marginBottom: '0.35rem', fontWeight: 500 }}>
                End Date
              </label>
              <input
                type="date"
                value={customEndDate}
                min={customStartDate}
                max={activeBusinessDate}
                onChange={e => setCustomEndDate(e.target.value)}
                className={styles.searchInput}
                style={{ width: '100%', padding: '0.62rem 0.75rem', colorScheme: 'dark' }}
              />
            </div>
          </>
        )}
      </div>

      {/* KPI Summary Cards */}
      <div className={styles.statsGrid}>
        <div className={styles.statCard} style={{ borderLeft: '4px solid var(--accent-primary, #ff6b35)' }}>
          <div className={styles.statTitle}>Total Net Revenue ({horizonLabel})</div>
          <div className={styles.statValue} style={{ color: 'var(--accent-primary, #ff6b35)' }}>
            {formatCurrency(totals.net_sales)}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #a0a0b0)' }}>
            Gross: {formatCurrency(totals.gross_sales)}
          </div>
        </div>

        <div className={styles.statCard} style={{ borderLeft: '4px solid var(--success, #00c853)' }}>
          <div className={styles.statTitle}>Daily Average Revenue</div>
          <div className={styles.statValue} style={{ color: 'var(--success, #00c853)' }}>
            {formatCurrency(avgDailyNet)}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #a0a0b0)' }}>
            Active Days: {totals.active_days} of {trendData.length}
          </div>
        </div>

        <div className={styles.statCard} style={{ borderLeft: '4px solid #2979ff' }}>
          <div className={styles.statTitle}>Total Orders & AOV</div>
          <div className={styles.statValue} style={{ color: '#2979ff' }}>
            {totals.total_orders.toLocaleString()}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #a0a0b0)' }}>
            Avg Ticket: {formatCurrency(avgOrderValue)}
          </div>
        </div>

        <div className={styles.statCard} style={{ borderLeft: '4px solid var(--accent-secondary, #e91e8c)' }}>
          <div className={styles.statTitle}>Peak Revenue Day</div>
          <div className={styles.statValue} style={{ color: 'var(--accent-secondary, #e91e8c)', fontSize: '1.4rem' }}>
            {bestDay && bestDay.net_sales > 0 ? formatCurrency(bestDay.net_sales) : '₹ 0'}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #a0a0b0)' }}>
            {bestDay && bestDay.net_sales > 0 ? shortDate(bestDay.date) : 'No data recorded'}
          </div>
        </div>
      </div>

      {/* Visual Revenue Trend Chart (Bar Graph) */}
      <div className={styles.card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Daily Net Revenue Trend ({horizonLabel})</h3>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #a0a0b0)' }}>
              Hover over any bar to view the detailed financial breakdown for that day
            </span>
          </div>
          {hoveredDay && (
            <div style={{ display: 'flex', gap: '1rem', background: 'rgba(255, 255, 255, 0.05)', padding: '0.4rem 0.85rem', borderRadius: '8px', fontSize: '0.82rem', alignItems: 'center' }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary, #fff)' }}>{shortDate(hoveredDay.date)}:</span>
              <span style={{ color: 'var(--accent-primary, #ff6b35)', fontWeight: 700 }}>{formatCurrency(hoveredDay.net_sales)}</span>
              <span style={{ color: 'var(--text-secondary, #a0a0b0)' }}>| {hoveredDay.total_orders} orders</span>
            </div>
          )}
        </div>

        {loading ? (
          <p style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #a0a0b0)' }}>Loading trend graph...</p>
        ) : trendData.length === 0 ? (
          <p style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary, #a0a0b0)' }}>
            No sales summary data found for the selected time horizon.
          </p>
        ) : (
          <div style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                gap: trendData.length > 20 ? '0.35rem' : trendData.length > 10 ? '0.65rem' : '1rem',
                height: '240px',
                paddingTop: '2.5rem',
                paddingBottom: '0.5rem',
                borderBottom: '1px solid var(--border-color, rgba(255, 255, 255, 0.1))',
                minWidth: `${Math.max(trendData.length * 32, 500)}px`,
                position: 'relative',
              }}
            >
              {trendData.map(day => {
                const heightPct = Math.round((day.net_sales / maxNet) * 100);
                const isBest = bestDay && day.date === bestDay.date && day.net_sales > 0;
                const isHovered = hoveredDay?.date === day.date;

                return (
                  <div
                    key={day.date}
                    onMouseEnter={() => setHoveredDay(day)}
                    onMouseLeave={() => setHoveredDay(null)}
                    style={{
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      height: '100%',
                      justifyContent: 'flex-end',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {/* Revenue Value Badge */}
                    <div
                      style={{
                        fontSize: trendData.length > 20 ? '0.6rem' : '0.72rem',
                        color: isBest ? 'var(--accent-secondary, #e91e8c)' : 'var(--text-primary, #ffffff)',
                        fontWeight: 700,
                        marginBottom: '0.35rem',
                        whiteSpace: 'nowrap',
                        opacity: day.net_sales > 0 ? (isHovered || isBest || trendData.length <= 14 ? 1 : 0.7) : 0,
                      }}
                    >
                      {day.net_sales > 0 ? `₹${Math.round(day.net_sales / 1000)}k` : ''}
                    </div>

                    {/* Bar Container Slot */}
                    <div
                      style={{
                        width: '100%',
                        maxWidth: trendData.length > 20 ? '22px' : trendData.length > 10 ? '34px' : '46px',
                        height: '100%',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'flex-end',
                        background: 'rgba(255, 255, 255, 0.03)',
                        borderRadius: '6px 6px 0 0',
                        padding: '0 2px',
                      }}
                    >
                      {/* The Gradient Bar */}
                      <div
                        style={{
                          width: '100%',
                          height: day.net_sales > 0 ? `${Math.max(heightPct, 6)}%` : '2px',
                          background: day.net_sales > 0
                            ? isBest
                              ? 'linear-gradient(180deg, #ff4da6 0%, #ff6b35 100%)'
                              : 'linear-gradient(180deg, #ff6b35 0%, #e91e8c 100%)'
                            : 'rgba(255, 255, 255, 0.1)',
                          borderRadius: '4px 4px 0 0',
                          boxShadow: day.net_sales > 0
                            ? isHovered
                              ? '0 0 16px rgba(255, 107, 53, 0.65)'
                              : '0 2px 8px rgba(255, 107, 53, 0.3)'
                            : 'none',
                          transition: 'all 0.2s ease',
                          transform: isHovered ? 'scaleY(1.02)' : 'none',
                          transformOrigin: 'bottom',
                        }}
                      />
                    </div>

                    {/* Date Label */}
                    <div
                      style={{
                        fontSize: trendData.length > 20 ? '0.62rem' : '0.72rem',
                        color: isHovered ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #a0a0b0)',
                        fontWeight: isHovered ? 600 : 400,
                        marginTop: '0.5rem',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {trendData.length > 20 ? day.date.slice(8) : day.date.slice(5)}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Channel Distribution Breakdown */}
      <div className={styles.card}>
        <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem' }}>Channel Distribution ({horizonLabel})</h3>
        <p style={{ margin: '0 0 1.25rem 0', fontSize: '0.85rem', color: 'var(--text-secondary, #a0a0b0)' }}>
          Proportional revenue split across food aggregators and in-store cash sales
        </p>

        {/* Visual Channel Share Bar */}
        <div style={{ height: '14px', borderRadius: '7px', display: 'flex', overflow: 'hidden', marginBottom: '1.25rem', background: 'rgba(255, 255, 255, 0.05)' }}>
          <div style={{ width: `${swiggyPct}%`, background: '#fc8019', transition: 'width 0.4s' }} title={`Swiggy: ${swiggyPct}%`} />
          <div style={{ width: `${zomatoPct}%`, background: '#cb202d', transition: 'width 0.4s' }} title={`Zomato: ${zomatoPct}%`} />
          <div style={{ width: `${cashPct}%`, background: '#00c853', transition: 'width 0.4s' }} title={`Walk-in Cash: ${cashPct}%`} />
        </div>

        {/* Channel Details Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
          <div style={{ background: 'rgba(252, 128, 25, 0.08)', border: '1px solid rgba(252, 128, 25, 0.25)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontWeight: 600, color: '#fc8019' }}>Swiggy</span>
              <span style={{ fontSize: '0.8rem', background: 'rgba(252, 128, 25, 0.2)', padding: '0.15rem 0.5rem', borderRadius: '99px', color: '#fc8019', fontWeight: 700 }}>
                {swiggyPct}%
              </span>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
              {formatCurrency(totals.swiggy)}
            </div>
          </div>

          <div style={{ background: 'rgba(203, 32, 45, 0.08)', border: '1px solid rgba(203, 32, 45, 0.25)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontWeight: 600, color: '#cb202d' }}>Zomato</span>
              <span style={{ fontSize: '0.8rem', background: 'rgba(203, 32, 45, 0.2)', padding: '0.15rem 0.5rem', borderRadius: '99px', color: '#cb202d', fontWeight: 700 }}>
                {zomatoPct}%
              </span>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
              {formatCurrency(totals.zomato)}
            </div>
          </div>

          <div style={{ background: 'rgba(0, 200, 83, 0.08)', border: '1px solid rgba(0, 200, 83, 0.25)', borderRadius: '10px', padding: '1rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <span style={{ fontWeight: 600, color: '#00c853' }}>Walk-in / Cash</span>
              <span style={{ fontSize: '0.8rem', background: 'rgba(0, 200, 83, 0.2)', padding: '0.15rem 0.5rem', borderRadius: '99px', color: '#00c853', fontWeight: 700 }}>
                {cashPct}%
              </span>
            </div>
            <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
              {formatCurrency(totals.cash)}
            </div>
          </div>
        </div>
      </div>

      {/* Multi-Store Comparison (When "All Stores" selected and multiple stores exist) */}
      {selectedStoreId === 'all' && storeAggregates.length > 1 && (
        <div className={styles.card}>
          <h3 style={{ margin: '0 0 1rem 0', fontSize: '1.15rem' }}>Store Contribution Breakdown</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '1rem' }}>
            {storeAggregates.map(store => {
              const sharePct = totals.net_sales > 0 ? Math.round((store.net_sales / totals.net_sales) * 100) : 0;
              return (
                <div key={store.id} style={{ background: 'var(--bg-secondary, #12121a)', border: '1px solid var(--border-color, rgba(255, 255, 255, 0.08))', borderRadius: '10px', padding: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                    <div>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary, #fff)' }}>{store.name}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary, #a0a0b0)' }}>Code: {store.code}</div>
                    </div>
                    <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--accent-primary, #ff6b35)' }}>{sharePct}%</span>
                  </div>
                  <div style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--success, #00c853)', marginBottom: '0.25rem' }}>
                    {formatCurrency(store.net_sales)}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary, #a0a0b0)' }}>
                    {store.total_orders} orders | Gross: {formatCurrency(store.gross_sales)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Detailed Multi-Day Data Table */}
      {trendData.length > 0 && (
        <div className={styles.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Daily Revenue Breakdown Table</h3>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary, #a0a0b0)' }}>
                Click any date to open the full itemized sales audit for that day
              </span>
            </div>
          </div>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Net Revenue</th>
                <th>Gross Revenue</th>
                <th>Discounts</th>
                <th>Swiggy</th>
                <th>Zomato</th>
                <th>Walk-In Cash</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {trendData.map(row => {
                const isBest = bestDay && row.date === bestDay.date && row.net_sales > 0;
                return (
                  <tr key={row.date} style={{ background: isBest ? 'rgba(255, 107, 53, 0.05)' : undefined }}>
                    <td style={{ fontWeight: 600 }}>
                      <Link
                        href={`/analytics/sales?date=${row.date}`}
                        style={{ color: 'inherit', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
                        title="Click to view daily sales analytics"
                      >
                        <span style={{ color: 'var(--accent-primary, #ff6b35)' }}>📅</span>
                        <span>{displayDate(row.date)}</span>
                        {isBest && (
                          <span style={{ fontSize: '0.65rem', background: 'var(--accent-secondary, #e91e8c)', color: '#fff', padding: '0.1rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>
                            PEAK
                          </span>
                        )}
                      </Link>
                    </td>
                    <td style={{ fontWeight: 700, color: row.net_sales > 0 ? 'var(--success, #00c853)' : 'var(--text-secondary, #a0a0b0)' }}>
                      {formatCurrency(row.net_sales)}
                    </td>
                    <td>{formatCurrency(row.gross_sales)}</td>
                    <td style={{ color: 'var(--warning, #ffd600)' }}>{formatCurrency(row.total_discount)}</td>
                    <td style={{ color: '#fc8019' }}>{formatCurrency(row.swiggy)}</td>
                    <td style={{ color: '#cb202d' }}>{formatCurrency(row.zomato)}</td>
                    <td>{formatCurrency(row.cash)}</td>
                    <td>{row.total_orders}</td>
                  </tr>
                );
              })}

              {/* Prominent TOTAL Row inside tbody */}
              <tr
                style={{
                  borderTop: '2px solid var(--accent-primary, #ff6b35)',
                  borderBottom: '2px solid var(--accent-primary, #ff6b35)',
                  background: 'rgba(255, 107, 53, 0.12)',
                  fontWeight: 700,
                  fontSize: '0.95rem',
                }}
              >
                <td style={{ fontWeight: 800, color: 'var(--text-primary, #fff)', letterSpacing: '0.5px' }}>
                  TOTAL ({trendData.length} Days)
                </td>
                <td style={{ fontWeight: 800, color: 'var(--success, #00c853)', fontSize: '1.05rem' }}>
                  {formatCurrency(totals.net_sales)}
                </td>
                <td style={{ fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
                  {formatCurrency(totals.gross_sales)}
                </td>
                <td style={{ fontWeight: 700, color: 'var(--warning, #ffd600)' }}>
                  {formatCurrency(totals.total_discount)}
                </td>
                <td style={{ fontWeight: 700, color: '#fc8019' }}>
                  {formatCurrency(totals.swiggy)}
                </td>
                <td style={{ fontWeight: 700, color: '#cb202d' }}>
                  {formatCurrency(totals.zomato)}
                </td>
                <td style={{ fontWeight: 700, color: 'var(--text-primary, #fff)' }}>
                  {formatCurrency(totals.cash)}
                </td>
                <td style={{ fontWeight: 800, color: 'var(--text-primary, #fff)' }}>
                  {totals.total_orders.toLocaleString()}
                </td>
              </tr>

              {/* DAILY AVERAGE Row */}
              <tr style={{ background: 'rgba(255, 255, 255, 0.02)', fontWeight: 600, fontSize: '0.85rem' }}>
                <td style={{ color: 'var(--text-secondary, #a0a0b0)' }}>
                  Daily Average ({totals.active_days} active days)
                </td>
                <td style={{ color: 'var(--success, #00c853)' }}>
                  {formatCurrency(avgDailyNet)}
                </td>
                <td style={{ color: 'var(--text-secondary, #a0a0b0)' }}>
                  {formatCurrency(totals.active_days > 0 ? totals.gross_sales / totals.active_days : 0)}
                </td>
                <td style={{ color: 'var(--warning, #ffd600)' }}>
                  {formatCurrency(totals.active_days > 0 ? totals.total_discount / totals.active_days : 0)}
                </td>
                <td style={{ color: '#fc8019' }}>
                  {formatCurrency(totals.active_days > 0 ? totals.swiggy / totals.active_days : 0)}
                </td>
                <td style={{ color: '#cb202d' }}>
                  {formatCurrency(totals.active_days > 0 ? totals.zomato / totals.active_days : 0)}
                </td>
                <td style={{ color: 'var(--text-secondary, #a0a0b0)' }}>
                  {formatCurrency(totals.active_days > 0 ? totals.cash / totals.active_days : 0)}
                </td>
                <td style={{ color: 'var(--text-secondary, #a0a0b0)' }}>
                  {totals.active_days > 0 ? Math.round(totals.total_orders / totals.active_days) : 0}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
