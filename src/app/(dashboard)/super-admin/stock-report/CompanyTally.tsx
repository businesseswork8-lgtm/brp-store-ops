'use client';

import React, { useCallback, useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCompanyAudit, isCompanyAudit } from '@/lib/stock/audit-files';
import { toDisplay } from '@/lib/stock/units';
import styles from '../super-admin.module.css';

type Store = { id: string; name: string; rista_branch_name?: string | null };
type Audit = { id: string; last_audit_date: string; audit_date: string; file_name: string | null; totals: Record<string, number> | null };
type Line = { sku: string; name: string; unit: string; rate: number; received: number; transfer_in: number; transfer_out: number;
  wastage: number; sold: number; system_closing: number; actual_closing: number; variance: number; variance_amount: number };
type AppRow = { rista_sku: string | null; uom: string; rista_unit: string | null; received: number; wastage: number; used: number;
  variance: number; variance_amount: number; status: string; opening_date: string; closing_date: string };

const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const fmt = (ymd: string) => new Date(ymd + 'T00:00:00Z').toLocaleDateString('en-IN', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
const norm = (s: string | null | undefined) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Company audit report vs the app, item by item, for the same period. */
export function CompanyTally({ supabase, store, canEdit }: { supabase: SupabaseClient; store: Store; canEdit: boolean }) {
  const [audits, setAudits] = useState<Audit[]>([]);
  const [sel, setSel] = useState<string>('');
  const [lines, setLines] = useState<Line[]>([]);
  const [app, setApp] = useState<Record<string, AppRow>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadAudits = useCallback(async () => {
    const { data } = await supabase.from('company_audits').select('id, last_audit_date, audit_date, file_name, totals')
      .eq('store_id', store.id).order('audit_date', { ascending: false });
    const list = (data || []) as Audit[];
    setAudits(list);
    setSel(s => (list.some(a => a.id === s) ? s : list[0]?.id || ''));
  }, [supabase, store.id]);

  useEffect(() => { loadAudits(); }, [loadAudits]);

  const audit = audits.find(a => a.id === sel);

  useEffect(() => {
    if (!audit) { setLines([]); setApp({}); return; }
    (async () => {
      const [{ data: l }, { data: rep }] = await Promise.all([
        supabase.from('company_audit_lines').select('*').eq('audit_id', audit.id),
        supabase.rpc('stock_variance_report', { p_store_id: store.id, p_from: audit.last_audit_date, p_to: audit.audit_date }),
      ]);
      setLines(((l || []) as Line[]).map(x => ({ ...x, variance_amount: Number(x.variance_amount) })));
      const m: Record<string, AppRow> = {};
      ((rep || []) as AppRow[]).forEach(r => { if (r.rista_sku) m[r.rista_sku] = r; });
      setApp(m);
    })();
  }, [supabase, store.id, audit]);

  const upload = async (f: File) => {
    setMsg(null);
    const buf = await f.arrayBuffer();
    if (!isCompanyAudit(buf)) { setMsg({ ok: false, text: 'This is not the company audit report (sheet "Stock Audit Working MTD" not found).' }); return; }
    const a = parseCompanyAudit(buf);
    if (a.warnings.length) { setMsg({ ok: false, text: a.warnings.join(' ') }); return; }
    if (store.rista_branch_name && a.store && norm(a.store) !== norm(store.rista_branch_name)) {
      setMsg({ ok: false, text: `This report is for "${a.store}", but the selected store is ${store.name}. Pick the right store at the top.` });
      return;
    }
    const useCounts = confirm(`Audit of ${a.store || store.name}: ${fmt(a.lastDate!)} → ${fmt(a.auditDate!)}, ${a.lines.length} items.\n\n` +
      `Use the auditor's counts as this store's stock count on ${fmt(a.auditDate!)}?\n(Recommended: the app and the company then start the next month from the same numbers.)`);
    setBusy(true);
    const { data, error } = await supabase.rpc('save_company_audit', {
      p_store_id: store.id, p_last: a.lastDate, p_date: a.auditDate, p_file: f.name,
      p_totals: a.totals, p_lines: a.lines, p_set_counts: useCounts,
    });
    setBusy(false);
    if (error) { setMsg({ ok: false, text: 'Could not save: ' + error.message }); return; }
    const d = data as { saved?: number };
    setMsg({ ok: true, text: `✅ Company audit saved.${useCounts ? ` ${d.saved ?? 0} items' counts set for ${fmt(a.auditDate!)}.` : ''}` });
    await loadAudits();
  };

  const t = audit?.totals || {};
  const appShort = lines.reduce((s, l) => { const r = app[l.sku]; return s + (r && Number(r.variance_amount) < 0 ? Number(r.variance_amount) : 0); }, 0);
  const appExcess = lines.reduce((s, l) => { const r = app[l.sku]; return s + (r && Number(r.variance_amount) > 0 ? Number(r.variance_amount) : 0); }, 0);
  const compared = lines.filter(l => app[l.sku]).length;

  return (
    <div className={styles.card} style={{ marginBottom: '1rem', overflowX: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h3 style={{ margin: 0 }}>Company audit — tally</h3>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {audits.length > 0 && (
            <select className={styles.selectFilter} value={sel} onChange={e => setSel(e.target.value)}>
              {audits.map(a => <option key={a.id} value={a.id}>{fmt(a.last_audit_date)} → {fmt(a.audit_date)}</option>)}
            </select>
          )}
          {canEdit && (
            <label className={styles.secondaryButton}>
              {busy ? 'Saving…' : '📤 Upload company audit report'}
              <input type="file" accept=".xlsx,.xls" style={{ display: 'none' }} disabled={busy}
                onChange={e => { if (e.target.files?.[0]) upload(e.target.files[0]); e.target.value = ''; }} />
            </label>
          )}
        </div>
      </div>
      {msg && <p style={{ color: msg.ok ? 'var(--success)' : 'var(--danger)' }}>{msg.text}</p>}

      {!audit ? (
        <p className={styles.subtitle}>No company audit uploaded for this store yet. Upload the audit report (.xlsx) the company sends you.</p>
      ) : (
        <>
          <table className={styles.table} style={{ margin: '1rem 0' }}>
            <thead><tr><th></th><th>Excess</th><th>Short</th><th>Net</th></tr></thead>
            <tbody>
              <tr><td>Company</td><td style={{ color: 'var(--success)' }}>{inr(t.total_excess || 0)}</td>
                <td style={{ color: 'var(--danger)' }}>{inr(t.total_short || 0)}</td><td>{inr((t.total_excess || 0) + (t.total_short || 0))}</td></tr>
              <tr><td>App (same items, same period)</td><td style={{ color: 'var(--success)' }}>{inr(appExcess)}</td>
                <td style={{ color: 'var(--danger)' }}>{inr(appShort)}</td><td>{inr(appExcess + appShort)}</td></tr>
            </tbody>
          </table>
          {compared < lines.length && (
            <p className={styles.subtitle}>
              The app can compare {compared} of {lines.length} items. The rest need a stock count on or before {fmt(audit.last_audit_date)} —
              this tally becomes complete from the next audit, because the auditor&apos;s counts on {fmt(audit.audit_date)} are the app&apos;s starting point.
            </p>
          )}
          <table className={styles.table}>
            <thead>
              <tr><th>Item</th><th>Unit</th><th>Company received</th><th>App received</th><th>Company sold</th><th>App used</th>
                <th>Company variance</th><th>App variance</th><th>Company ₹</th><th>App ₹</th><th>Why different</th></tr>
            </thead>
            <tbody>
              {[...lines].sort((a, b) => a.variance_amount - b.variance_amount).map(l => {
                const r = app[l.sku];
                const d = (q: number) => (r ? r3(toDisplay(Number(q), r.rista_unit, r.uom)) : null);
                const coRec = r3(Number(l.received) + Number(l.transfer_in) - Number(l.transfer_out));
                const why = !r ? 'No app count for this period'
                  : Math.abs((d(r.received) ?? 0) - coRec) > 0.01 ? 'Deliveries / transfers differ'
                  : Math.abs((d(r.used) ?? 0) - Number(l.sold)) > 0.01 ? 'Rista usage differs (missing upload?)'
                  : Math.abs((d(r.wastage) ?? 0) - Number(l.wastage)) > 0.01 ? 'Wastage differs'
                  : Math.abs(Number(r.variance_amount) - l.variance_amount) > 1 ? 'Counts or rate differ' : '✓ Same';
                return (
                  <tr key={l.sku}>
                    <td style={{ fontWeight: 600 }}>{l.name}<div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{l.sku}</div></td>
                    <td>{l.unit}</td>
                    <td>{coRec}</td><td>{r ? d(r.received) : '—'}</td>
                    <td>{r3(Number(l.sold))}</td><td>{r ? d(r.used) : '—'}</td>
                    <td style={{ color: Number(l.variance) < 0 ? 'var(--danger)' : undefined }}>{r3(Number(l.variance))}</td>
                    <td style={{ color: r && Number(r.variance) < 0 ? 'var(--danger)' : undefined }}>{r ? d(r.variance) : '—'}</td>
                    <td style={{ fontWeight: 600 }}>{inr(l.variance_amount)}</td>
                    <td style={{ fontWeight: 600 }}>{r ? inr(Number(r.variance_amount)) : '—'}</td>
                    <td style={{ fontSize: '0.85rem', color: why.startsWith('✓') ? 'var(--success)' : 'var(--warning)' }}>{why}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
