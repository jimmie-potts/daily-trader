import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      exclude: ['**/*.d.ts', '**/*.test.ts', '**/dist/**', '**/.next/**', '**/next-env.d.ts'],
      include: ['apps/**/src/**/*.ts', 'packages/**/src/**/*.ts', 'workers/**/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: './coverage',
    },
    environment: 'node',
    include: ['{apps,packages,workers}/**/*.test.ts'],
    passWithNoTests: false,
    restoreMocks: true,
  },
});
