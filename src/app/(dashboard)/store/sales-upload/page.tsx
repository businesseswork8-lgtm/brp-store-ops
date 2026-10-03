'use client';

import React, { useState, useEffect, useRef } from 'react';
import { parseRistaPOSFile, ParsedPOSReport } from '@/lib/services/rista-parser';
import { createClient } from '@/lib/supabase/client';
import styles from './page.module.css';

type Store = { id: string; name: string; code: string };
type StaffMember = { id: string; name: string };

export default function SalesUploadPage() {
  const supabase = createClient();

  const [stores, setStores] = useState<Store[]>([]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>('');
  const [selectedDate, setSelectedDate] = useState<string>(
    new Date().toISOString().split('T')[0]
  );
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string>('');

  const [report, setReport] = useState<ParsedPOSReport | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchStores();

    const handleStoreChange = () => {
      const stored = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');
      if (stored) setSelectedStoreId(stored);
    };

    window.addEventListener('storeChange', handleStoreChange);
    return () => window.removeEventListener('storeChange', handleStoreChange);
  }, []);

  useEffect(() => {
    if (selectedStoreId) {
      fetchStaff(selectedStoreId);
    }
  }, [selectedStoreId]);

  async function fetchStores() {
    const { data } = await supabase.from('stores').select('id, name, code').order('name');
    if (data && data.length > 0) {
      setStores(data);
      const stored = localStorage.getItem('selectedStore') || localStorage.getItem('brp_selected_store');
      if (stored && data.some(s => s.id === stored)) {
        setSelectedStoreId(stored);
      } else {
        setSelectedStoreId(data[0].id);
        localStorage.setItem('selectedStore', data[0].id);
        localStorage.setItem('brp_selected_store', data[0].id);
      }
    }
  }

  async function fetchStaff(storeId: string) {
    const { data } = await supabase
      .from('staff_members')
      .select('id, name')
      .eq('store_id', storeId)
      .eq('is_active', true);

    if (data && data.length > 0) {
      setStaffMembers(data);
      setSelectedStaffId(data[0].id);
    } else {
      setStaffMembers([]);
      setSelectedStaffId('');
    }
  }

  function handleStoreSelect(e: React.ChangeEvent<HTMLSelectElement>) {
    const val = e.target.value;
    setSelectedStoreId(val);
    localStorage.setItem('selectedStore', val);
    localStorage.setItem('brp_selected_store', val);
    window.dispatchEvent(new Event('storeChange'));
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();

    reader.onload = (event) => {
      try {
        const content = event.target?.result as ArrayBuffer;
        const parsed = parseRistaPOSFile(content);

        setReport(parsed);
        setMessage({ type: 'success', text: `Successfully parsed ${file.name}!` });
      } catch (err: any) {
        console.error('Error parsing file:', err);
        setMessage({
          type: 'error',
          text: 'Failed to parse CSV/Excel file. Ensure it is a valid Rista POS export.',
        });
      }
    };

    reader.readAsArrayBuffer(file);
  };

  const handleSubmit = async () => {
    if (!selectedStoreId) {
      setMessage({ type: 'error', text: 'Please select a store before submitting.' });
      return;
    }

    if (!report) {
      setMessage({ type: 'error', text: 'Please upload a valid Rista POS report file.' });
      return;
    }

    setIsLoading(true);
    setMessage({ type: '', text: '' });

    try {
      // Get current logged-in user profile ID
      const { data: { user } } = await supabase.auth.getUser();
      
      // If user profile is not logged in, fall back to first profile or null
      let profileId = user?.id;
      if (!profileId) {
        const { data: profs } = await supabase.from('profiles').select('id').limit(1);
        if (profs && profs.length > 0) profileId = profs[0].id;
      }

      if (!profileId) {
        throw new Error('User session not found. Please re-login.');
      }

      // Upsert summary data into daily_sales_summary
      const summaryPayload = {
        store_id: selectedStoreId,
        entry_date: selectedDate,
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
        other_online_amount: report.summary.other_online_amount,
        staff_member_id: selectedStaffId || null,
        submitted_by_profile_id: profileId,
      };

      const { data: summaryData, error: summaryErr } = await supabase
        .from('daily_sales_summary')
        .upsert(summaryPayload, { onConflict: 'store_id,entry_date' })
        .select()
        .single();

      if (summaryErr) throw summaryErr;

      // Insert itemized sales items if available in report
      if (report.items.length > 0 && summaryData) {
        // Delete previous items for this summary
        await supabase.from('daily_sales_items').delete().eq('sales_summary_id', summaryData.id);

        const itemsToInsert = report.items.map(i => ({
          sales_summary_id: summaryData.id,
          item_name: i.item_name,
          quantity_sold: i.quantity_sold,
          unit_price: i.unit_price,
          total_price: i.total_price,
          category: i.category || null,
        }));

        const { error: itemsErr } = await supabase.from('daily_sales_items').insert(itemsToInsert);
        if (itemsErr) console.warn('Itemized items insert warning:', itemsErr);
      }

      setMessage({
        type: 'success',
        text: `✅ POS Sales Report for ${selectedDate} uploaded & saved successfully!`,
      });

      // Clear report
      setReport(null);
      setFileName('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (err: any) {
      console.error('Upload Error:', err);
      setMessage({ type: 'error', text: 'Error saving report: ' + (err.message || String(err)) });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <header className={styles.header} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 className={styles.title}>Rista POS Sales Report Upload</h1>
          <p className={styles.subtitle}>
            Upload daily Rista POS CSV export to parse gross sales, channel splits, and itemized sales
          </p>
        </div>
        <a href="/store" style={{ padding: '0.6rem 1.2rem', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', textDecoration: 'none', fontSize: '0.9rem', fontWeight: 500 }}>
          ← Back to Operations
        </a>
      </header>

      {/* Control Bar: Store, Date & Staff Selection */}
      <div className={styles.card} style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'center' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Select Store
            </label>
            <select
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={selectedStoreId}
              onChange={handleStoreSelect}
            >
              {stores.length === 0 ? (
                <option value="">Loading stores...</option>
              ) : (
                stores.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.code})</option>
                ))
              )}
            </select>
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Sales Report Date
            </label>
            <input
              type="date"
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={selectedDate}
              onChange={e => setSelectedDate(e.target.value)}
            />
          </div>

          <div>
            <label style={{ display: 'block', marginBottom: '0.4rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              Submitted By Staff (Optional)
            </label>
            <select
              style={{ width: '100%', padding: '0.75rem', borderRadius: '8px', background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              value={selectedStaffId}
              onChange={e => setSelectedStaffId(e.target.value)}
            >
              <option value="">Store Manager / General Staff</option>
              {staffMembers.map(s => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* File Upload Drop Zone */}
      <div className={styles.card} style={{ marginBottom: '1.5rem', textAlign: 'center', padding: '2.5rem' }}>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept=".csv, .xlsx, .xls"
          style={{ display: 'none' }}
          id="pos-file-upload"
        />

        <label htmlFor="pos-file-upload" style={{ cursor: 'pointer', display: 'block' }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📄</div>
          <h3 style={{ margin: '0 0 0.5rem 0' }}>
            {fileName ? `Selected File: ${fileName}` : 'Click to Browse or Drag Rista POS CSV File'}
          </h3>
          <p style={{ color: 'var(--text-secondary)', margin: 0, fontSize: '0.9rem' }}>
            Supports Rista POS Sales Summary by Hour, Category Summary, and Itemized Sales Export files (.csv, .xlsx)
          </p>
        </label>
      </div>

      {/* Message Banner */}
      {message.text && (
        <div
          className={styles.card}
          style={{
            marginBottom: '1.5rem',
            background: message.type === 'error' ? 'rgba(255,23,68,0.1)' : 'rgba(0,200,83,0.1)',
            borderColor: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
            color: message.type === 'error' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          {message.text}
        </div>
      )}

      {/* Parsed Preview Cards */}
      {report && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <div className={styles.card}>
            <h3 style={{ margin: '0 0 1rem 0', color: 'var(--accent-primary)' }}>
              Parsed POS Report Summary Preview
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Net Sales</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--success)' }}>
                  ₹ {report.summary.net_sales.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Gross Sales</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  ₹ {report.summary.gross_sales.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Discounts</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--warning)' }}>
                  ₹ {report.summary.total_discount.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Taxes</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  ₹ {report.summary.total_tax.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Total Orders</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 700 }}>
                  {report.summary.total_orders}
                </div>
              </div>
            </div>

            {/* Channel Splits */}
            <h4 style={{ margin: '1.5rem 0 0.5rem 0', color: 'var(--text-primary)' }}>Channel Breakdown</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem' }}>
              <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🛵 Swiggy Sales</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fc8019' }}>
                  ₹ {report.summary.swiggy_amount.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🔴 Zomato Sales</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: '#cb202d' }}>
                  ₹ {report.summary.zomato_amount.toLocaleString('en-IN')}
                </div>
              </div>

              <div style={{ padding: '0.75rem', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>🏬 Walk-In / Cash Sales</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--success)' }}>
                  ₹ {report.summary.cash_amount.toLocaleString('en-IN')}
                </div>
              </div>
            </div>
          </div>

          {/* Category Summary Preview */}
          {report.categories && report.categories.length > 0 && (
            <div className={styles.card}>
              <h4 style={{ margin: '0 0 0.75rem 0' }}>Category Breakdown Preview</h4>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)', textAlign: 'left' }}>
                    <th style={{ padding: '0.5rem' }}>Category</th>
                    <th style={{ padding: '0.5rem' }}>Sales Amount</th>
                    <th style={{ padding: '0.5rem' }}>Item Quantity Sold</th>
                  </tr>
                </thead>
                <tbody>
                  {report.categories.map((c, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={{ padding: '0.5rem', fontWeight: 600 }}>{c.category_name}</td>
                      <td style={{ padding: '0.5rem' }}>₹ {c.amount.toLocaleString('en-IN')}</td>
                      <td style={{ padding: '0.5rem' }}>{c.quantity} pcs</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Confirm & Save Button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem' }}>
            <button
              style={{
                padding: '0.85rem 2rem',
                borderRadius: '8px',
                background: 'var(--accent-primary)',
                color: '#fff',
                border: 'none',
                fontWeight: 600,
                fontSize: '1rem',
                cursor: isLoading ? 'not-allowed' : 'pointer',
              }}
              onClick={handleSubmit}
              disabled={isLoading}
            >
              {isLoading ? 'Saving Report...' : '✓ Confirm & Save Sales Report'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
