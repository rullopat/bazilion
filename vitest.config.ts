import { defineConfig } from 'vitest/config'

// Linux-only suites retain /proc-pinned Git inspection, Linux process identities,
// or broader coding/scheduling assumptions not qualified by BAZ-057. Portable
// repository-context-capture, observed-child and portable-chat suites run on the
// actual Linux/macOS matrix; never exclude them to hide a portability failure.
// Removing the ordinary-chat safe-read blocker does not qualify every Git,
// container, restricted-worker or scheduled-provider configuration.
const LINUX_ONLY = [
  // Legacy context suites include the Linux-only hardened Git report contract.
  'apps/daemon/test/core/repository-context.test.ts',
  'apps/daemon/test/core/repository-context-git-errors.test.ts',
  'apps/daemon/test/runtime/repository-context.test.ts',
  'apps/cli/test/repository-context.test.ts',
  // Hardened Git capture still requires its descriptor-pinned /proc worktree.
  'apps/daemon/test/core/git-capture.test.ts',
  'apps/daemon/test/core/git-review-changes.test.ts',
  'apps/daemon/test/core/git-review-identity.test.ts',
  'apps/daemon/test/core/git-review-snapshot.test.ts',
  // Broader legacy pipeline suites retain their existing qualification boundary.
  // BAZ-057 adds actual-platform ordinary-turn coverage separately; a new failure
  // must be fixed or explicitly scoped, not hidden by extending this list.
  'apps/cli/test/chat.test.ts',
  'apps/cli/test/team.test.ts',
  'apps/cli/test/trigger.test.ts',
  'apps/cli/test/agent-coding.test.ts',
  'apps/cli/test/image-generation.test.ts',
  'apps/cli/test/image-crash.test.ts',
  'apps/cli/test/agent-coding-handoff.test.ts',
  'apps/daemon/test/lib/scheduler.test.ts',
  // This wrapper selects the Linux-only scheduler fixture above in fresh TZ processes.
  'apps/daemon/test/cron-scheduler-timezone.test.ts',
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
  'apps/daemon/test/routes/communication.test.ts',
  'apps/daemon/test/routes/conversations.test.ts',
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
