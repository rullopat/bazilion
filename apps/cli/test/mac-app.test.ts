// The Bazilion app on macOS: what `bazilion app install` writes. The builders run everywhere; the
// app itself is built on macOS only, with the system's osacompile and codesign, in a scratch
// folder. The installer's run on a Mac in CI starts the service and opens the app.

import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  appLayout,
  appScript,
  buildApp,
  installedPorts,
  launchAgentPlist,
  madeByBazilion,
  serviceEnvironment,
} from '../src/mac-app.ts'

const scratch = mkdtempSync(join(tmpdir(), 'baz-mac-app-'))
const realAgents = join(userInfo().homedir, 'Library', 'LaunchAgents')
const agentsBefore = existsSync(realAgents) ? readdirSync(realAgents) : []
// Every test runs with a scratch HOME, so nothing lands in the user's own Library.
beforeEach(() => vi.stubEnv('HOME', join(scratch, 'user')))
afterEach(() => vi.unstubAllEnvs())
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true })
  expect(existsSync(realAgents) ? readdirSync(realAgents) : []).toEqual(agentsBefore)
})

test('the default home has the plain service; another home, or HOME, keeps to itself', () => {
  const own = appLayout(join(userInfo().homedir, '.bazilion'))
  expect(own.label).toBe('com.bazilion.dashboard')
  expect(own.customHome).toBe(false)
  const other = appLayout(join(scratch, 'home'), join(scratch, 'Apps'))
  expect(other.label).toMatch(/^com\.bazilion\.dashboard\.[0-9a-f]{10}$/)
  expect(other.customHome).toBe(true)
  expect(other.app).toBe(join(scratch, 'Apps', 'Bazilion.app'))
  expect(appLayout(join(scratch, 'home')).label).toBe(other.label)
  expect(appLayout(join(scratch, 'elsewhere')).label).not.toBe(other.label)

  // A scratch HOME (every test here has one) keeps the service file, the log and the app inside it.
  expect(homedir()).toBe(join(scratch, 'user'))
  const kept = appLayout(join(scratch, 'home'))
  expect(kept.customUserHome).toBe(true)
  expect(kept.plist).toBe(join(scratch, 'user', 'Library', 'LaunchAgents', `${kept.label}.plist`))
  expect(kept.log.startsWith(join(scratch, 'user', 'Library', 'Logs', 'Bazilion'))).toBe(true)
  expect(kept.app).toBe(join(scratch, 'user', 'Applications', 'Bazilion.app'))
  const env = serviceEnvironment(kept)
  expect(env.HOME).toBe(join(scratch, 'user'))
  expect(env.BAZILION_HOME).toBe(kept.home)
  expect(env.PATH?.split(':')[0]).toBe(join(process.execPath, '..'))
})

test('the service runs the dashboard from login on, restarts it when it fails, and says its ports', () => {
  const layout = appLayout(join(scratch, 'home'), join(scratch, 'Apps'))
  const plist = launchAgentPlist({
    label: layout.label,
    command: [
      '/opt/node & co/bin/node',
      '/x/cli.js',
      'dashboard',
      '--no-open',
      '--port',
      '4422',
      '--daemon-port',
      '4421',
    ],
    env: { PATH: '/a:/b', BAZILION_HOME: '/h <1>' },
    log: '/l/x.log',
    workingDirectory: '/w',
  })
  expect(plist).toContain(`<string>${layout.label}</string>`)
  expect(plist).toContain('<string>/opt/node &amp; co/bin/node</string>')
  expect(plist).toContain('<string>/h &lt;1&gt;</string>')
  expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/)
  expect(plist).toMatch(/<key>SuccessfulExit<\/key>\s*<false\/>/)
  mkdirSync(join(layout.plist, '..'), { recursive: true })
  writeFileSync(layout.plist, plist)
  expect(installedPorts(layout)).toEqual({ web: '4422', daemon: '4421' })
  if (process.platform === 'darwin') {
    const lint = spawnSync('/usr/bin/plutil', ['-lint', layout.plist], { encoding: 'utf8' })
    expect(lint.stdout).toContain('OK')
  }
})

test("the app's script quotes paths for the shell and for AppleScript", () => {
  const script = appScript(["/Users/a b/it's/node", '/x/cli.js', 'open'], {
    BAZILION_HOME: '/h "q"',
  })
  expect(script).toContain(
    `do shell script "BAZILION_HOME='/h \\"q\\"' '/Users/a b/it'\\\\''s/node' '/x/cli.js' 'open'"`,
  )
  expect(script).toContain('display dialog message')
})

test.skipIf(process.platform !== 'darwin')(
  'the app is built, sealed for this Mac, and replaced only when Bazilion made it',
  { timeout: 60_000 },
  () => {
    const layout = appLayout(join(scratch, 'home'), join(scratch, 'Built'))
    const script = appScript(['/usr/bin/true'], {})
    buildApp(layout, script)
    expect(madeByBazilion(layout.app)).toBe(true)
    const marker = JSON.parse(
      readFileSync(join(layout.app, 'Contents', 'Resources', 'bazilion-app.json'), 'utf8'),
    )
    expect(marker).toEqual({ label: layout.label, home: layout.home })
    const verify = spawnSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', layout.app], {
      encoding: 'utf8',
    })
    expect(verify.status, verify.stderr).toBe(0)
    const decompiled = spawnSync(
      '/usr/bin/osadecompile',
      [join(layout.app, 'Contents', 'Resources', 'Scripts', 'main.scpt')],
      { encoding: 'utf8' },
    )
    expect(decompiled.stdout).toContain(`do shell script "'/usr/bin/true'"`)
    // Made again over its own app; nothing is left beside it.
    buildApp(layout, script)
    expect(spawnSync('ls', ['-A', layout.applications], { encoding: 'utf8' }).stdout.trim()).toBe(
      'Bazilion.app',
    )

    const stranger = appLayout(join(scratch, 'home'), join(scratch, 'Stranger'))
    mkdirSync(join(stranger.app, 'Contents'), { recursive: true })
    expect(() => buildApp(stranger, script)).toThrow('was not made by Bazilion')
  },
)
