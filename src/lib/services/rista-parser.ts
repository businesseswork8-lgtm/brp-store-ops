import * as XLSX from 'xlsx'

export interface ParsedPOSReport {
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
  const data = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as Record<string, any>[]

  const result: ParsedPOSReport = {
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
  }

  // Define possible header aliases
  const itemAliases = ['item name', 'product', 'item', 'item description']
  const qtyAliases = ['qty', 'quantity', 'quantity sold', 'qty sold']
  const amountAliases = ['amount', 'total', 'net amount', 'total amount', 'net sales']
  const categoryAliases = ['category', 'item category']
  
  // Try to find the header row by looking for item and qty
  for (let i = 0; i < data.length; i++) {
    const row = data[i]
    let itemName = ''
    let qty = 0
    let amount = 0
    let category = ''

    const keys = Object.keys(row)
    let hasItem = false
    
    keys.forEach((key) => {
      const lowerKey = key.toLowerCase().trim()
      const val = row[key]
      
      if (itemAliases.some((alias) => lowerKey.includes(alias))) {
        itemName = String(val).trim()
        hasItem = true
      } else if (qtyAliases.some((alias) => lowerKey === alias)) {
        qty = parseFloat(String(val)) || 0
      } else if (amountAliases.some((alias) => lowerKey === alias)) {
        amount = parseFloat(String(val)) || 0
      } else if (categoryAliases.some((alias) => lowerKey.includes(alias))) {
        category = String(val).trim()
      }
      
      // Attempt to parse payment summaries if they exist in column headers or values
      if (lowerKey.includes('gross') && lowerKey.includes('sales')) {
        result.summary.gross_sales += parseFloat(String(val)) || 0
      }
      if (lowerKey.includes('net') && lowerKey.includes('sales')) {
        result.summary.net_sales += parseFloat(String(val)) || 0
      }
      if (lowerKey.includes('discount')) {
        result.summary.total_discount += parseFloat(String(val)) || 0
      }
      if (lowerKey.includes('tax')) {
        result.summary.total_tax += parseFloat(String(val)) || 0
      }
      if (lowerKey.includes('order') && lowerKey.includes('count')) {
        result.summary.total_orders += parseFloat(String(val)) || 0
      }
      if (lowerKey === 'cash') result.summary.cash_amount += parseFloat(String(val)) || 0
      if (lowerKey === 'upi') result.summary.upi_amount += parseFloat(String(val)) || 0
      if (lowerKey === 'card') result.summary.card_amount += parseFloat(String(val)) || 0
      if (lowerKey === 'swiggy') result.summary.swiggy_amount += parseFloat(String(val)) || 0
      if (lowerKey === 'zomato') result.summary.zomato_amount += parseFloat(String(val)) || 0
      if (lowerKey.includes('other online')) result.summary.other_online_amount += parseFloat(String(val)) || 0
    })

    if (hasItem && itemName && qty > 0) {
      result.items.push({
        item_name: itemName,
        quantity_sold: qty,
        unit_price: amount > 0 && qty > 0 ? Number((amount / qty).toFixed(2)) : 0,
        total_price: amount,
        category: category || undefined,
      })
      
      // If summary is not provided explicitly, sum up from items
      if (result.summary.net_sales === 0) {
        result.summary.net_sales += amount
      }
    }
  }
  
  if (result.summary.gross_sales === 0) {
    result.summary.gross_sales = result.summary.net_sales
  }

  return result
}
