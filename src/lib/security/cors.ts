import { NextRequest, NextResponse } from 'next/server';

/**
 * Determine whether a given request origin is trusted.
 */
export function isAllowedOrigin(request: NextRequest): boolean {
  const origin = request.headers.get('origin');
  if (!origin) {
    // Non-browser or same-origin direct requests may not include Origin
    return true;
  }

  const host = request.headers.get('host');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const effectiveHost = forwardedHost || host;

  try {
    const originUrl = new URL(origin);

    // Allow localhost during development or testing
    if (originUrl.hostname === 'localhost' || originUrl.hostname === '127.0.0.1') {
      return true;
    }

    // Match request's current host
    if (effectiveHost && originUrl.host === effectiveHost) {
      return true;
    }

    // Allow configured app URL if present
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL;
    if (appUrl) {
      const cleanAppUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
      const appHost = new URL(cleanAppUrl).host;
      if (originUrl.host === appHost) return true;
    }
  } catch {
    return false;
  }

  return false;
}

/**
 * Generate standard security and CORS headers for responses.
 */
export function getCorsHeaders(request: NextRequest): Record<string, string> {
  const origin = request.headers.get('origin');
  const allowed = isAllowedOrigin(request);

  const headers: Record<string, string> = {
    'Vary': 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Requested-With',
    'Access-Control-Max-Age': '86400',
  };

  if (origin && allowed) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Credentials'] = 'true';
  }

  return headers;
}

/**
 * Handle OPTIONS preflight requests for API endpoints.
 */
export function handleCorsPreflight(request: NextRequest): NextResponse {
  return new NextResponse(null, {
    status: 204,
    headers: getCorsHeaders(request),
  });
}
