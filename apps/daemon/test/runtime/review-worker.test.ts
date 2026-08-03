import { fileURLToPath } from 'node:url'
import type { ResolvedAgent } from '@bazilion/api-types'
import { expect, test } from 'vitest'
import { spawnReviewWorker } from '../../src/runtime/worker/spawn.ts'

test('review worker returns its typed proposal batch', async () => {
  const proposals = await spawnReviewWorker(
    {
      mode: 'review',
      review: {
        reviewId: 'review-1',
        evidence: [{ sessionId: 'session-a', entryOrdinal: 3 }],
      },
      agent: {} as ResolvedAgent,
      message: 'digest',
      enabledProviders: [],
      turnId: 'review-1',
      bashApprovalMode: 'auto_deny',
    },
    {
      workerEntryPath: fileURLToPath(
        new URL('../fixtures/review-worker-result-entry.ts', import.meta.url),
      ),
    },
  )

  expect(proposals).toEqual([
    {
      scope: 'private',
      text: 'Verify the result before reporting completion.',
      evidenceEntryIds: [{ sessionId: 'session-a', entryOrdinal: 3 }],
    },
  ])
})
