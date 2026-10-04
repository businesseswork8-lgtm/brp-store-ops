'use client'

import { useCallback, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export type ActiveStore = { id: string; name: string; code: string; brand_id: string; rista_branch_name?: string | null }
export type MyProfile = { id: string; role: 'store' | 'admin' | 'super_admin'; full_name: string | null; store_access: string[] | null; can_edit?: boolean }

const KEY = 'selectedStore'

/**
 * Single source of truth for "which store am I working on".
 * - Only returns stores the user can actually access (RLS enforces this too).
 * - Reacts when the header store selector changes.
 */
export function useActiveStore() {
  const [supabase] = useState(() => createClient())
  const [profile, setProfile] = useState<MyProfile | null>(null)
  const [stores, setStores] = useState<ActiveStore[]>([])
  const [store, setStore] = useState<ActiveStore | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { setLoading(false); return }

    // Note: falls back gracefully if migration 004 has not been run yet
    let { data: prof, error: profErr } = await supabase.from('profiles').select('id, role, full_name, store_access, can_edit').eq('id', user.id).single()
    if (profErr) ({ data: prof } = await supabase.from('profiles').select('id, role, full_name, store_access').eq('id', user.id).single())
    const withBranch = await supabase.from('stores').select('id, name, code, brand_id, rista_branch_name').eq('is_active', true).order('name')
    let storeRows: unknown[] | null = withBranch.data
    if (withBranch.error) storeRows = (await supabase.from('stores').select('id, name, code, brand_id').eq('is_active', true).order('name')).data

    const p = prof as MyProfile | null
    let list = (storeRows || []) as ActiveStore[]
    if (p?.role === 'store') list = list.filter(s => (p.store_access || []).includes(s.id))

    const saved = typeof window !== 'undefined' ? localStorage.getItem(KEY) : null
    const chosen = list.find(s => s.id === saved) || list[0] || null
    if (chosen && typeof window !== 'undefined') localStorage.setItem(KEY, chosen.id)

    setProfile(p)
    setStores(list)
    setStore(chosen)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    load()
    const onChange = () => load()
    window.addEventListener('storeChange', onChange)
    return () => window.removeEventListener('storeChange', onChange)
  }, [load])

  const selectStore = useCallback((id: string) => {
    localStorage.setItem(KEY, id)
    window.dispatchEvent(new Event('storeChange'))
  }, [])

  return { supabase, profile, stores, store, loading, selectStore, reload: load }
}
