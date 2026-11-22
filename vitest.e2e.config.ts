import { defineConfig } from 'vitest/config'

// The browser tests (e2e/): a built package, a real browser, one file at a time.
export default defineConfig({
  test: {
    include: ['e2e/**/*.e2e.test.ts'],
    fileParallelism: false,
    hookTimeout: 180_000,
    testTimeout: 120_000,
  },
})
