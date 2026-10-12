import 'server-only'
import { createClient } from '@supabase/supabase-js'

/**
 * Server-only Supabase client with the service-role key.
 * NEVER import this from a client component.
 * Requires SUPABASE_SERVICE_ROLE_KEY in .env.local (no NEXT_PUBLIC_ prefix).
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set on the server')
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
