import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
