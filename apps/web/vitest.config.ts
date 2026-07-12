import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Web unit tests run in Node. `server-only` is a Next marker that throws outside
// the RSC bundler, so we stub it; `@/` resolves to the app root like tsconfig.
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./test/stubs/server-only.ts', import.meta.url)),
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['{app,lib,components}/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
