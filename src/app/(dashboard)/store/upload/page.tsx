'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { parseRistaPOSFile, ParsedPOSReport } from '@/lib/services/rista-parser';
import { parseConsumption, ParsedConsumption } from '@/lib/stock/rista-consumption';
import { isMonthEndAudit, parseMonthEndAudit, AuditLine } from '@/lib/stock/audit-files';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import styles from './page.module.css';

type Parsed = ParsedPOSReport & { fileName: string };
type Usage = ParsedConsumption & { fileName: string };
type MonthEnd = { lines: AuditLine[]; warnings: string[]; fileName: string };

/** Rista "Consumption Variance" = what sales used, per material. */
const isUsageFile = (name: string, text: string) =>
  /consumption\s*variance/i.test(name.replace(/_/g, ' ')) || /ideal qty/i.test(text.slice(0, 400));

const inr = (n: number) => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

export default function UploadPage() {
  const { supabase, store } = useActiveStore();
  const [files, setFiles] = useState<Parsed[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [audit, setAudit] = useState<MonthEnd | null>(null);
  const [usageFrom, setUsageFrom] = useState(addDays(istDate(), -1));
  const [auditDate, setAuditDate] = useState(istDate());
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
    let use: Usage | null = null;
    let aud: MonthEnd | null = null;
    for (const file of Array.from(list).slice(0, 3)) {
      try {
        const buf = await file.arrayBuffer();
        const head = new TextDecoder().decode(buf.slice(0, 400));
        if (isMonthEndAudit(head)) {
          aud = { ...parseMonthEndAudit(buf), fileName: file.name };
        } else if (isUsageFile(file.name, head)) {
          if (use) { setMessage({ type: 'error', text: 'Please choose only one Consumption Variance file.' }); return; }
          use = { ...parseConsumption(buf, file.name), fileName: file.name };
        } else {
          parsed.push({ ...parseRistaPOSFile(buf, file.name), fileName: file.name });
        }
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: `Could not read "${file.name}". Is it a Rista CSV/Excel export?` });
        return;
      }
    }
    if (parsed.filter(p => p.kind === 'summary').length > 1 || parsed.filter(p => p.kind === 'items').length > 1) {
      setMessage({ type: 'error', text: 'Please choose one file of each kind (Sales Summary, Sales By Items, Consumption Variance).' });
      return;
    }
    setFiles(parsed);
    setUsage(use);
    setAudit(aud);
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
    if (usage) {
      problems.push(...usage.warnings.map(w => `${usage.fileName}: ${w}`));
      if (store.rista_branch_name && usage.branch && norm(usage.branch) !== norm(store.rista_branch_name)) {
        problems.push(`"${usage.fileName}" is from "${usage.branch}", but this store is ${store.name}.`);
      } else if (store.rista_branch_name && !usage.branch) {
        problems.push(`"${usage.fileName}" has been renamed. Please upload it exactly as Rista downloaded it.`);
      }
    }
  }
  // The Consumption Variance file has no date in it: it uses the Sales Summary date, or the date picked
  if (audit) problems.push(...audit.warnings.map(w => `${audit.fileName}: ${w}`));
  if (usage && !summary && usageFrom > itemsDate) problems.push('Rista usage: "From" date is after the "To" date.');
  const date = summary?.date || (items || usage ? itemsDate : null);
  const canSave = Boolean(store && (files.length || usage || audit) && (date || audit) && problems.length === 0);

  // ---- save ----
  const handleSave = async () => {
    if (!store || (!date && !audit)) return;
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

      // 3. Rista usage for the same day
      if (usage) {
        const lines = usage.lines.map(l => ({ sku: l.sku, name: l.name, category: l.category, unit: l.unit, ideal_qty: l.ideal_qty, rate: l.rate }));
        const call = (replace: boolean) => supabase.rpc('save_rista_consumption', {
          p_store_id: store.id, p_from: summary ? date : usageFrom, p_to: date, p_file: usage.fileName, p_lines: lines, p_replace: replace,
        });
        let { error } = await call(false);
        if (error && /OVERLAP/.test(error.message)) {
          if (!confirm(`Rista usage for ${date} is already uploaded. Replace it with this file?`)) throw new Error('Not saved — usage for this day was already uploaded.');
          ({ error } = await call(true));
        }
        if (error) throw error;
      }

      // 4. Month-end audit = full stock count on the audit date
      let auditNote = '';
      if (audit) {
        const { data, error } = await supabase.rpc('save_full_count', {
          p_store_id: store.id, p_date: auditDate,
          p_lines: audit.lines.map(l => ({ sku: l.sku, qty: l.qty, unit: l.unit })),
        });
        if (error) throw error;
        const r = data as { saved: number; in_file: number };
        auditNote = ` Month-end count saved for ${r.saved} tracked items (${r.in_file - r.saved} in the file aren't tracked in the app).`;
      }

      const what = [summary && 'Sales Summary', items && 'Sales By Items', usage && 'Rista usage', audit && 'Month-end audit'].filter(Boolean).join(' + ');
      setMessage({ type: 'success', text: `✅ ${what} saved for ${store.name}${date ? `, ${date}` : ''}.${auditNote}` });
      setFiles([]);
      setUsage(null);
      setAudit(null);
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
          <h1 className={styles.title}>Upload Rista Files</h1>
          <p className={styles.subtitle}>
            Every morning, download these two for <strong>yesterday</strong> from Rista and drop both in here together:
            <br />1. <strong>Sales Summary</strong> &nbsp; 2. <strong>Consumption Variance</strong> (same day)
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
          {files.length || usage || audit ? [...files.map(f => f.fileName), usage?.fileName, audit?.fileName].filter(Boolean).join(', ') : 'Tap to choose files, or drag them here'}
        </h3>
        <p className={styles.subtitle} style={{ margin: 0 }}>
          You can pick both files at once. Month-end: the Rista audit file goes here too.
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

      {(files.length > 0 || usage || audit) && (
        <div className={styles.card}>
          <div className={styles.factRow}>
            <div><span className={styles.factLabel}>Store</span><strong>{store.name}</strong></div>
            {(summary || items || usage) && <div>
              <span className={styles.factLabel}>{summary || items ? 'Sales date' : 'Rista usage dates'}</span>
              {summary?.date ? (
                <strong>{summary.date}</strong>
              ) : usage && !items ? (
                <span>
                  <input type="date" className={styles.dateInput} value={usageFrom} max={itemsDate}
                    onChange={e => setUsageFrom(e.target.value)} aria-label="Usage from" />
                  {' to '}
                  <input type="date" className={styles.dateInput} value={itemsDate} max={istDate()}
                    onChange={e => setItemsDate(e.target.value)} aria-label="Usage to" />
                  <span className={styles.subtitle} style={{ display: 'block', margin: 0 }}>Same dates you chose in Rista</span>
                </span>
              ) : items || usage ? (
                <input type="date" className={styles.dateInput} value={itemsDate} max={istDate()}
                  onChange={e => setItemsDate(e.target.value)} />
              ) : <strong>—</strong>}
            </div>}
            {audit && (
              <div>
                <span className={styles.factLabel}>Month-end count date</span>
                <input type="date" className={styles.dateInput} value={auditDate} max={istDate()}
                  onChange={e => setAuditDate(e.target.value)} />
                <span className={styles.subtitle} style={{ display: 'block', margin: 0 }}>{audit.lines.length} items in the file</span>
              </div>
            )}
            {usage && <div><span className={styles.factLabel}>Rista usage</span><strong>{usage.lines.filter(l => l.ideal_qty !== 0).length} materials used</strong></div>}
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
