import { afterEach, beforeEach, expect, test } from 'vitest'
import { makeHome, runCli, type TestHome } from './helpers.ts'

let h: TestHome
beforeEach(() => {
  h = makeHome()
})
afterEach(() => h.cleanup())

test('completion bash prints a sourceable function + complete directive', async () => {
  const res = await runCli(['completion', 'bash'], h.home)
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('_bazilion_completion()')
  expect(res.stdout).toContain('complete -F _bazilion_completion bazilion')
  // Top-level subcommands are enumerated
  expect(res.stdout).toContain('"serve')
  expect(res.stdout).toContain('agent')
  expect(res.stdout).toContain('backup')
  expect(res.stdout).toContain('team')
  // Nested subcommand case arm exists
  expect(res.stdout).toContain('"agent")')
  expect(res.stdout).toContain('"agent chat")')
  expect(res.stdout).toContain('"team-template import")')
  expect(res.stdout).toContain('"team policy blocks")')
  // Flag enumeration (at least one known flag)
  expect(res.stdout).toContain('--profile')
})

test('completion zsh wraps bashcompinit around the bash script', async () => {
  const res = await runCli(['completion', 'zsh'], h.home)
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('bashcompinit')
  expect(res.stdout).toContain('_bazilion_completion()')
})

test('completion fish emits subcommand + guard rules', async () => {
  const res = await runCli(['completion', 'fish'], h.home)
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('complete -c bazilion')
  expect(res.stdout).toContain('__fish_use_subcommand')
  expect(res.stdout).toContain('__fish_seen_subcommand_from agent')
})

test('completion rejects an unknown shell', async () => {
  const res = await runCli(['completion', 'tcsh'], h.home)
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr + res.stdout).toMatch(/unsupported shell: tcsh/)
})
