'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import styles from '../store.module.css';
import { useActiveStore } from '@/lib/hooks/useActiveStore';
import { istDate, addDays } from '@/lib/dates';
import { parseConsumption, ParsedConsumption } from '@/lib/stock/rista-consumption';

type Upload = { id: string; date_from: string; date_to: string; file_name: string | null; created_at: string };
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const fmt = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short' });

export default function RistaUsagePage() {
  const { supabase, store, loading: storeLoading } = useActiveStore();
  const yesterday = addDays(istDate(), -1);
  const [from, setFrom] = useState(yesterday);
  const [to, setTo] = useState(yesterday);
  const [file, setFile] = useState<(ParsedConsumption & { fileName: string }) | null>(null);
  const [skus, setSkus] = useState<Set<string>>(new Set());
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!store) return;
    const [{ data: items }, { data: ups }] = await Promise.all([
      supabase.from('items').select('rista_sku, item_categories!inner(brand_id)')
        .eq('item_categories.brand_id', store.brand_id).not('rista_sku', 'is', null),
      supabase.from('rista_consumption_uploads').select('id, date_from, date_to, file_name, created_at')
        .eq('store_id', store.id).order('date_from', { ascending: false }).limit(20),
    ]);
    setSkus(new Set((items || []).map(i => String(i.rista_sku))));
    setUploads((ups || []) as Upload[]);
  }, [supabase, store]);

  useEffect(() => { load(); }, [load]);

  const read = async (f: File) => {
    setMessage(null);
    try {
      setFile({ ...parseConsumption(await f.arrayBuffer(), f.name), fileName: f.name });
    } catch (e) {
      console.error(e);
      setMessage({ type: 'error', text: `Could not read "${f.name}".` });
    }
  };

  const problems: string[] = [];
  if (file && store) {
    problems.push(...file.warnings);
    if (!store.rista_branch_name) problems.push(`The Rista branch name for ${store.name} is not set yet. Ask the Super Admin.`);
    else if (!file.branch) problems.push('The file was renamed, so we can\'t tell which store it is from. Upload it exactly as Rista downloaded it.');
    else if (norm(file.branch) !== norm(store.rista_branch_name)) problems.push(`This file is from "${file.branch}", but this store is ${store.name}.`);
    if (to < from) problems.push('"To" date is before "From" date.');
    if (to > istDate()) problems.push('"To" date is in the future.');
  }
  const matched = file ? file.lines.filter(l => skus.has(l.sku)) : [];
  const canSave = Boolean(store && file && problems.length === 0);

  const save = async (replace = false) => {
    if (!store || !file) return;
    setSaving(true);
    setMessage(null);
    const { error } = await supabase.rpc('save_rista_consumption', {
      p_store_id: store.id, p_from: from, p_to: to, p_file: file.fileName, p_replace: replace,
      p_lines: file.lines.map(l => ({ sku: l.sku, name: l.name, category: l.category, unit: l.unit, ideal_qty: l.ideal_qty, rate: l.rate })),
    });
    setSaving(false);
    if (error) {
      if (/OVERLAP/.test(error.message)) {
        const which = error.message.split('(')[1]?.replace(')', '') || '';
        if (confirm(`Usage for ${which} is already uploaded. Replace it with this file?`)) save(true);
        return;
      }
      setMessage({ type: 'error', text: /row-level security/i.test(error.message)
        ? 'These dates are closed for store uploads. Ask your manager.' : 'Could not save: ' + error.message });
      return;
    }
    setMessage({ type: 'success', text: `✅ Rista usage saved for ${fmt(from)}${to !== from ? ` – ${fmt(to)}` : ''}.` });
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    load();
  };

  const removeUpload = async (u: Upload) => {
    if (!confirm(`Delete the upload for ${fmt(u.date_from)} – ${fmt(u.date_to)}?`)) return;
    const { error } = await supabase.from('rista_consumption_uploads').delete().eq('id', u.id);
    if (error) setMessage({ type: 'error', text: 'Could not delete: ' + error.message });
    else load();
  };

  if (storeLoading) return <div className={styles.spinner}></div>;
  if (!store) return <div className={styles.container}>No store is assigned to this login.</div>;

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Upload Rista Usage</h1>
          <p className={styles.subtitle}>
            In Rista, download <strong>Consumption Variance</strong> for the dates below, then upload it here. It tells the app what sales used.
          </p>
        </div>
        <Link href="/store" className={styles.backLink}>← Back</Link>
      </header>

      <div className={styles.card}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'end' }}>
          <label className={styles.statusText}>From<br />
            <input type="date" className={styles.input} value={from} max={istDate()} onChange={e => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value); }} />
          </label>
          <label className={styles.statusText}>To<br />
            <input type="date" className={styles.input} value={to} max={istDate()} onChange={e => setTo(e.target.value)} />
          </label>
          <span className={styles.statusText}>Use the <strong>same dates</strong> you picked in Rista. One day at a time is best.</span>
        </div>
        <div style={{ marginTop: '1rem' }}>
          <input ref={inputRef} type="file" accept=".csv,.xlsx,.xls" onChange={e => e.target.files?.[0] && read(e.target.files[0])} />
        </div>

        {file && (
          <p className={styles.statusText} style={{ marginTop: '1rem' }}>
            {file.lines.length} materials in the file · <strong>{matched.length}</strong> match items in the app
            {file.lines.length - matched.length > 0 && <> · {file.lines.length - matched.length} not in the app yet (add them on the Items page if you want to track them)</>}
          </p>
        )}
        {problems.map((p, i) => <p key={i} style={{ color: 'var(--danger)' }}>⚠ {p}</p>)}
        {message && <p style={{ color: message.type === 'success' ? 'var(--success)' : 'var(--danger)' }}>{message.text}</p>}

        {file && (
          <button className={styles.button} style={{ marginTop: '1rem' }} disabled={!canSave || saving} onClick={() => save()}>
            {saving ? 'Saving…' : '✓ Save'}
          </button>
        )}
      </div>

      <div className={styles.card}>
        <h3 style={{ marginTop: 0 }}>Uploaded so far</h3>
        {uploads.length === 0 ? <p className={styles.statusText}>Nothing uploaded yet.</p> : (
          <table className={styles.table}>
            <thead><tr><th>Dates</th><th>File</th><th></th></tr></thead>
            <tbody>
              {uploads.map(u => (
                <tr key={u.id}>
                  <td>{fmt(u.date_from)}{u.date_to !== u.date_from ? ` – ${fmt(u.date_to)}` : ''}</td>
                  <td style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{u.file_name}</td>
                  <td><button className={styles.backLink} onClick={() => removeUpload(u)}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
