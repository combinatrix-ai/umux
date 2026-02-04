import { defineConfig } from 'vitest/config';

// Longer timeouts for CI
const isCI = process.env.CI === 'true';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // Exclude scenario tests from default run - they require specific environment
    exclude: ['tests/scenarios.test.ts', '**/node_modules/**'],
    testTimeout: isCI ? 60000 : 30000,
    // Run test files sequentially to avoid socket/session conflicts
    fileParallelism: false,
  },
});
