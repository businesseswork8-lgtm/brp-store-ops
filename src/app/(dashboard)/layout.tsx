import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Sidebar } from '@/components/layout/Sidebar';
import { Header } from '@/components/layout/Header';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role, is_active')
    .eq('id', user.id)
    .single();

  if (!profile || profile.is_active === false) {
    redirect('/login');
  }

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
    </div>
  );
}
