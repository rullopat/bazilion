import { defineConfig } from 'vitest/config'

// Repository-context safe reads pin content ancestry with Linux directory
// descriptors and /proc (apps/daemon/src/lib/repository-context/files.ts) and
// deliberately refuse a weaker fallback off-Linux; the portability story is
// BAZ-057. Coding CONTEXT is therefore Linux-only, and so is every suite that
// drives a coding turn — but plain chat turns run everywhere: the workspace
// claim's identity capture is portable (workspaceIdentity takes the same
// dev/ino identity from a stat off-Linux; only the fd-pinned ancestry window
// is Linux-strong). Keep this list in sync with the platform-support statement
// in README.md — a suite belongs here only if it constructs a
// ContextDirectory or drives the coding pipeline through it.
const LINUX_ONLY = [
  // Safe reads + repository context directly.
  'apps/daemon/test/core/repository-context.test.ts',
  'apps/daemon/test/core/repository-context-git-errors.test.ts',
  'apps/daemon/test/runtime/repository-context.test.ts',
  'apps/cli/test/repository-context.test.ts',
  // These four construct a ContextDirectory in their fixtures.
  'apps/daemon/test/core/git-capture.test.ts',
  'apps/daemon/test/core/git-review-changes.test.ts',
  'apps/daemon/test/core/git-review-identity.test.ts',
  'apps/daemon/test/core/git-review-snapshot.test.ts',
  // The coding pipeline: turns prepare coding context through safe reads, so
  // every suite that drives one (directly or through the daemon HTTP/CLI
  // surface) hits the same Linux-only boundary. List derived from the first
  // macOS/Windows matrix run (BAZ-049); a new suite that fails off-Linux with
  // safe_reads_unavailable belongs here.
  'apps/cli/test/agent-coding.test.ts',
  'apps/cli/test/agent-coding-handoff.test.ts',
  'apps/daemon/test/lib/agent-coding.test.ts',
  'apps/daemon/test/lib/publication-e2e.test.ts',
  'apps/daemon/test/lib/result-delivery.test.ts',
  'apps/daemon/test/lib/review-capability.test.ts',
  'apps/daemon/test/lib/review-capture.test.ts',
  'apps/daemon/test/lib/review-e2e.test.ts',
  'apps/daemon/test/lib/review-export-delivery.test.ts',
  'apps/daemon/test/lib/review-export.test.ts',
  'apps/daemon/test/lib/review-file-link.test.ts',
  'apps/daemon/test/lib/turn-preparation.test.ts',
  'apps/daemon/test/lib/verification-admission.test.ts',
  'apps/daemon/test/lib/verification-capture.test.ts',
  'apps/daemon/test/lib/verification-e2e.test.ts',
  'apps/daemon/test/lib/verification-executor.test.ts',
  'apps/daemon/test/lib/verification-request-capability.test.ts',
  'apps/daemon/test/routes/git-review.test.ts',
  'apps/daemon/test/routes/publications.test.ts',
  'apps/daemon/test/routes/results.test.ts',
  'apps/daemon/test/routes/reviews.test.ts',
  'apps/daemon/test/routes/team-templates.test.ts',
  'apps/daemon/test/routes/verifications.test.ts',
  // Worker/session identity: spawn validates agent dirs against their
  // canonical realpath — the same canonical-path boundary safe reads pin.
  'apps/daemon/test/runtime/worker-runtime.test.ts',
  'apps/daemon/test/runtime/worker-process-identity.test.ts',
  'apps/daemon/test/runtime/worker-api-key-refresh.test.ts',
  'apps/daemon/test/runtime/session-head.test.ts',
  'apps/daemon/test/runtime/protected-session-prompt.test.ts',
  'apps/daemon/test/runtime/review-worker.test.ts',
  'apps/daemon/test/core/workspace-coordination.test.ts',
  // Docker-stubbed, but cwd mapping goes through ContextDirectory (/proc).
  'apps/daemon/test/runtime/shell-docker.test.ts',
  'apps/cli/test/backup-coding-recovery.test.ts',
]

// The qmd memory indexer is not validated on Windows yet: its child process
// fails every operation (each ~14s) and holds the fixture directory past the
// test. Windows memory support is a product follow-up, not a gate dodge.
const NOT_ON_WINDOWS = [
  'apps/daemon/test/runtime/memory-qmd.test.ts',
  'apps/cli/test/memory.test.ts',
]

const exclude = [
  ...(process.platform === 'linux' ? [] : LINUX_ONLY),
  ...(process.platform === 'win32' ? NOT_ON_WINDOWS : []),
]

export default defineConfig({
  test: {
    include: ['apps/*/test/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    exclude,
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
