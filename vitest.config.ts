import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    passWithNoTests: true,
    // CLI integration tests spawn the daemon as a subprocess per test file.
    // 30s is generous for cold start; if it's slower, we want to see it fail
    // quickly and diagnose the real cause rather than silently stall the suite.
    hookTimeout: 30_000,
    // Some CLI tests chain 10+ subprocess calls (each ~200–400 ms). Vitest's
    // 5s default testTimeout is below the realistic ceiling, so give them the
    // same 30s budget as hooks. Real hangs still show up quickly.
    testTimeout: 30_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        maxForks: 8,
      },
    },
  },
})
