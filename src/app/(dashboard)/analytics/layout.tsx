import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function AnalyticsLayout({
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

  // Store users are not permitted to view store-wide analytics
  if (profile.role !== 'super_admin' && profile.role !== 'admin') {
    redirect('/store');
  }

  return <>{children}</>;
}
