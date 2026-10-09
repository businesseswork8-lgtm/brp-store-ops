'use client';

import React, { useRef, useState } from 'react';
import Link from 'next/link';
import { parseRistaPOSFile, ParsedPOSReport } from '@/lib/services/rista-parser';
import { parseConsumption, ParsedConsumption } from '@/lib/stock/rista-consumption';
import { isMonthEndAudit, parseMonthEndAudit, AuditLine } from '@/lib/stock/audit-files';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import styles from './page.module.css';
import { isBRStore } from '@/lib/br';

type Parsed = ParsedPOSReport & { fileName: string };
type Usage = ParsedConsumption & { fileName: string };
type MonthEnd = { lines: AuditLine[]; warnings: string[]; fileName: string };

/** Rista "Consumption Variance" = what sales used, per material. */
const isUsageFile = (name: string, text: string) =>
  /consumption\s*variance/i.test(name.replace(/_/g, ' ')) || /ideal qty/i.test(text.slice(0, 400));

const inr = (n: number) => `₹ ${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

function formatShortDate(ymd: string): string {
  try {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
      timeZone: 'UTC', day: 'numeric', month: 'short',
    });
  } catch {
    return ymd;
  }
}

export default function UploadPage() {
  const { supabase, store, profile, reload } = useActiveStore();

  // Admin check: Only admin or super_admin can manually pick historical / previous dates
  const isAdmin = profile?.role === 'super_admin' || profile?.role === 'admin';

  // Calendar dates in IST
  const todayCal = istDate(new Date());
  const yesterdayCal = addDays(todayCal, -1);

  const [files, setFiles] = useState<Parsed[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [audit, setAudit] = useState<MonthEnd | null>(null);

  // Admin date selection state
  const [itemsDate, setItemsDate] = useState(yesterdayCal);
  const [usageFrom, setUsageFrom] = useState(yesterdayCal);
  const [auditDate, setAuditDate] = useState(todayCal);

  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const summary = files.find(f => f.kind === 'summary');
  const items = files.find(f => f.kind === 'items');

  // Effective sales date:
  // 1. If Sales Summary is present, the date is extracted directly from the Sales Summary file.
  // 2. If admin is uploading without summary, use admin's selected itemsDate.
  // 3. For store staff uploading without summary, default directly to current business date istDate().
  const effectiveDate = summary?.date || (isAdmin ? itemsDate : istDate());

  // ---- read files ----
  const readFiles = async (list: FileList | File[]) => {
    setMessage(null);
    const newFiles: Parsed[] = [...files];
    let use: Usage | null = usage;
    let aud: MonthEnd | null = audit;

    for (const file of Array.from(list).slice(0, 5)) {
      try {
        const buf = await file.arrayBuffer();
        const head = new TextDecoder().decode(buf.slice(0, 400));
        if (isMonthEndAudit(head)) {
          aud = { ...parseMonthEndAudit(buf), fileName: file.name };
        } else if (isUsageFile(file.name, head)) {
          use = { ...parseConsumption(buf, file.name), fileName: file.name };
        } else {
          const parsedItem = { ...parseRistaPOSFile(buf, file.name), fileName: file.name };
          const idx = newFiles.findIndex(f => f.kind === parsedItem.kind);
          if (idx >= 0) newFiles[idx] = parsedItem;
          else newFiles.push(parsedItem);
        }
      } catch (e) {
        console.error(e);
        setMessage({ type: 'error', text: `Could not read "${file.name}". Is it a Rista CSV/Excel export?` });
        return;
      }
    }
    setFiles(newFiles);
    setUsage(use);
    setAudit(aud);
  };

  // ---- validation ----
  // Sales financial data is taken from Sales Summary only.
  // Sales By Items is provided ONLY for flavour variance tracking, NOT for cross-checking net sales.
  const problems: string[] = [];
  const notices: string[] = [];

  if (store) {
    for (const f of files) {
      problems.push(...f.warnings.map(w => `${f.fileName}: ${w}`));
      const expected = store.rista_branch_name;
      if (!expected) {
        problems.push(`The Rista branch name for ${store.name} is not set yet. Ask the Super Admin to set it.`);
      } else if (!f.branch) {
        problems.push(`"${f.fileName}" has been renamed, so we can't verify the store. Please upload the file exactly as Rista downloaded it.`);
      } else if (norm(f.branch) !== norm(expected)) {
        problems.push(`"${f.fileName}" is from "${f.branch}", but this store is ${store.name} ("${expected}"). Please download the report for this store.`);
      }
    }

    if (summary?.date && summary.date > todayCal) {
      problems.push('The Sales Summary date is in the future.');
    }

    if (usage) {
      problems.push(...usage.warnings.map(w => `${usage.fileName}: ${w}`));
      if (store.rista_branch_name && usage.branch && norm(usage.branch) !== norm(store.rista_branch_name)) {
        problems.push(`"${usage.fileName}" is from "${usage.branch}", but this store is ${store.name}.`);
      } else if (store.rista_branch_name && !usage.branch) {
        problems.push(`"${usage.fileName}" has been renamed. Please upload it exactly as Rista downloaded it.`);
      }
    }
  }

  if (audit) problems.push(...audit.warnings.map(w => `${audit.fileName}: ${w}`));
  if (usage && !summary && usageFrom > (isAdmin ? itemsDate : istDate())) {
    problems.push('Rista usage: "From" date is after the "To" date.');
  }

  const canSave = Boolean(
    store &&
    (files.length > 0 || usage || audit) &&
    (effectiveDate || audit) &&
    problems.length === 0
  );

  // ---- save ----
  const handleSave = async () => {
    if (!store || (!effectiveDate && !audit)) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Session expired. Please log in again.');

      const base = { store_id: store.id, entry_date: effectiveDate, submitted_by_profile_id: user.id };

      // 1. Summary: write financial columns strictly from Sales Summary
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

      // 2. Items: save item lines solely for flavour variance tracking without modifying summary financials
      if (items) {
        const { error } = await supabase.rpc('save_sales_items', {
          p_store_id: store.id,
          p_date: effectiveDate,
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
          p_store_id: store.id, p_from: summary ? effectiveDate : usageFrom, p_to: effectiveDate, p_file: usage.fileName, p_lines: lines, p_replace: replace,
        });
        let { error } = await call(false);
        if (error && /OVERLAP/.test(error.message)) {
          if (!confirm(`Rista usage for ${effectiveDate} is already uploaded. Replace it with this file?`)) {
            throw new Error('Not saved — usage for this day was already uploaded.');
          }
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

      const what = [
        summary && 'Sales Summary',
        items && 'Sales By Items',
        usage && 'Rista usage',
        audit && 'Month-end audit',
      ].filter(Boolean).join(' + ');

      setMessage({
        type: 'success',
        text: `✅ ${what} saved for ${store.name}${effectiveDate ? `, ${effectiveDate}` : ''}.${auditNote}`,
      });
      setFiles([]);
      setUsage(null);
      setAudit(null);
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : (err as { message?: string })?.message || String(err);
      setMessage({
        type: 'error',
        text: /row-level security/i.test(msg)
          ? 'This day is closed for store changes. Ask your manager to upload it.'
          : 'Could not save: ' + msg,
      });
    } finally {
      setSaving(false);
    }
  };

  if (!store) {
    return (
      <div className={styles.container}>
        No store is assigned to this login. Please contact your manager.
      </div>
    );
  }

  const s = summary?.summary;

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.titleArea}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>Upload Rista Files</h1>
            <span className={styles.storeBadge}>🏪 {store.name}</span>
          </div>
          {isBRStore(store) ? (
            <p className={styles.subtitle}>
              At closing, download these two from Rista and upload together:
              <br />
              <strong>1. Sales Summary</strong> &nbsp;•&nbsp; <strong>2. Sales By Items</strong> (records flavour quantities sold)
            </p>
          ) : (
            <p className={styles.subtitle}>
              Download from Rista and upload together:
              <br />
              <strong>1. Sales Summary</strong> &nbsp;•&nbsp; <strong>2. Consumption Variance</strong>
            </p>
          )}
        </div>
        <Link href="/store" className={styles.backLink}>
          ← Back to Store
        </Link>
      </header>

      {/* Admin-only date selector: Store staff do not see this to keep it simple and confusion-free */}
      {isAdmin && !summary && (
        <div className={styles.dateSection}>
          <div className={styles.dateHeader}>
            <span className={styles.dateLabel}>
              👑 Admin: Target Date for Upload
            </span>
            <span className={styles.dateHint}>
              Select sales date for items / usage (store staff upload for the current shift):
            </span>
          </div>
          <div className={styles.dateButtonGroup}>
            <button
              type="button"
              className={`${styles.dateBtn} ${itemsDate === yesterdayCal ? styles.dateBtnActive : ''}`}
              onClick={() => setItemsDate(yesterdayCal)}
            >
              ⏮️ Previous Day (Yesterday · {formatShortDate(yesterdayCal)})
            </button>
            <button
              type="button"
              className={`${styles.dateBtn} ${itemsDate === todayCal ? styles.dateBtnActive : ''}`}
              onClick={() => setItemsDate(todayCal)}
            >
              📅 Today ({formatShortDate(todayCal)})
            </button>
            <input
              type="date"
              className={styles.dateInput}
              value={itemsDate}
              max={todayCal}
              onChange={e => e.target.value && setItemsDate(e.target.value)}
              title="Choose custom date"
              aria-label="Target sales date"
            />
          </div>
        </div>
      )}

      {/* Drop / Tap zone */}
      <div
        className={`${styles.dropZone} ${dragging ? styles.dragging : ''}`}
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) readFiles(e.dataTransfer.files);
        }}
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
        <div className={styles.dropIcon}>📁</div>
        <h3 className={styles.dropTitle}>
          {files.length || usage || audit
            ? [...files.map(f => f.fileName), usage?.fileName, audit?.fileName].filter(Boolean).join(', ')
            : 'Tap to choose file(s) from phone, or drag here'}
        </h3>
        <p className={styles.dropSubtitle}>
          Pick Sales Summary, Sales By Items, or both at once. Month-end audit file goes here too.
        </p>
      </div>

      {/* Uploaded File Cards */}
      <div className={styles.fileCardsGrid}>
        <div className={`${styles.fileCard} ${summary ? styles.fileCardReady : ''}`}>
          <div className={styles.fileCardHeader}>
            <span className={styles.fileCardTitle}>
              {summary ? '✓' : '1.'} Sales Summary
            </span>
            <span className={styles.fileCardStatusBadge}>
              {summary ? 'Ready' : 'Sales figures'}
            </span>
          </div>
          <div className={styles.fileCardMeta}>
            {summary
              ? `${summary.fileName} · Net: ₹${summary.summary.net_sales?.toLocaleString('en-IN')}`
              : 'Daily sales totals & cash/card/UPI breakdown'}
          </div>
        </div>

        <div className={`${styles.fileCard} ${items ? styles.fileCardReady : ''}`}>
          <div className={styles.fileCardHeader}>
            <span className={styles.fileCardTitle}>
              {items ? '✓' : '2.'} Sales By Items
            </span>
            <span className={styles.fileCardStatusBadge}>
              {items ? 'Ready' : 'Variance tracking'}
            </span>
          </div>
          <div className={styles.fileCardMeta}>
            {items
              ? `${items.fileName} · ${items.items?.length || 0} line(s) sold`
              : 'Flavour sales data used solely for stock variance'}
          </div>
        </div>

        {usage && (
          <div className={`${styles.fileCard} ${styles.fileCardReady}`}>
            <div className={styles.fileCardHeader}>
              <span className={styles.fileCardTitle}>✓ Consumption Variance</span>
              <span className={styles.fileCardStatusBadge}>Ready</span>
            </div>
            <div className={styles.fileCardMeta}>
              {usage.fileName} · {usage.lines.length} material lines
            </div>
          </div>
        )}

        {audit && (
          <div className={`${styles.fileCard} ${styles.fileCardReady}`}>
            <div className={styles.fileCardHeader}>
              <span className={styles.fileCardTitle}>✓ Month-End Audit</span>
              <span className={styles.fileCardStatusBadge}>Ready</span>
            </div>
            <div className={styles.fileCardMeta}>
              {audit.fileName} · {audit.lines.length} inventory count items
            </div>
          </div>
        )}
      </div>

      {(files.length > 0 || usage || audit) && (
        <div className={styles.clearRow}>
          <button
            type="button"
            className={styles.clearBtn}
            onClick={() => {
              setFiles([]);
              setUsage(null);
              setAudit(null);
              setMessage(null);
            }}
          >
            ✕ Clear selected files
          </button>
        </div>
      )}

      {/* Feedback Messages */}
      {message && (
        <div className={`${styles.alert} ${message.type === 'error' ? styles.error : styles.success}`}>
          {message.text}
        </div>
      )}

      {/* Informative Notices */}
      {notices.length > 0 && (
        <div className={`${styles.alert} ${styles.noticeAlert}`}>
          {notices.map((n, i) => (
            <div key={i}>{n}</div>
          ))}
        </div>
      )}

      {/* Problems / Errors */}
      {problems.length > 0 && (
        <div className={`${styles.alert} ${styles.error}`}>
          {problems.map((p, i) => (
            <div key={i}>⚠ {p}</div>
          ))}

          {store && !store.rista_branch_name && profile?.role === 'super_admin' && (() => {
            const fromFile = files.find(f => f.branch)?.branch || usage?.branch;
            if (!fromFile) return null;
            return (
              <button
                type="button"
                className={styles.saveButton}
                style={{ marginTop: '0.75rem' }}
                onClick={async () => {
                  if (!confirm(`Set the Rista branch name of ${store.name} to "${fromFile}"? Files from any other branch will then be refused for this store.`)) return;
                  const { error } = await supabase.from('stores').update({ rista_branch_name: fromFile }).eq('id', store.id);
                  if (error) alert('Could not save: ' + error.message);
                  else await reload();
                }}
              >
                Use &ldquo;{fromFile}&rdquo; as {store.name}&apos;s Rista branch name
              </button>
            );
          })()}
        </div>
      )}

      {/* Details & Financial Overview */}
      {(files.length > 0 || usage || audit) && (
        <div className={styles.card}>
          <div className={styles.factRow}>
            <div className={styles.factBox}>
              <span className={styles.factLabel}>Store</span>
              <strong className={styles.factValue}>{store.name}</strong>
            </div>

            <div className={styles.factBox}>
              <span className={styles.factLabel}>Sales Date</span>
              <strong className={styles.factValue}>
                {effectiveDate || '—'}
              </strong>
            </div>

            {items && (
              <div className={styles.factBox}>
                <span className={styles.factLabel}>Items Sold</span>
                <strong className={styles.factValue}>
                  {items.items.filter(i => i.item_type !== 'Option').length} products
                </strong>
              </div>
            )}

            {usage && (
              <div className={styles.factBox}>
                <span className={styles.factLabel}>Rista Usage</span>
                <strong className={styles.factValue}>
                  {usage.lines.filter(l => l.ideal_qty !== 0).length} materials
                </strong>
              </div>
            )}

            {audit && (
              <div className={styles.factBox}>
                <span className={styles.factLabel}>Audit Date</span>
                <strong className={styles.factValue}>{auditDate}</strong>
              </div>
            )}
          </div>

          {s && (
            <>
              <h3 className={styles.sectionTitle}>💵 Sales & Payment Breakdown</h3>
              <div className={styles.factGrid}>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Net sales</span>
                  <strong className={styles.factValue}>{inr(s.net_sales)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Orders</span>
                  <strong className={styles.factValue}>{s.total_orders}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Discounts</span>
                  <strong className={styles.factValue}>{inr(s.total_discount)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Cash</span>
                  <strong className={styles.factValue}>{inr(s.cash_amount)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>UPI</span>
                  <strong className={styles.factValue}>{inr(s.upi_amount)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Card</span>
                  <strong className={styles.factValue}>{inr(s.card_amount)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Swiggy</span>
                  <strong className={styles.factValue}>{inr(s.swiggy_amount)}</strong>
                </div>
                <div className={styles.factBox}>
                  <span className={styles.factLabel}>Zomato</span>
                  <strong className={styles.factValue}>{inr(s.zomato_amount)}</strong>
                </div>
                {s.other_online_amount > 0 && (
                  <div className={styles.factBox}>
                    <span className={styles.factLabel}>Other</span>
                    <strong className={styles.factValue}>{inr(s.other_online_amount)}</strong>
                  </div>
                )}
              </div>
            </>
          )}

          <div className={styles.saveSection}>
            <button
              className={styles.saveButton}
              onClick={handleSave}
              disabled={!canSave || saving}
            >
              {saving ? 'Saving to Database…' : `✓ Save to ${store.name}`}
            </button>
            {!canSave && problems.length > 0 && (
              <span className={styles.saveNotice}>
                Please resolve the issues above to enable saving.
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}