import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getClientEnv, getServiceRoleKey } from '@/lib/env'

/**
 * Server-only Supabase client with the service-role key.
 * NEVER import this from a client component.
 * Requires SUPABASE_SERVICE_ROLE_KEY in host environment or .env.local (no NEXT_PUBLIC_ prefix).
 */
export function createAdminClient() {
  const { supabaseUrl } = getClientEnv()
  const key = getServiceRoleKey()
  return createClient(supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
