import { defineConfig } from 'vitest/config'

// Repository-context safe reads pin ancestry with Linux directory descriptors and
// /proc (apps/daemon/src/lib/repository-context/files.ts) and deliberately refuse a
// weaker path-based fallback off-Linux; the portability story is BAZ-057. The suites
// below exercise that boundary, so they only run where the product supports it
// (BAZ-049): macOS/Windows CI exercises everything else. Keep this list in sync with
// the platform-support statement in README.md — a suite belongs here only if it
// constructs a ContextDirectory or drives the coding pipeline through it.
const LINUX_ONLY = [
  'apps/daemon/test/core/repository-context.test.ts',
  'apps/daemon/test/core/git-capture.test.ts',
  'apps/daemon/test/core/git-review-changes.test.ts',
  'apps/daemon/test/core/git-review-identity.test.ts',
  'apps/daemon/test/core/git-review-snapshot.test.ts',
  'apps/cli/test/repository-context.test.ts',
  'apps/cli/test/agent-coding.test.ts',
  'apps/cli/test/agent-coding-handoff.test.ts',
]

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude: process.platform === 'linux' ? [] : LINUX_ONLY,
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
    forks: {
      maxForks: 8,
    },
  },
})
