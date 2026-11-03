import { defineConfig } from 'vitest/config';

import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      cc: path.resolve(__dirname, 'tests/mocks/cc-mock.ts'),
    },
  },
  test: {
    include: ['tests/**/*.spec.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['assets/scripts/core/**/*.ts'],
      exclude: ['assets/scripts/core/types/**'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
