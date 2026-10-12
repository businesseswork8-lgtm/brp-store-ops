import type { NextConfig } from "next";

const securityHeaders = [
  {
    key: 'X-DNS-Prefetch-Control',
    value: 'on',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY',
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff',
  },
  {
    key: 'Referrer-Policy',
    value: 'strict-origin-when-cross-origin',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), payment=()',
  },
  {
    key: 'X-Permitted-Cross-Domain-Policies',
    value: 'none',
  },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "img-src 'self' data: blob: https:",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  // Turn off server technology fingerprinting
  poweredByHeader: false,

  // Disallow leaking client source maps in production
  productionBrowserSourceMaps: false,

  // Enable React strict mode for invariant safety
  reactStrictMode: true,

  // Inject comprehensive HTTP security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },

  // Old screens that were merged or removed: send old bookmarks to the new place
  async redirects() {
    return [
      { source: '/store/stock-entry', destination: '/store/count', permanent: false },
      { source: '/store/sales-upload', destination: '/store/upload', permanent: false },
      { source: '/store/rista-usage', destination: '/store/upload', permanent: false },
      { source: '/super-admin/variance/:path*', destination: '/super-admin/stock-report', permanent: false },
      { source: '/super-admin/recipes', destination: '/super-admin/items', permanent: false },
    ];
  },
};

export default nextConfig;
