import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { spawnReviewWorker } from '../../src/runtime/worker/spawn.ts'

test('review worker gets a minimal environment and returns its typed proposal batch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-review-worker-test-'))
  const ambientSecrets = {
    TELEGRAM_BOT_TOKEN: 'telegram-secret-sentinel',
    BAZILION_TOKEN: 'bootstrap-secret-sentinel',
    OPENAI_CODEX_OAUTH: 'oauth-refresh-secret-sentinel',
    ANTHROPIC_API_KEY: 'unrelated-provider-secret-sentinel',
    FIRECRAWL_API_KEY: 'unrelated-tool-secret-sentinel',
    // The review's scratch tree is created here, so the test can see it removed.
    TMPDIR: root,
  }
  const priorEnvironment = Object.fromEntries(
    Object.keys(ambientSecrets).map((key) => [key, process.env[key]]),
  )
  Object.assign(process.env, ambientSecrets)
  let proposals: Awaited<ReturnType<typeof spawnReviewWorker>> | undefined
  let scratchEntries: string[] | undefined
  try {
    // The fixture fails the review unless its environment is exactly the minimal one, no daemon
    // credential reached its stdin, its scratch tree exists and the access token is not in argv.
    proposals = await spawnReviewWorker(
      {
        kind: 'restricted_review',
        message: 'digest',
        evidence: [{ sessionId: 'session-a', entryOrdinal: 3 }],
        runtime: {
          providerName: 'openai-codex',
          modelId: 'gpt-5.6-sol',
          reasoningLevel: 'low',
          apiKey: 'review-access-token',
        },
      },
      {
        apiKeyRefreshHost: { refresh: async () => 'refreshed-review-access-token' },
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/review-worker-result-entry.ts', import.meta.url),
        ),
      },
    )
    scratchEntries = readdirSync(root)
  } finally {
    for (const [key, value] of Object.entries(priorEnvironment)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    rmSync(root, { recursive: true, force: true })
  }

  expect(proposals).toEqual([
    {
      scope: 'private',
      text: 'Verify the result before reporting completion.',
      evidenceEntryIds: [{ sessionId: 'session-a', entryOrdinal: 3 }],
    },
  ])
  expect(scratchEntries).toEqual([])
})
