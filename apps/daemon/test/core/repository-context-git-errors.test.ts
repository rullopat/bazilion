import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test, vi } from 'vitest'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'

const mocked = vi.hoisted(() => ({
  code: 'ENOENT',
  calls: 0,
  options: [] as Array<{ timeout: number; maxBuffer: number }>,
}))
vi.mock('node:child_process', () => ({
  execFile: (
    _file: string,
    args: string[],
    options: { timeout: number; maxBuffer: number },
    callback: (error: Error | null, stdout: string) => void,
  ) => {
    mocked.calls++
    mocked.options.push(options)
    if (mocked.code !== 'ENOENT' && args[0] === 'config') callback(null, '')
    else
      callback(
        Object.assign(new Error('OS failure includes /private/path SECRET_SENTINEL'), {
          code: mocked.code,
        }),
        '',
      )
  },
}))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  mocked.calls = 0
  mocked.options = []
})

test.each([
  ['ENOENT', 'git_missing'],
  ['ETIMEDOUT', 'git_timeout'],
  ['ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'git_output_limit'],
])('Git failure %s is bounded and cannot invalidate complete instructions or expose diagnostics', async (code, expected) => {
  mocked.code = code
  const root = mkdtempSync(join(tmpdir(), 'context-git-failure-'))
  roots.push(root)
  mkdirSync(join(root, '.git'))
  writeFileSync(join(root, '.git', 'config'), '[core]\nbare = false\n')
  writeFileSync(join(root, 'AGENTS.md'), 'Valid repository instructions')
  const report = await resolveRepositoryContext({ teamId: 'fixture', root })
  expect(report.instructions.state).toBe('complete')
  expect(report.git.state).toBe('unavailable')
  expect(report.git.issues[0]?.code).toBe(expected)
  expect(JSON.stringify(report)).not.toContain('SECRET_SENTINEL')
  expect(
    mocked.options.every(
      (options) =>
        options.timeout > 0 && options.timeout <= 5000 && options.maxBuffer === 1024 * 1024,
    ),
  ).toBe(true)
})
