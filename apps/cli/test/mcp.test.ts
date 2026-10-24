import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

const entry = fileURLToPath(new URL('../src/index.ts', import.meta.url))
function cli(args: string[]) {
  // SSE must refuse *before* auth/home/client lookup, never probing a configured daemon.
  return spawnSync(process.execPath, ['--import', 'tsx', entry, 'mcp', ...args], {
    encoding: 'utf8',
    env: { ...process.env, BAZILION_SERVER: 'http://127.0.0.1:1', BAZILION_TOKEN: 'synthetic' },
    timeout: 10_000,
  })
}
test('MCP CLI rejects retired SSE before any daemon request', () => {
  const result = cli([
    'add',
    'legacy',
    '--transport',
    'sse',
    '--url',
    'https://example.invalid/sse',
  ])
  expect(result.status).not.toBe(0)
  expect(result.stdout + result.stderr).toContain('legacy SSE is unsupported')
  expect(result.stdout + result.stderr).not.toContain('fetch failed')
})
test('MCP CLI help advertises only stdio and Streamable HTTP', () => {
  const result = cli(['add', '--help'])
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Streamable HTTP')
  expect(result.stdout).toContain('Linux / Apple Silicon macOS')
  expect(result.stdout).not.toContain('Linux only')
  expect(result.stdout).not.toContain('http | sse')
  expect(result.stdout).not.toContain('http/sse')
})
