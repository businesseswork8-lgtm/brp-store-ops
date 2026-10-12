/**
 * Environment configuration validator and access layer.
 * Enforces correct types, valid URL formats, and blocks accidental secret exposure.
 */

interface EnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isProduction: boolean;
}

let cachedEnv: EnvConfig | null = null;

export function getClientEnv(): EnvConfig {
  if (cachedEnv) return cachedEnv;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Configuration error: NEXT_PUBLIC_SUPABASE_URL is not set.');
  }

  try {
    const parsed = new URL(supabaseUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('Configuration error: NEXT_PUBLIC_SUPABASE_URL must be a valid HTTP/HTTPS URL.');
    }
  } catch {
    throw new Error('Configuration error: NEXT_PUBLIC_SUPABASE_URL is not a valid URL.');
  }

  if (!supabaseAnonKey || supabaseAnonKey.trim().length === 0) {
    throw new Error('Configuration error: NEXT_PUBLIC_SUPABASE_ANON_KEY is not set.');
  }

  cachedEnv = {
    supabaseUrl: supabaseUrl.trim(),
    supabaseAnonKey: supabaseAnonKey.trim(),
    isProduction: process.env.NODE_ENV === 'production',
  };

  return cachedEnv;
}

/**
 * Server-only helper to safely get the Supabase service role key.
 * Throws a clean, safe exception if missing.
 */
export function getServiceRoleKey(): string {
  if (typeof window !== 'undefined') {
    throw new Error('FATAL: Attempted to access service role key in client environment.');
  }

  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.trim().length === 0) {
    throw new Error('Server configuration error: Required service role key is not configured.');
  }

  return key.trim();
}
