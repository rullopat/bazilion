import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    // Every test file gets a throwaway BAZILION_HOME under one scratch root per run.
    globalSetup: ['./vitest.global-setup.ts'],
    setupFiles: ['./vitest.setup.ts'],
    // CLI integration tests boot a real daemon and chain several CLI subprocesses.
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
})
