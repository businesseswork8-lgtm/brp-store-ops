'use client';

import { istDate } from '@/lib/dates';
import React, { useState, useEffect } from 'react';
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
};

export default function HistoricalTrendsPage() {
  const supabase = createClient();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('all');
  const [daysRange, setDaysRange] = useState<number>(7);
  const [trendData, setTrendData] = useState<DayRevenue[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStores();
  }, []);

  useEffect(() => {
    fetchTrends();
  }, [selectedStoreId, daysRange]);

  async function fetchStores() {
    const { data } = await supabase.from('stores').select('id, name, code').order('name');
    if (data) setStores(data);
  }

  async function fetchTrends() {
    setLoading(true);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - daysRange + 1);

    const startStr = istDate(startDate);
    const endStr = istDate(endDate);

    let query = supabase
      .from('daily_sales_summary')
      .select('*')
      .gte('entry_date', startStr)
      .lte('entry_date', endStr)
      .order('entry_date', { ascending: true });

    if (selectedStoreId !== 'all') {
      query = query.eq('store_id', selectedStoreId);
    }

    const { data, error } = await query;

    if (!error && data) {
      // Group by date
      const map = new Map<string, DayRevenue>();

      data.filter(row => row.has_summary !== false).forEach(row => {
        const d = row.entry_date;
        if (!map.has(d)) {
          map.set(d, {
            date: d,
            net_sales: 0,
            gross_sales: 0,
            total_discount: 0,
            total_orders: 0,
            swiggy: 0,
            zomato: 0,
            cash: 0,
          });
        }
        const item = map.get(d)!;
        item.net_sales += Number(row.net_sales || 0);
        item.gross_sales += Number(row.gross_sales || 0);
        item.total_discount += Number(row.total_discount || 0);
        item.total_orders += Number(row.total_orders || 0);
        item.swiggy += Number(row.swiggy_amount || 0);
        item.zomato += Number(row.zomato_amount || 0);
        item.cash += Number(row.cash_amount || 0);
      });

      setTrendData(Array.from(map.values()));
    } else {
      setTrendData([]);
    }

    setLoading(false);
  }

  const formatCurrency = (val: number) => `₹ ${Math.round(val).toLocaleString('en-IN')}`;

  const maxNet = Math.max(...trendData.map(t => t.net_sales), 1);

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Multi-Day Revenue & Historical Performance Trends</h1>
          <p className={styles.subtitle}>
            Analyze 7-day, 14-day, and 30-day sales trajectories, channel distribution trends, and order volumes
          </p>
        </div>
        <Link href="/analytics/sales" className={styles.primaryButton}>
          📊 Daily Sales Analytics
        </Link>
      </div>

      {/* Control Bar */}
      <div className={styles.filterBar} style={{ marginBottom: '1.5rem', display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            Store Filter
          </label>
          <select
            value={selectedStoreId}
            onChange={e => setSelectedStoreId(e.target.value)}
            className={styles.selectFilter}
          >
            <option value="all">All Stores</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: '200px' }}>
          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>
            Time Horizon
          </label>
          <select
            value={daysRange}
            onChange={e => setDaysRange(Number(e.target.value))}
            className={styles.selectFilter}
          >
            <option value={7}>Last 7 Days</option>
            <option value={14}>Last 14 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
        </div>
      </div>

      {/* Visual Revenue Trend Chart (Bar Graph) */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <h3 style={{ margin: '0 0 1rem 0' }}>Daily Net Revenue Trend ({daysRange} Days)</h3>

        {loading ? (
          <p style={{ padding: '2rem', textAlign: 'center' }}>Loading trend graph...</p>
        ) : trendData.length === 0 ? (
          <p style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
            No sales summary data found for the selected time horizon.
          </p>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', height: '220px', paddingTop: '2rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)' }}>
            {trendData.map(day => {
              const heightPct = Math.round((day.net_sales / maxNet) * 100);
              return (
                <div key={day.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', height: '100%', justifyContent: 'flex-end' }}>
                  <div style={{ fontSize: '0.7rem', color: 'var(--success)', fontWeight: 600, marginBottom: '0.25rem' }}>
                    {day.net_sales > 0 ? `₹${Math.round(day.net_sales / 1000)}k` : ''}
                  </div>
                  <div
                    style={{
                      width: '100%',
                      maxWidth: '36px',
                      height: `${Math.max(heightPct, 4)}%`,
                      background: 'linear-gradient(180deg, var(--accent-primary) 0%, var(--accent-secondary) 100%)',
                      borderRadius: '6px 6px 0 0',
                    }}
                  ></div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: '0.5rem', whiteSpace: 'nowrap' }}>
                    {day.date.slice(5)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Detailed Multi-Day Data Table */}
      {trendData.length > 0 && (
        <div className={styles.card}>
          <h3>Daily Revenue Breakdown Table</h3>
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
              {trendData.map(row => (
                <tr key={row.date}>
                  <td style={{ fontWeight: 600 }}>{row.date}</td>
                  <td style={{ fontWeight: 700, color: 'var(--success)' }}>{formatCurrency(row.net_sales)}</td>
                  <td>{formatCurrency(row.gross_sales)}</td>
                  <td style={{ color: 'var(--warning)' }}>{formatCurrency(row.total_discount)}</td>
                  <td style={{ color: '#fc8019' }}>{formatCurrency(row.swiggy)}</td>
                  <td style={{ color: '#cb202d' }}>{formatCurrency(row.zomato)}</td>
                  <td>{formatCurrency(row.cash)}</td>
                  <td>{row.total_orders}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
