import type { WorkspaceRecoveryOutcome, WorkspaceRecoveryReport } from '@bazilion/api-types'
import { runCommand } from 'citty'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { teamRecoveryCommand } from '../src/commands/team-recovery.ts'

const api = vi.hoisted(() => ({ list: vi.fn(), attempt: vi.fn() }))
vi.mock('../src/client.ts', () => ({
  createClient: () => ({ workspaceRecovery: () => api }),
}))
const report: WorkspaceRecoveryReport = {
  teamId: 'one',
  truncated: false,
  writers: [{ writerId: 'opaque-writer', posture: 'recovery_required', blocker: 'host_commands' }],
}
const originalExitCode = process.exitCode
beforeEach(() => {
  vi.clearAllMocks()
  process.exitCode = undefined
  api.list.mockResolvedValue(report)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => {
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

test('team recovery list explains the unsupported host-command blocker without attempting cleanup', async () => {
  await runCommand(teamRecoveryCommand, { rawArgs: ['list', 'one'] })
  const output = vi.mocked(console.log).mock.calls.flat().join('\n')
  expect(output).toContain('opaque-writer')
  expect(output).toContain('not supported in this release')
  expect(output).toContain('workspace stays blocked')
  expect(api.attempt).not.toHaveBeenCalled()
})

test('team recovery JSON preserves the canonical report without adding human prose', async () => {
  await runCommand(teamRecoveryCommand, { rawArgs: ['list', 'one', '--json'] })
  expect(JSON.parse(String(vi.mocked(console.log).mock.calls[0]?.[0]))).toEqual(report)
})

test.each<WorkspaceRecoveryOutcome>([
  'recovered',
  'blocked',
  'active',
  'restored',
  'root_changed',
  'not_found',
  'selection_changed',
])('team recovery attempt reports %s and only confirmed recovery exits successfully', async (outcome) => {
  api.attempt.mockResolvedValue({ outcome, report })
  await runCommand(teamRecoveryCommand, { rawArgs: ['attempt', 'one', 'opaque-writer'] })
  expect(api.attempt).toHaveBeenCalledExactlyOnceWith('opaque-writer')
  expect(String(vi.mocked(console.log).mock.calls[0]?.[0])).toMatch(new RegExp(`^${outcome}: `))
  expect(process.exitCode).toBe(outcome === 'recovered' ? undefined : 1)
})
