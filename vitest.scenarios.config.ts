import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/scenarios.test.ts'],
    testTimeout: 60000,
    fileParallelism: false,
  },
});
