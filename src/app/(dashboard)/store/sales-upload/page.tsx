'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { parseRistaPOSFile, ParsedPOSReport } from '@/lib/services/rista-parser';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import styles from './page.module.css';

type Parsed = ParsedPOSReport & { fileName: string };

const inr = (n: number) => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function SalesUploadPage() {
  const { supabase, store } = useActiveStore();
  const [files, setFiles] = useState<Parsed[]>([]);
  const [itemsDate, setItemsDate] = useState(addDays(istDate(), -1));
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const summary = files.find(f => f.kind === 'summary');
  const items = files.find(f => f.kind === 'items');

  // ---- read files ----
  const readFiles = async (list: FileList | File[]) => {
    setMessage(null);
    const parsed: Parsed[] = [];
    for (const file of Array.from(list).slice(0, 2)) {
      try {
        const buf = await file.arrayBuffer();
        parsed.push({ ...parseRistaPOSFile(buf, file.name), fileName: file.name });
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: `Could not read "${file.name}". Is it a Rista CSV/Excel export?` });
      }
    }
    if (parsed.filter(p => p.kind === 'summary').length > 1 || parsed.filter(p => p.kind === 'items').length > 1) {
      setMessage({ type: 'error', text: 'Please select one Sales Summary and/or one Sales By Items file — not two of the same kind.' });
      return;
    }
    setFiles(parsed);
  };

  // ---- validation ----
  const problems: string[] = [];
  if (store) {
    for (const f of files) {
      problems.push(...f.warnings.map(w => `${f.fileName}: ${w}`));
      const expected = store.rista_branch_name;
      if (!expected) {
        problems.push(`The Rista branch name for ${store.name} is not set yet, so the file can't be checked. Ask the Super Admin to set it.`);
      } else if (!f.branch) {
        problems.push(`"${f.fileName}" has been renamed, so we can't tell which store it is from. Please upload the file exactly as Rista downloaded it.`);
      } else if (norm(f.branch) !== norm(expected)) {
        problems.push(`"${f.fileName}" is from "${f.branch}", but this store is ${store.name} ("${expected}"). Please download the report for this store.`);
      }
    }
    if (summary && items && Math.abs(summary.summary.net_sales - items.summary.net_sales) > 1) {
      problems.push(`The two files don't match: Sales Summary net sales ${inr(summary.summary.net_sales)}, Sales By Items ${inr(items.summary.net_sales)}. They are probably from different days — please download both for the same day.`);
    }
    if (summary?.date && summary.date > istDate()) problems.push('The Sales Summary date is in the future.');
  }
  const date = summary?.date || (items ? itemsDate : null);
  const canSave = Boolean(store && files.length && date && problems.length === 0);

  // ---- save ----
  const handleSave = async () => {
    if (!store || !date) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      const base = { store_id: store.id, entry_date: date, submitted_by_profile_id: user.id };

      // 1. Summary: write only summary columns (never touches item data)
      if (summary) {
        const s = summary.summary;
        const { error } = await supabase.from('daily_sales_summary').upsert({
          ...base,
          gross_sales: s.gross_sales, net_sales: s.net_sales, total_discount: s.total_discount,
          total_tax: s.total_tax, service_charges: s.service_charges, total_orders: s.total_orders,
          cash_amount: s.cash_amount, upi_amount: s.upi_amount, card_amount: s.card_amount,
          swiggy_amount: s.swiggy_amount, zomato_amount: s.zomato_amount, other_online_amount: s.other_online_amount,
          dine_in_amount: s.dine_in_amount, takeaway_amount: s.takeaway_amount,
          has_summary: true,
        }, { onConflict: 'store_id,entry_date' });
        if (error) throw error;
      }

      // 2. Items: attach to the day's row without overwriting its money figures
      if (items) {
        // One database step: replaces the day's items completely, or changes nothing if it fails
        const { error } = await supabase.rpc('save_sales_items', {
          p_store_id: store.id,
          p_date: date,
          p_net: items.summary.net_sales,
          p_items: items.items.map(i => ({
            sku: i.sku, item_type: i.item_type, item_name: i.item_name, variant: i.variant,
            quantity_sold: i.quantity_sold, unit_price: i.unit_price, total_price: i.total_price, category: i.category,
          })),
        });
        if (error) throw error;
      }

      const what = [summary && 'Sales Summary', items && 'Sales By Items'].filter(Boolean).join(' + ');
      setMessage({ type: 'success', text: `✅ ${what} saved for ${store.name}, ${date}.` });
      setFiles([]);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || String(err);
      setMessage({ type: 'error', text: /row-level security/i.test(msg)
        ? 'This day is closed for store changes. Ask your manager to upload it.'
        : 'Could not save: ' + msg });
    } finally {
      setSaving(false);
    }
  };

  if (!store) return <div className={styles.container}>No store is assigned to this login. Please contact your manager.</div>;

  const s = summary?.summary;

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem' }}>
        <div>
          <h1 className={styles.title}>Upload Sales Report</h1>
          <p className={styles.subtitle}>
            In Rista, download <strong>Sales Summary</strong> for the day and upload it here.
          </p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      {/* Drop zone */}
      <div
        className={`${styles.card} ${styles.dropZone} ${dragging ? styles.dragging : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
      >
        <input
          type="file"
          ref={inputRef}
          multiple
          accept=".csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={e => e.target.files && readFiles(e.target.files)}
        />
        <div style={{ fontSize: '2.5rem' }}>📄</div>
        <h3 style={{ margin: '0.5rem 0' }}>
          {files.length ? files.map(f => f.fileName).join(', ') : 'Tap to choose file, or drag it here'}
        </h3>
        <p className={styles.subtitle} style={{ margin: 0 }}>
          Sales Summary (daily). Sales By Items can be added too.
        </p>
      </div>

      {message && (
        <div className={`${styles.alert} ${message.type === 'error' ? styles.error : styles.success}`}>{message.text}</div>
      )}

      {problems.length > 0 && (
        <div className={`${styles.alert} ${styles.error}`}>
          {problems.map((p, i) => <div key={i}>⚠ {p}</div>)}
        </div>
      )}

      {files.length > 0 && (
        <div className={styles.card}>
          <div className={styles.factRow}>
            <div><span className={styles.factLabel}>Store</span><strong>{store.name}</strong></div>
            <div>
              <span className={styles.factLabel}>Sales date</span>
              {summary?.date ? (
                <strong>{summary.date}</strong>
              ) : items ? (
                <input type="date" className={styles.dateInput} value={itemsDate} max={istDate()}
                  onChange={e => setItemsDate(e.target.value)} />
              ) : <strong>—</strong>}
            </div>
            {items && <div><span className={styles.factLabel}>Items sold</span><strong>{items.items.filter(i => i.item_type !== 'Option').length} products</strong></div>}
          </div>

          {s && (
            <>
              <h3 className={styles.sectionTitle}>Money</h3>
              <div className={styles.factGrid}>
                <div><span className={styles.factLabel}>Net sales</span><strong>{inr(s.net_sales)}</strong></div>
                <div><span className={styles.factLabel}>Orders</span><strong>{s.total_orders}</strong></div>
                <div><span className={styles.factLabel}>Discounts</span><strong>{inr(s.total_discount)}</strong></div>
                <div><span className={styles.factLabel}>Cash</span><strong>{inr(s.cash_amount)}</strong></div>
                <div><span className={styles.factLabel}>UPI</span><strong>{inr(s.upi_amount)}</strong></div>
                <div><span className={styles.factLabel}>Card</span><strong>{inr(s.card_amount)}</strong></div>
                <div><span className={styles.factLabel}>Swiggy</span><strong>{inr(s.swiggy_amount)}</strong></div>
                <div><span className={styles.factLabel}>Zomato</span><strong>{inr(s.zomato_amount)}</strong></div>
                {s.other_online_amount > 0 && <div><span className={styles.factLabel}>Other</span><strong>{inr(s.other_online_amount)}</strong></div>}
              </div>
            </>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
            <button className={styles.saveButton} onClick={handleSave} disabled={!canSave || saving}>
              {saving ? 'Saving…' : '✓ Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
