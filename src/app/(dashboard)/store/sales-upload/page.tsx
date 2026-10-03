'use client'

import { useState, useEffect, useRef } from 'react'
import { parseRistaPOSFile, ParsedPOSReport } from '@/lib/services/rista-parser'
import { createClient } from '@/lib/supabase/client'
import styles from './page.module.css'

export default function SalesUploadPage() {
  const [storeId, setStoreId] = useState<string>('')
  const [date, setDate] = useState<string>(new Date().toISOString().split('T')[0])
  const [staffId, setStaffId] = useState<string>('')
  const [staffList, setStaffList] = useState<any[]>([])
  const [report, setReport] = useState<ParsedPOSReport | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  
  const fileInputRef = useRef<HTMLInputElement>(null)
  const supabase = createClient()

  useEffect(() => {
    const stored = localStorage.getItem('brp_selected_store')
    if (stored) {
      setStoreId(stored)
    }
    
    // Fetch staff
    const fetchStaff = async () => {
      const { data } = await supabase.from('profiles').select('id, full_name').eq('role', 'staff')
      if (data) setStaffList(data)
    }
    fetchStaff()
  }, [])

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      try {
        const content = event.target?.result as ArrayBuffer
        const parsed = parseRistaPOSFile(content)
        setReport(parsed)
      } catch (err) {
        console.error('Error parsing file:', err)
        setMessage({ type: 'error', text: 'Failed to parse file. Please ensure it is a valid Excel or CSV.' })
      }
    }
    reader.readAsArrayBuffer(file)
  }

  const handleSubmit = async () => {
    if (!storeId) {
      setMessage({ type: 'error', text: 'No store selected. Please select a store in the dashboard.' })
      return
    }
    if (!report) {
      setMessage({ type: 'error', text: 'Please upload a valid report.' })
      return
    }
    if (!staffId) {
      setMessage({ type: 'error', text: 'Please select a staff member.' })
      return
    }

    setIsLoading(true)
    setMessage({ type: '', text: '' })

    try {
      const { data: summaryData, error: summaryError } = await supabase
        .from('daily_sales_summary')
        .insert({
          store_id: storeId,
          date: date,
          staff_id: staffId,
          gross_sales: report.summary.gross_sales,
          net_sales: report.summary.net_sales,
          total_discount: report.summary.total_discount,
          total_tax: report.summary.total_tax,
          total_orders: report.summary.total_orders,
          cash_amount: report.summary.cash_amount,
          upi_amount: report.summary.upi_amount,
          card_amount: report.summary.card_amount,
          swiggy_amount: report.summary.swiggy_amount,
          zomato_amount: report.summary.zomato_amount,
          other_online_amount: report.summary.other_online_amount
        })
        .select('id')
        .single()

      if (summaryError) throw summaryError

      const summaryId = summaryData.id

      if (report.items.length > 0) {
        const itemsToInsert = report.items.map(item => ({
          summary_id: summaryId,
          item_name: item.item_name,
          quantity_sold: item.quantity_sold,
          unit_price: item.unit_price,
          total_price: item.total_price,
          category: item.category || null
        }))

        const { error: itemsError } = await supabase
          .from('daily_sales_items')
          .insert(itemsToInsert)

        if (itemsError) throw itemsError
      }

      setMessage({ type: 'success', text: 'Sales report uploaded successfully!' })
      setReport(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
    } catch (err: any) {
      console.error('Submit error:', err)
      setMessage({ type: 'error', text: err.message || 'An error occurred while uploading.' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <h1 className={styles.title}>POS Sales Upload</h1>
        <p className={styles.subtitle}>Upload daily sales report from Rista POS</p>
      </header>

      {message.text && (
        <div className={`${styles.alert} ${styles[message.type]}`}>
          {message.text}
        </div>
      )}

      <div className={styles.formSection}>
        <div className={styles.formGroup}>
          <label>Date</label>
          <input 
            type="date" 
            value={date} 
            onChange={(e) => setDate(e.target.value)} 
            className={styles.input}
          />
        </div>

        <div className={styles.formGroup}>
          <label>Staff on Duty</label>
          <select 
            value={staffId} 
            onChange={(e) => setStaffId(e.target.value)}
            className={styles.select}
          >
            <option value="">Select Staff</option>
            {staffList.map(staff => (
              <option key={staff.id} value={staff.id}>{staff.full_name}</option>
            ))}
          </select>
        </div>

        <div className={styles.uploadArea}>
          <label className={styles.uploadLabel}>
            <span className={styles.uploadText}>Drop CSV/Excel file here or click to browse</span>
            <input 
              type="file" 
              accept=".csv, .xlsx, .xls"
              onChange={handleFileUpload}
              ref={fileInputRef}
              className={styles.fileInput}
            />
          </label>
        </div>
      </div>

      {report && (
        <div className={styles.previewSection}>
          <h2 className={styles.sectionTitle}>Preview</h2>
          
          <div className={styles.cardsGrid}>
            <div className={styles.card}>
              <h3>Gross Sales</h3>
              <p>₹{report.summary.gross_sales.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>Net Sales</h3>
              <p>₹{report.summary.net_sales.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>Cash</h3>
              <p>₹{report.summary.cash_amount.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>UPI</h3>
              <p>₹{report.summary.upi_amount.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>Card</h3>
              <p>₹{report.summary.card_amount.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>Swiggy</h3>
              <p>₹{report.summary.swiggy_amount.toFixed(2)}</p>
            </div>
            <div className={styles.card}>
              <h3>Zomato</h3>
              <p>₹{report.summary.zomato_amount.toFixed(2)}</p>
            </div>
          </div>

          <h3 className={styles.tableTitle}>Itemized Sales</h3>
          <div className={styles.tableContainer}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Product Name</th>
                  <th>Category</th>
                  <th>Qty Sold</th>
                  <th>Unit Price</th>
                  <th>Total Revenue</th>
                </tr>
              </thead>
              <tbody>
                {report.items.map((item, i) => (
                  <tr key={i}>
                    <td>{item.item_name}</td>
                    <td>{item.category || '-'}</td>
                    <td>{item.quantity_sold}</td>
                    <td>₹{item.unit_price.toFixed(2)}</td>
                    <td>₹{item.total_price.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <button 
            className={styles.submitBtn}
            onClick={handleSubmit}
            disabled={isLoading}
          >
            {isLoading ? 'Uploading...' : 'Confirm & Upload'}
          </button>
        </div>
      )}
    </div>
  )
}
