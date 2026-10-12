import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';

export default async function StoreLayout({
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
    .select('role, is_active, store_access, can_edit')
    .eq('id', user.id)
    .single();

  if (!profile || profile.is_active === false) {
    redirect('/login');
  }

  // Store users must have at least one store assigned
  if (profile.role === 'store' && (!profile.store_access || profile.store_access.length === 0)) {
    redirect('/login');
  }

  return <>{children}</>;
}
