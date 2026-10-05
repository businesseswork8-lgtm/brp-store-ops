import * as XLSX from 'xlsx';
import { groupForRistaCategory } from './units';

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[,₹\s]/g, ''));
  return isNaN(n) ? 0 : n;
};
const toYmd = (v: unknown): string | null => {
  if (v instanceof Date) return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  if (typeof v === 'number') { const d = XLSX.SSF.parse_date_code(v); return d ? `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}` : null; }
  return null;
};

// ---------------------------------------------------------------------------
// Rista month-end audit (SKU, BARCODE, TYPE, CATEGORY, SUB CATEGORY, NAME, PERISHABLE, SIZE, QUANTITY, AUDIT STATUS)
// ---------------------------------------------------------------------------
export type AuditLine = {
  sku: string; name: string; type: string; category: string; sub_category: string;
  unit: string; qty: number; perishable: boolean; stock_group: string;
};

export function isMonthEndAudit(headText: string) {
  const h = headText.toUpperCase();
  return h.includes('AUDIT STATUS') || (h.includes('QUANTITY') && h.includes('PERISHABLE'));
}

export function parseMonthEndAudit(content: ArrayBuffer): { lines: AuditLine[]; warnings: string[] } {
  const wb = XLSX.read(content, { type: 'array', raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }) as string[][];
  const head = (rows[0] || []).map(h => String(h).trim().toUpperCase());
  const c = (n: string) => head.indexOf(n);
  const i = { sku: c('SKU'), type: c('TYPE'), cat: c('CATEGORY'), sub: c('SUB CATEGORY'), name: c('NAME'), per: c('PERISHABLE'), size: c('SIZE'), qty: c('QUANTITY') };
  if (i.sku < 0 || i.qty < 0 || i.name < 0) return { lines: [], warnings: ['This is not a Rista month-end audit file (SKU / NAME / QUANTITY columns not found).'] };
  const lines: AuditLine[] = [];
  for (const r of rows.slice(1)) {
    const sku = String(r[i.sku] ?? '').trim();
    if (!sku) continue;
    const category = String(r[i.cat] ?? '').trim();
    const sub = i.sub >= 0 ? String(r[i.sub] ?? '').trim() : '';
    lines.push({
      sku, name: String(r[i.name] ?? '').trim(), type: i.type >= 0 ? String(r[i.type] ?? '').trim() : '',
      category, sub_category: sub,
      unit: i.size >= 0 ? String(r[i.size] ?? '').replace(/^\s*1\s+/, '').trim() : '',
      qty: num(r[i.qty]), perishable: i.per >= 0 && /yes/i.test(String(r[i.per])),
      stock_group: groupForRistaCategory(category, sub),
    });
  }
  return { lines, warnings: lines.length ? [] : ['No items found in this file.'] };
}

// ---------------------------------------------------------------------------
// Company audit report (.xlsx with sheet "Stock Audit Working MTD")
// ---------------------------------------------------------------------------
export type CompanyAuditLine = {
  sku: string; name: string; unit: string; rate: number;
  opening: number; received: number; trans_in: number; trans_out: number; wastage: number;
  sold: number; system: number; actual: number; variance: number; amount: number;
};
export type CompanyAudit = {
  store: string | null; lastDate: string | null; auditDate: string | null;
  totals: Record<string, number>; lines: CompanyAuditLine[]; warnings: string[];
};

export function isCompanyAudit(content: ArrayBuffer) {
  try { return XLSX.read(content, { type: 'array', bookSheets: true }).SheetNames.some(n => /stock audit working/i.test(n)); }
  catch { return false; }
}

export function parseCompanyAudit(content: ArrayBuffer): CompanyAudit {
  const wb = XLSX.read(content, { type: 'array', cellDates: true });
  const name = wb.SheetNames.find(n => /stock audit working/i.test(n));
  const out: CompanyAudit = { store: null, lastDate: null, auditDate: null, totals: {}, lines: [], warnings: [] };
  if (!name) { out.warnings.push('Sheet "Stock Audit Working MTD" not found.'); return out; }
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: null, raw: true }) as unknown[][];
  out.store = rows[0]?.[0] ? String(rows[0][0]).trim() : null;
  for (const r of rows.slice(0, 6)) {
    const label = String(r?.[1] ?? '').toLowerCase();
    if (label.includes('last audit')) out.lastDate = toYmd(r[2]);
    if (label.includes('fresh audit')) {
      out.auditDate = toYmd(r[2]);
      const keys = ['cakes_excess', 'cakes_short', 'raw_excess', 'raw_short', 'pack_excess', 'pack_short', 'total_excess', 'total_short'];
      keys.forEach((k, n) => { out.totals[k] = num(r[4 + n]); });
    }
  }
  const h = rows.findIndex(r => String(r?.[0] ?? '').trim().toUpperCase() === 'SKU' && String(r?.[1] ?? '').toUpperCase().includes('ITEM'));
  if (h < 0) { out.warnings.push('Could not find the item table (SKU / ITEM header).'); return out; }
  for (const r of rows.slice(h + 1)) {
    const sku = String(r?.[0] ?? '').trim();
    if (!sku || typeof r[3] !== 'number') continue;
    out.lines.push({
      sku, name: String(r[1] ?? '').trim(), unit: String(r[2] ?? '').trim(), rate: num(r[3]),
      opening: num(r[4]), received: num(r[5]), trans_in: num(r[6]), trans_out: num(r[7]), wastage: num(r[8]),
      sold: num(r[9]), system: num(r[10]), actual: num(r[11]), variance: num(r[12]), amount: num(r[14]),
    });
  }
  if (!out.auditDate) out.warnings.push('Audit date ("Fresh Audit Date") not found.');
  if (!out.lastDate) out.warnings.push('Previous audit date ("Last Audit Date") not found.');
  if (!out.lines.length) out.warnings.push('No items found in the stock audit sheet.');
  return out;
}
