/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The service packages are TS source; let Next transpile them.
  transpilePackages: ['@hr/shared', '@hr/db', '@hr/rules-engine', '@hr/hr', '@hr/rag', '@hr/workflow'],
  serverExternalPackages: ['pdf-parse', 'tesseract.js', 'sharp'],
  experimental: { serverActions: { bodySizeLimit: '5mb' } },
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
