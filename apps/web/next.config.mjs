const isProd = process.env.NODE_ENV === 'production';

/**
 * Baseline security headers applied to every response (the per-request CSP with a
 * nonce is set in middleware). Framing protection is production-only so the local
 * dev preview (which embeds the app cross-origin) keeps working.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ...(isProd
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        { key: 'X-Frame-Options', value: 'DENY' },
      ]
    : []),
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false, // don't advertise Next.js
  // The service packages are TS source; let Next transpile them.
  transpilePackages: ['@hr/shared', '@hr/db', '@hr/rules-engine', '@hr/hr', '@hr/rag', '@hr/workflow', '@hr/notifications'],
  serverExternalPackages: ['pdf-parse', 'tesseract.js', 'sharp'],
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  // The packages use ESM `.js` import specifiers that point at `.ts` sources
  // (resolved natively by tsx/vitest). Teach webpack the same mapping.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
