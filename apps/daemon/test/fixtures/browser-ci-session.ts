// Test-only command construction. The product never invokes sudo or creates an audit session.
export function nonGuiFixtureCommand(entry: string, executablePath: string, home: string) {
  const privileged = process.env.BAZILION_TEST_PRIVILEGED_NONGUI === '1'
  if (
    privileged &&
    (process.platform !== 'darwin' ||
      process.arch !== 'arm64' ||
      process.env.GITHUB_ACTIONS !== 'true' ||
      process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
      !process.getuid?.() ||
      process.geteuid?.() !== process.getuid?.() ||
      !process.getgid?.() ||
      process.getegid?.() !== process.getgid?.())
  )
    throw new Error(
      'privileged non-GUI provisioning requires an ordinary-user disposable GitHub-hosted Apple Silicon runner',
    )
  return {
    command: privileged ? '/usr/bin/sudo' : process.execPath,
    args: privileged
      ? [
          '-n',
          '--',
          '/usr/bin/env',
          '-i',
          'PATH=/usr/bin:/bin:/usr/sbin',
          `HOME=${home}`,
          'BAZILION_TEST_DISPOSABLE_MACOS=1',
          process.execPath,
          entry,
          '--create-session',
          String(process.getuid?.()),
          String(process.getgid?.()),
          executablePath,
          home,
        ]
      : ['--import', 'tsx/esm', entry, executablePath, home],
    env: { PATH: '/usr/bin:/bin:/usr/sbin', HOME: home, LANG: 'C', LC_ALL: 'C' },
  }
}
