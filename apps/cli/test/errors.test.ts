import { afterEach, expect, test, vi } from 'vitest'
import { ApiClientError } from '../src/client.ts'
import { exitCodeForError, explainScanBlock, printError, UsageError } from '../src/errors.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

test('exit codes: 2 invalid (usage or daemon), 3 conflict, 4 not authorized, else 1', () => {
  const failure = (status: number) => new ApiClientError(status, { error: 'nope' })
  expect([400, 422, 409, 401, 403, 404, 500].map((s) => exitCodeForError(failure(s)))).toEqual([
    2, 2, 3, 4, 4, 1, 1,
  ])
  expect(exitCodeForError(new UsageError('specify at least one flag'))).toBe(2)
  expect(exitCodeForError(new Error('local failure'))).toBe(1)
})

test('a daemon error prints its message, with a hint for an authentication failure', () => {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(line))
  printError(new ApiClientError(404, { error: 'agent not found: x' }))
  printError(new ApiClientError(401, { error: 'unauthorized' }))
  expect(lines.slice(0, 3)).toEqual([
    'error: agent not found: x',
    'error: unauthorized',
    '  hint: token mismatch. Check ~/.bazilion/auth.json "token"',
  ])
})

test('the origin hint is for gateway refusals, not for a Team Policy denial', () => {
  const lines: string[] = []
  vi.spyOn(console, 'error').mockImplementation((line: string) => lines.push(line))
  printError(
    new ApiClientError(403, {
      error: 'Team Policy denied this message',
      code: 'communication_denied',
    }),
  )
  expect(lines).toEqual(['error: Team Policy denied this message'])
  printError(new ApiClientError(403, { error: 'origin validation failed' }))
  expect(lines[2]).toContain('BAZILION_SERVER')
})

test('a blocked skill scan becomes one error with its findings and the confirming flag', () => {
  const blocked = new ApiClientError(400, {
    error: 'skill scan blocked attach: helper has findings',
    code: 'skill_scan_blocked',
    findings: [{ severity: 'warning', code: 'shell-download', line: 3, message: 'curl | sh' }],
  })
  expect(() => explainScanBlock('--allow-warnings')(blocked)).toThrow(
    new Error(
      [
        'skill scan blocked attach: helper has findings',
        'scan findings:',
        '  warning: shell-download line 3 - curl | sh',
        '  hint: inspect the skill, then rerun with --allow-warnings to confirm',
      ].join('\n'),
    ),
  )
  const other = new ApiClientError(404, { error: 'agent not found: x' })
  expect(() => explainScanBlock('--force')(other)).toThrow(other)
})
