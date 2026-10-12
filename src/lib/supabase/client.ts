import { createBrowserClient } from '@supabase/ssr'
import { getClientEnv } from '@/lib/env'

export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = getClientEnv()
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
