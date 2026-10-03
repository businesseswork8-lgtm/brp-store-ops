import * as XLSX from 'xlsx'

export interface ParsedPOSReport {
  isSummaryReport: boolean
  summary: {
    gross_sales: number
    net_sales: number
    total_discount: number
    total_tax: number
    total_orders: number
    cash_amount: number
    upi_amount: number
    card_amount: number
    swiggy_amount: number
    zomato_amount: number
    other_online_amount: number
  }
  items: Array<{
    item_name: string
    quantity_sold: number
    unit_price: number
    total_price: number
    category?: string
  }>
  categories?: Array<{
    category_name: string
    amount: number
    quantity: number
  }>
}

export function parseRistaPOSFile(fileContent: string | ArrayBuffer): ParsedPOSReport {
  let workbook: XLSX.WorkBook
  
  if (typeof fileContent === 'string') {
    workbook = XLSX.read(fileContent, { type: 'string' })
  } else {
    workbook = XLSX.read(fileContent, { type: 'array' })
  }

  const sheetName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][]

  const result: ParsedPOSReport = {
    isSummaryReport: false,
    summary: {
      gross_sales: 0,
      net_sales: 0,
      total_discount: 0,
      total_tax: 0,
      total_orders: 0,
      cash_amount: 0,
      upi_amount: 0,
      card_amount: 0,
      swiggy_amount: 0,
      zomato_amount: 0,
      other_online_amount: 0,
    },
    items: [],
    categories: [],
  }

  if (!rows || rows.length === 0) return result

  // Check Mode 1: Rista POS "Sales Summary / Sales Summary by Hour" Report
  const firstColTitle = String(rows[1]?.[0] || rows[0]?.[0] || '').trim()
  
  if (firstColTitle === 'Description' || firstColTitle.toLowerCase().includes('branches:')) {
    result.isSummaryReport = true
    let inChannelSection = false
    let inCategorySection = false
    let inCategoryQtySection = false

    const categoryMap = new Map<string, { amount: number; quantity: number }>()

    for (let i = 0; i < rows.length; i++) {
      const desc = String(rows[i]?.[0] || '').trim()
      const totalVal = parseFloat(rows[i]?.[1]) || 0

      if (!desc) continue

      if (desc === 'Channel Summary') {
        inChannelSection = true
        inCategorySection = false
        inCategoryQtySection = false
      } else if (desc === 'Category Summary') {
        inCategorySection = true
        inChannelSection = false
        inCategoryQtySection = false
      } else if (desc.includes('Category Summary (Sale Item Quantity)')) {
        inCategoryQtySection = true
        inCategorySection = false
        inChannelSection = false
      }

      if (!inChannelSection && !inCategorySection && !inCategoryQtySection) {
        if (desc.startsWith('Gross Sales')) {
          result.summary.gross_sales = totalVal
        } else if (desc === 'Net Sales') {
          result.summary.net_sales = totalVal
        } else if (desc === 'Discounts') {
          result.summary.total_discount = Math.abs(totalVal)
        } else if (desc === 'Taxes') {
          result.summary.total_tax = totalVal
        } else if (desc.includes('No. of Transactions')) {
          if (result.summary.total_orders === 0) result.summary.total_orders = Math.round(totalVal)
        }
      } else if (inChannelSection) {
        if (desc.includes('Swiggy')) {
          if (i + 1 < rows.length && String(rows[i+1]?.[0] || '').trim().includes('Net Sales')) {
            result.summary.swiggy_amount = parseFloat(rows[i+1]?.[1]) || 0
          }
        } else if (desc.includes('Zomato')) {
          if (i + 1 < rows.length && String(rows[i+1]?.[0] || '').trim().includes('Net Sales')) {
            result.summary.zomato_amount = parseFloat(rows[i+1]?.[1]) || 0
          }
        } else if (desc.includes('Walk In')) {
          if (i + 1 < rows.length && String(rows[i+1]?.[0] || '').trim().includes('Net Sales')) {
            result.summary.cash_amount = parseFloat(rows[i+1]?.[1]) || 0
          }
        }
      } else if (inCategorySection && desc !== 'Category Summary') {
        categoryMap.set(desc, { amount: totalVal, quantity: 0 })
      } else if (inCategoryQtySection && !desc.includes('Category Summary')) {
        if (categoryMap.has(desc)) {
          categoryMap.get(desc)!.quantity = Math.round(totalVal)
        }
      }
    }

    result.categories = Array.from(categoryMap.entries()).map(([name, data]) => ({
      category_name: name,
      amount: data.amount,
      quantity: data.quantity,
    }))

    return result
  }

  // Check Mode 2: Standard Itemized Sales CSV Report
  const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]

  const itemAliases = ['item name', 'product', 'item', 'item description', 'product name']
  const qtyAliases = ['qty', 'quantity', 'quantity sold', 'qty sold', 'count']
  const amountAliases = ['amount', 'total', 'net amount', 'total amount', 'net sales', 'price']
  const categoryAliases = ['category', 'item category', 'product category']

  for (let i = 0; i < jsonRows.length; i++) {
    const row = jsonRows[i]
    let itemName = ''
    let qty = 0
    let amount = 0
    let category = ''

    const keys = Object.keys(row)
    let hasItem = false

    keys.forEach((key) => {
      const lowerKey = key.toLowerCase().trim()
      const val = row[key]

      if (itemAliases.some((alias) => lowerKey === alias || lowerKey.includes(alias))) {
        itemName = String(val).trim()
        if (itemName) hasItem = true
      } else if (qtyAliases.some((alias) => lowerKey === alias)) {
        qty = parseFloat(String(val)) || 0
      } else if (amountAliases.some((alias) => lowerKey === alias)) {
        amount = parseFloat(String(val)) || 0
      } else if (categoryAliases.some((alias) => lowerKey.includes(alias))) {
        category = String(val).trim()
      }
    })

    if (hasItem && itemName && qty > 0) {
      result.items.push({
        item_name: itemName,
        quantity_sold: qty,
        unit_price: amount > 0 && qty > 0 ? Number((amount / qty).toFixed(2)) : 0,
        total_price: amount,
        category: category || undefined,
      })

      result.summary.net_sales += amount
      result.summary.gross_sales += amount
      result.summary.total_orders += 1
    }
  }

  return result
}
