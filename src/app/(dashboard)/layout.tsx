import React from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', backgroundColor: 'var(--bg-primary, #0a0a0f)' }}>
      <Sidebar />
      <div 
        style={{ 
          flex: 1, 
          marginLeft: 'var(--sidebar-width, 260px)', 
          display: 'flex', 
          flexDirection: 'column',
          transition: 'margin-left 0.3s ease',
          minWidth: 0
        }}
        className="dashboard-main-content"
      >
        <Header />
        <main style={{ padding: '24px', flex: 1, overflowY: 'auto' }} className="dashboard-main-body">
          {children}
        </main>
      </div>
      <style dangerouslySetInnerHTML={{__html: `
        @media (max-width: 768px) {
          .dashboard-main-content {
            margin-left: 0 !important;
          }
          .dashboard-main-body {
            padding: 10px !important;
          }
        }
      `}} />
    </div>
  );
}
