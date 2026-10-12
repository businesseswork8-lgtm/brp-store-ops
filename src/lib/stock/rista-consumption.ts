import * as XLSX from 'xlsx';
import { branchFromFileName } from '@/lib/services/rista-parser';

/** One row of Rista "Consumption Variance" — what sales used per material. */
export type ConsumptionLine = {
  sku: string;
  name: string;
  type: string;
  category: string;
  sub_category: string;
  unit: string;
  ideal_qty: number;   // used by sales (Rista recipes), in Rista unit
  rate: number | null; // ₹ per Rista unit
};

export type ParsedConsumption = { branch: string | null; lines: ConsumptionLine[]; warnings: string[] };

const num = (v: unknown) => {
  const n = parseFloat(String(v ?? '').replace(/[,₹\s]/g, ''));
  return isNaN(n) ? 0 : n;
};

/** "Borivali Dattapada - Consumption Variance - 2026-10-05_18_09_27.csv" → "Borivali Dattapada" */
export function consumptionBranch(fileName: string): string | null {
  const m = fileName.replace(/_/g, ' ').match(/^(.*?)\s+-\s+Consumption\s+Variance/i);
  return m ? m[1].trim() : branchFromFileName(fileName);
}

export function parseConsumption(content: ArrayBuffer, fileName: string): ParsedConsumption {
  const wb = XLSX.read(content, { type: 'array', raw: true });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '', raw: false }) as string[][];
  const out: ParsedConsumption = { branch: consumptionBranch(fileName), lines: [], warnings: [] };
  if (!rows.length) { out.warnings.push('The file is empty.'); return out; }

  const header = rows[0].map(h => String(h).trim().toLowerCase());
  const col = (name: string) => header.indexOf(name.toLowerCase());
  const c = {
    sku: col('SKU'), type: col('TYPE'), cat: col('Category'), sub: col('Sub Category'), name: col('NAME'),
    unit: col('MEASURING UNIT'), iq: col('Ideal Qty'), ic: col('Ideal Cost'),
    aq: col('Actual Qty'), ac: col('Actual Cost'), vq: col('Variance In Qty'), vc: col('Variance In Cost'),
  };
  if (c.sku < 0 || c.name < 0 || c.iq < 0) {
    out.warnings.push('This is not a Rista "Consumption Variance" report (SKU / NAME / Ideal Qty columns not found).');
    return out;
  }

  for (const r of rows.slice(1)) {
    const sku = String(r[c.sku] ?? '').trim();
    if (!sku) continue;
    const iq = num(r[c.iq]);
    // Rate = cost ÷ quantity from whichever column has a quantity
    const pairs: [number, number][] = [[iq, num(r[c.ic])], [num(r[c.aq]), num(r[c.ac])], [num(r[c.vq]), num(r[c.vc])]];
    const p = pairs.find(([q]) => q !== 0);
    out.lines.push({
      sku,
      name: String(r[c.name] ?? '').trim(),
      type: c.type >= 0 ? String(r[c.type] ?? '').trim() : '',
      category: c.cat >= 0 ? String(r[c.cat] ?? '').trim() : '',
      sub_category: c.sub >= 0 ? String(r[c.sub] ?? '').trim() : '',
      unit: c.unit >= 0 ? String(r[c.unit] ?? '').trim() : '',
      ideal_qty: iq,
      rate: p ? Math.round((p[1] / p[0]) * 100) / 100 : null,
    });
  }
  if (!out.lines.length) out.warnings.push('No items found in this file.');
  return out;
}
