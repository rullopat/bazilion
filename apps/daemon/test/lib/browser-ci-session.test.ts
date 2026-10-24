import { afterEach, expect, test, vi } from 'vitest'
import { nonGuiFixtureCommand } from '../fixtures/browser-ci-session.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
function authorizedEnvironment() {
  vi.stubEnv('BAZILION_TEST_PRIVILEGED_NONGUI', '1')
  vi.stubEnv('GITHUB_ACTIONS', 'true')
  vi.stubEnv('RUNNER_ENVIRONMENT', 'github-hosted')
  vi.stubGlobal('process', {
    ...process,
    platform: 'darwin',
    arch: 'arm64',
    getuid: () => 501,
    geteuid: () => 501,
    getgid: () => 20,
    getegid: () => 20,
  })
}

test('non-GUI privileged fixture refuses ordinary operator and self-hosted sessions', () => {
  authorizedEnvironment()
  vi.stubEnv('GITHUB_ACTIONS', 'false')
  expect(() => nonGuiFixtureCommand('/fixture.mjs', '/browser', '/controlled/home')).toThrow(
    /disposable GitHub-hosted/,
  )
  vi.stubEnv('GITHUB_ACTIONS', 'true')
  vi.stubEnv('RUNNER_ENVIRONMENT', 'self-hosted')
  expect(() => nonGuiFixtureCommand('/fixture.mjs', '/browser', '/controlled/home')).toThrow(
    /disposable GitHub-hosted/,
  )
})

test('non-GUI privileged fixture refuses the wrong platform, architecture and privileged parent', () => {
  authorizedEnvironment()
  for (const fields of [
    { platform: 'linux' },
    { arch: 'x64' },
    { getuid: () => 0, geteuid: () => 0 },
    { getgid: () => 0, getegid: () => 0 },
    { getgid: () => 20, getegid: () => 0 },
  ]) {
    const original = process
    vi.stubGlobal('process', { ...process, ...fields })
    expect(() => nonGuiFixtureCommand('/fixture.mjs', '/browser', '/controlled/home')).toThrow(
      /ordinary-user disposable/,
    )
    vi.stubGlobal('process', original)
  }
})

test('ordinary non-GUI fixture is unprivileged and carries no ambient credential', () => {
  vi.stubEnv('BAZILION_TEST_PRIVILEGED_NONGUI', '')
  vi.stubEnv('AMBIENT_PROVIDER_KEY', 'never-inherit')
  const invocation = nonGuiFixtureCommand('/fixture.mjs', '/browser', '/controlled/home')
  expect(invocation.command).toBe(process.execPath)
  expect(invocation.args).toEqual([
    '--import',
    'tsx/esm',
    '/fixture.mjs',
    '/browser',
    '/controlled/home',
  ])
  expect(invocation.env).toEqual({
    PATH: '/usr/bin:/bin:/usr/sbin',
    HOME: '/controlled/home',
    LANG: 'C',
    LC_ALL: 'C',
  })
})

test('authorized CI fixture executes no loader or application module before privilege drop', () => {
  authorizedEnvironment()
  const invocation = nonGuiFixtureCommand('/fixture.mjs', '/browser', '/controlled/home')
  expect(invocation.command).toBe('/usr/bin/sudo')
  expect(invocation.args).toEqual([
    '-n',
    '--',
    '/usr/bin/env',
    '-i',
    'PATH=/usr/bin:/bin:/usr/sbin',
    'HOME=/controlled/home',
    'BAZILION_TEST_DISPOSABLE_MACOS=1',
    process.execPath,
    '/fixture.mjs',
    '--create-session',
    '501',
    '20',
    '/browser',
    '/controlled/home',
  ])
  expect(invocation.args).not.toContain('--import')
  expect(Object.keys(invocation.env).sort()).toEqual(['HOME', 'LANG', 'LC_ALL', 'PATH'])
})
