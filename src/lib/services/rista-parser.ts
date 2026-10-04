import * as XLSX from 'xlsx'

/**
 * Rista POS report parser.
 *
 * Supported files (verified against real exports):
 *  - "<Branch> - Sales Summary - <timestamp>.csv"          → daily summary (date inside file, payment split)
 *  - "<Branch> - Sales By Items - <timestamp>.csv"         → item-wise sales (SKU, Item / Add On / Option)
 *  - "<Branch> - Sales Summary by Hour - <timestamp>.csv"  → older summary (no payment split)
 */

export type ReportKind = 'summary' | 'items'

export interface SalesSummary {
  gross_sales: number
  net_sales: number
  total_discount: number
  total_tax: number
  service_charges: number
  total_orders: number
  cash_amount: number
  upi_amount: number
  card_amount: number
  swiggy_amount: number
  zomato_amount: number
  other_online_amount: number
  dine_in_amount: number
  takeaway_amount: number
}

export interface SalesItem {
  sku: string
  item_type: string // 'Item' | 'Add On' | 'Option'
  item_name: string
  variant: string
  quantity_sold: number
  unit_price: number
  total_price: number // net amount
  category: string
}

export interface ParsedPOSReport {
  kind: ReportKind
  /** Branch name from the file name, e.g. "Borivali Dattapada" */
  branch: string | null
  /** Sales date (YYYY-MM-DD) if the file contains exactly one day */
  date: string | null
  /** All dates found in the file (summary reports) */
  dates: string[]
  summary: SalesSummary
  items: SalesItem[]
  categories: Array<{ category_name: string; amount: number; quantity: number }>
  /** Problems the user should see */
  warnings: string[]
}

const emptySummary = (): SalesSummary => ({
  gross_sales: 0, net_sales: 0, total_discount: 0, total_tax: 0, service_charges: 0, total_orders: 0,
  cash_amount: 0, upi_amount: 0, card_amount: 0, swiggy_amount: 0, zomato_amount: 0, other_online_amount: 0,
  dine_in_amount: 0, takeaway_amount: 0,
})

const num = (v: unknown): number => {
  if (typeof v === 'number') return v
  const n = parseFloat(String(v ?? '').replace(/[,%₹\s]/g, ''))
  return isNaN(n) ? 0 : n
}

const round2 = (n: number) => Math.round(n * 100) / 100

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
}

/** "03-Oct-2026" → "2026-10-03" */
export function parseRistaDate(s: string): string | null {
  const m = String(s).trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (!m) return null
  const mm = MONTHS[m[2].toLowerCase()]
  return mm ? `${m[3]}-${mm}-${m[1].padStart(2, '0')}` : null
}

/** "Borivali Dattapada - Sales Summary - 2026-10-04_22-01-01.csv" → "Borivali Dattapada" */
export function branchFromFileName(fileName: string): string | null {
  const m = fileName.replace(/_/g, ' ').match(/^(.*?)\s+-\s+Sales\s+(Summary|By\s+Items)/i)
  return m ? m[1].trim() : null
}

/** Map a payment method name from the Payment Summary to our columns. */
function paymentColumn(name: string): keyof SalesSummary {
  const n = name.toLowerCase()
  if (n === 'cash') return 'cash_amount'
  if (n.includes('card')) return 'card_amount'
  if (n.includes('swiggy')) return 'swiggy_amount'
  if (n.includes('zomato')) return 'zomato_amount'
  // "Pinelabs Pay Offline" is UPI (owner confirmed); also catch common UPI names
  if (['pinelabs', 'upi', 'paytm', 'phonepe', 'gpay', 'google pay'].some(k => n.includes(k))) return 'upi_amount'
  return 'other_online_amount'
}

export function parseRistaPOSFile(fileContent: string | ArrayBuffer, fileName = ''): ParsedPOSReport {
  const workbook = typeof fileContent === 'string'
    ? XLSX.read(fileContent, { type: 'string', raw: true })
    : XLSX.read(fileContent, { type: 'array', raw: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false }) as string[][]

  const result: ParsedPOSReport = {
    kind: 'summary',
    branch: branchFromFileName(fileName),
    date: null,
    dates: [],
    summary: emptySummary(),
    items: [],
    categories: [],
    warnings: [],
  }

  if (!rows.length) {
    result.warnings.push('The file is empty.')
    return result
  }

  const header = rows[0].map(h => String(h).trim())

  // ---------- Sales By Items ----------
  if (header.includes('SKU') && header.includes('Item Name') && header.includes('Quantity')) {
    result.kind = 'items'
    const col = (name: string) => header.indexOf(name)
    const c = {
      sku: col('SKU'), type: col('Type'), name: col('Item Name'), invoice: col('Invoice Type'),
      qty: col('Quantity'), net: col('Net Amount'), cat: col('Category'), variant: col('Variant(s)'),
    }

    for (const r of rows.slice(1)) {
      const name = String(r[c.name] ?? '').trim()
      if (!name) continue
      const qty = num(r[c.qty])
      if (qty === 0) continue
      const invoice = c.invoice >= 0 ? String(r[c.invoice] ?? '').trim().toLowerCase() : 'sale'
      // Anything that is not a sale (returns/refunds) reduces quantity sold
      const sign = invoice && invoice !== 'sale' ? -1 : 1
      const net = num(r[c.net])
      result.items.push({
        sku: String(r[c.sku] ?? '').trim(),
        item_type: c.type >= 0 ? String(r[c.type] ?? '').trim() || 'Item' : 'Item',
        item_name: name,
        variant: c.variant >= 0 ? String(r[c.variant] ?? '').trim() : '',
        quantity_sold: sign * qty,
        unit_price: round2(net / qty),
        total_price: sign * net,
        category: c.cat >= 0 ? String(r[c.cat] ?? '').trim() : '',
      })
    }

    // Options carry no revenue, so summing all rows does not double count
    result.summary.net_sales = round2(result.items.reduce((s, i) => s + i.total_price, 0))
    if (!result.items.length) result.warnings.push('No sold items found in this file.')
    return result
  }

  // ---------- Sales Summary / Sales Summary by Hour ----------
  const firstCell = String(rows[0][0] ?? '')
  if (/timeline:/i.test(firstCell)) {
    const tl = firstCell.split(/timeline:/i)[1] || ''
    result.dates = tl.split(',').map(d => parseRistaDate(d)).filter((d): d is string => Boolean(d))
  } else if (header[0] === 'Description') {
    const d = parseRistaDate(header[1])
    if (d) result.dates = [d]
  }

  const descIndex = rows.findIndex(r => String(r[0]).trim() === 'Description')
  if (descIndex === -1) {
    result.warnings.push('This does not look like a Rista "Sales Summary" or "Sales By Items" report.')
    return result
  }

  const hasPayments = rows.some(r => String(r[0]).trim() === 'Payment Summary')
  let section = 'top'
  let channel = ''
  const categoryMap = new Map<string, { amount: number; quantity: number }>()

  for (const r of rows.slice(descIndex + 1)) {
    const raw = String(r[0] ?? '')
    const label = raw.trim()
    // A blank row ends the current section
    if (!label) { section = 'other'; continue }
    const indent = raw.length - raw.trimStart().length
    const total = num(r[1])

    if (indent === 0) {
      if (label === 'Payment Summary') { section = 'payment'; continue }
      if (label === 'Channel Summary') { section = 'channel'; channel = ''; continue }
      if (label === 'Category Summary (Sale Item Quantity)') { section = 'catqty'; continue }
      if (label === 'Category Summary') { section = 'cat'; continue }
      if (label === 'Transactions Summary') { section = 'txn'; continue }

      // Top-of-report totals appear before any section
      if (section === 'top') {
        if (label.startsWith('Gross Sales')) result.summary.gross_sales = total
        else if (label === 'Net Sales') result.summary.net_sales = total
        else if (label === 'Discounts') result.summary.total_discount = Math.abs(total)
        else if (label === 'Taxes') result.summary.total_tax = total
        else if (label.startsWith('Service charges')) result.summary.service_charges = total
        else if (label === 'Cost of Goods Sold') section = 'other'
      } else {
        section = 'other'
      }
      continue
    }

    switch (section) {
      case 'payment':
        if (indent === 1) result.summary[paymentColumn(label)] += total
        break
      case 'txn':
        if (indent === 1 && label === 'No. of Transactions') result.summary.total_orders = Math.round(total)
        break
      case 'channel':
        if (indent === 1) channel = label.toLowerCase()
        else if (label === 'Net Sales') {
          if (channel.startsWith('dine in') || channel.startsWith('walk in')) result.summary.dine_in_amount += total
          else if (channel.startsWith('take away')) result.summary.takeaway_amount += total
          else if (!hasPayments) {
            // Hourly report has no Payment Summary: use channels for delivery apps
            if (channel.includes('swiggy')) result.summary.swiggy_amount += total
            else if (channel.includes('zomato')) result.summary.zomato_amount += total
            else result.summary.other_online_amount += total
          }
        }
        break
      case 'cat':
        if (indent === 1) categoryMap.set(label, { amount: total, quantity: 0 })
        break
      case 'catqty':
        if (indent === 1 && categoryMap.has(label)) categoryMap.get(label)!.quantity = Math.round(total)
        break
    }
  }

  for (const k of Object.keys(result.summary) as (keyof SalesSummary)[]) {
    result.summary[k] = round2(result.summary[k])
  }

  result.categories = Array.from(categoryMap.entries())
    .filter(([, v]) => v.amount !== 0 || v.quantity !== 0)
    .map(([category_name, v]) => ({ category_name, ...v }))

  if (result.dates.length === 1) result.date = result.dates[0]
  else if (result.dates.length > 1) {
    result.warnings.push(`This report covers ${result.dates.length} days (${result.dates[0]} to ${result.dates[result.dates.length - 1]}). Please download a single-day Sales Summary.`)
  }
  if (!hasPayments) {
    result.warnings.push('This report has no cash / UPI / card split. Please download "Sales Summary", not "Sales Summary by Hour".')
  }
  if (!result.summary.net_sales && !result.summary.gross_sales) {
    result.warnings.push('No sales figures were found in this file.')
  }

  return result
}
