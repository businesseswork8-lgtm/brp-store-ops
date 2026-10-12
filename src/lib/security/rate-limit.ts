/**
 * In-memory sliding window rate limiter for Next.js Route Handlers and Server Actions.
 * Tracks requests per IP address with automatic TTL eviction to prevent memory leaks.
 */

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// Map of IP key -> RateLimitRecord
const rateLimitStore = new Map<string, RateLimitRecord>();

// Periodic cleanup interval (runs every 5 minutes)
let lastCleanup = Date.now();
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

function pruneStaleRecords() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;
  lastCleanup = now;

  for (const [key, record] of rateLimitStore.entries()) {
    if (record.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window */
  limit: number;
  /** Window size in seconds */
  windowSeconds: number;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
  retryAfterSeconds: number;
}

/**
 * Checks and updates rate limit for a given identifier (e.g. IP + endpoint).
 */
export function rateLimit(key: string, config: RateLimitConfig): RateLimitResult {
  pruneStaleRecords();

  const now = Date.now();
  const windowMs = config.windowSeconds * 1000;
  const record = rateLimitStore.get(key);

  if (!record || record.resetAt <= now) {
    const newRecord: RateLimitRecord = {
      count: 1,
      resetAt: now + windowMs,
    };
    rateLimitStore.set(key, newRecord);

    return {
      success: true,
      limit: config.limit,
      remaining: config.limit - 1,
      reset: Math.ceil(newRecord.resetAt / 1000),
      retryAfterSeconds: 0,
    };
  }

  // Record exists and is still in the active window
  record.count += 1;
  const remaining = Math.max(0, config.limit - record.count);
  const success = record.count <= config.limit;
  const retryAfterSeconds = success ? 0 : Math.ceil((record.resetAt - now) / 1000);

  return {
    success,
    limit: config.limit,
    remaining,
    reset: Math.ceil(record.resetAt / 1000),
    retryAfterSeconds,
  };
}

/**
 * Extract client IP safely from request headers.
 */
export function getClientIp(headers: Headers): string {
  // Common proxies / reverse proxies
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }

  const realIp = headers.get('x-real-ip');
  if (realIp) return realIp.trim();

  const cfConnectingIp = headers.get('cf-connecting-ip');
  if (cfConnectingIp) return cfConnectingIp.trim();

  return '127.0.0.1';
}

/**
 * Create rate limit headers to attach to NextResponse.
 */
export function getRateLimitHeaders(result: RateLimitResult): Record<string, string> {
  const headers: Record<string, string> = {
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.reset),
  };

  if (!result.success) {
    headers['Retry-After'] = String(result.retryAfterSeconds);
  }

  return headers;
}
