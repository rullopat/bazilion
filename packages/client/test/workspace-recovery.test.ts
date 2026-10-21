import type { WorkspaceRecoveryReport } from '@bazilion/api-types'
import { afterEach, expect, test, vi } from 'vitest'
import {
  createClient,
  WORKSPACE_RECOVERY_OUTCOME_TEXT,
  workspaceRecoveryExplanation,
} from '../src/index.ts'

afterEach(() => vi.unstubAllGlobals())

test('workspace recovery uses Team-bound escaped ids and an empty POST, never cleanup proof', async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const report: WorkspaceRecoveryReport = { teamId: 'team/one', truncated: false, writers: [] }
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return Response.json(init?.method === 'GET' ? report : { outcome: 'not_found', report })
    }),
  )
  const client = createClient({ serverUrl: 'http://daemon.test', token: 'fixture-token' })
  expect(await client.workspaceRecovery('team/one').list()).toEqual(report)
  expect((await client.workspaceRecovery('team/one').attempt('writer/one')).outcome).toBe(
    'not_found',
  )
  expect(calls.map((call) => [call.init?.method, call.url, call.init?.body])).toEqual([
    ['GET', 'http://daemon.test/api/teams/team%2Fone/workspace/recovery', undefined],
    ['POST', 'http://daemon.test/api/teams/team%2Fone/workspace/recovery/writer%2Fone', undefined],
  ])
})

test('shared CLI and web explanations distinguish blocked ownership from recovery', () => {
  expect(workspaceRecoveryExplanation({ writerId: 'w', posture: 'restored' })).toContain(
    'not cleanup authority',
  )
  expect(workspaceRecoveryExplanation({ writerId: 'w', posture: 'active' })).toContain(
    'cannot interrupt',
  )
  expect(workspaceRecoveryExplanation({ writerId: 'w', posture: 'root_changed' })).toContain(
    'No cleanup',
  )
  for (const blocker of [
    'host_commands',
    'worker_cleanup_unconfirmed',
    'resource_records_unavailable',
  ] as const) {
    expect(
      workspaceRecoveryExplanation({ writerId: 'w', posture: 'recovery_required', blocker }),
    ).toContain('stays blocked')
  }
  expect(workspaceRecoveryExplanation({ writerId: 'w', posture: 'recovery_required' })).toContain(
    'until cleanup is confirmed',
  )
  expect(WORKSPACE_RECOVERY_OUTCOME_TEXT.recovered).toContain('Previous work was not retried')
  expect(WORKSPACE_RECOVERY_OUTCOME_TEXT.not_found).toContain('not a cleanup confirmation')
})
