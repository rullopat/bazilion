import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runInNewContext } from 'node:vm'
import { parseHTML } from 'linkedom'
import { afterEach, expect, test } from 'vitest'
import { OwnedGroupAuthority } from '../../src/lib/browser/group-authority.ts'
import { MANAGED_INIT_SCRIPTS, managedLaunchArgs } from '../../src/lib/browser/guards.ts'
import { CAPTURE_BOUND_BYTES, type DomStats } from '../../src/lib/browser/observation.ts'
import {
  ownsLoopbackListener,
  parseOwnedEndpoint,
  startOwnedBrowser,
} from '../../src/lib/browser/process.ts'
import { probeProcessGroupPresence, probeProcessPresence } from '../../src/lib/browser/profile.ts'

const homes: string[] = []
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})
function input(script = 'process.exit(1)') {
  const slot = mkdtempSync(join(tmpdir(), 'baz069-process-'))
  homes.push(slot)
  const executablePath = join(slot, 'fake-chromium')
  writeFileSync(executablePath, `#!${process.execPath}\n${script}\n`)
  chmodSync(executablePath, 0o700)
  mkdirSync(join(slot, 'home'))
  return {
    executablePath,
    home: join(slot, 'home'),
    profileDir: join(slot, 'user-data'),
    headless: true,
  }
}

test('freshness instrumentation observes existing and newly attached shadow roots', async () => {
  const { window, document } = parseHTML(
    '<html><body><div id="host"></div><div id="late"></div></body></html>',
  )
  const root = document.querySelector('#host')?.attachShadow({ mode: 'open' })
  if (!root) throw new Error('missing fixture root')
  root.innerHTML = '<button aria-label="Preview">Action</button>'
  const script = MANAGED_INIT_SCRIPTS[1]
  if (!script) throw new Error('missing observation instrumentation')
  // LinkeDOM's window proxy forwards defineProperty to the Node global. Keep
  // the nonconfigurable instrumentation on a distinct VM window target.
  const target = {}
  runInNewContext(script, { window: target, document, MutationObserver: window.MutationObserver })
  const instrumentation = (target as { __bazilion_obs: { stats(): DomStats } }).__bazilion_obs
  const first = instrumentation.stats()
  root.querySelector('button')?.setAttribute('aria-label', 'Publish')
  await Promise.resolve()
  const changed = instrumentation.stats()
  expect(changed.generation).toBeGreaterThan(first.generation)
  const late = document.querySelector('#late')?.attachShadow({ mode: 'open' })
  if (!late) throw new Error('missing late fixture root')
  // Root attachment itself produces no light-DOM mutation record. Its first
  // discovery must still invalidate a previously captured observation.
  const discovered = instrumentation.stats()
  expect(discovered.generation).toBeGreaterThan(changed.generation)
  late.innerHTML = '<button>New content</button>'
  await Promise.resolve()
  expect(instrumentation.stats().generation).toBeGreaterThan(discovered.generation)
  const beforeReplacement = instrumentation.stats()
  document.documentElement.replaceWith(document.createElement('html'))
  expect(instrumentation.stats().generation).toBeGreaterThan(beforeReplacement.generation)
  expect(Object.isFrozen(instrumentation)).toBe(true)
  expect(Object.getOwnPropertyDescriptor(target, '__bazilion_obs')?.configurable).toBe(false)
})

test('open shadow content is included in capture preflight size estimates', () => {
  const { window, document } = parseHTML('<html><body><div id="host"></div></body></html>')
  const root = document.querySelector('#host')?.attachShadow({ mode: 'open' })
  if (!root) throw new Error('missing fixture root')
  root.innerHTML = `<p>${'x'.repeat(CAPTURE_BOUND_BYTES + 1)}</p>`
  const script = MANAGED_INIT_SCRIPTS[1]
  if (!script) throw new Error('missing observation instrumentation')
  const target = {}
  runInNewContext(script, { window: target, document, MutationObserver: window.MutationObserver })
  const stats = (target as { __bazilion_obs: { stats(): DomStats } }).__bazilion_obs.stats()
  expect(stats.textChars).toBeGreaterThan(CAPTURE_BOUND_BYTES)
})

test('peer-connection guards remove every constructor alias', () => {
  const window: Record<string, unknown> = {
    RTCPeerConnection: function NativePeerConnection() {},
    webkitRTCPeerConnection: function NativePeerConnection() {},
    mozRTCPeerConnection: function NativePeerConnection() {},
  }
  const script = MANAGED_INIT_SCRIPTS[0]
  if (!script) throw new Error('missing peer-connection guard')
  runInNewContext(script, { window })
  for (const name of Object.keys(window)) {
    expect(window[name]).toBeUndefined()
    expect(Object.getOwnPropertyDescriptor(window, name)?.configurable).toBe(false)
    expect(() => Object.defineProperty(window, name, { value: () => {} })).toThrow()
  }
})

test('group signalling requires a live birth identity and never reacquires reused identifiers', () => {
  let members: Map<number, string> | undefined = new Map([
    [100, 'leader-birth'],
    [101, 'child-birth'],
  ])
  const sent: string[] = []
  const authority = new OwnedGroupAuthority(
    100,
    () => members,
    (_, signal) => {
      sent.push(signal)
    },
  )
  expect(authority.refresh()).toBe(true) // Learn descendants while leader is still owned.
  members = new Map([[101, 'child-birth']]) // Leader exits; same owned child survives.
  authority.signal('SIGTERM')
  expect(sent).toEqual(['SIGTERM'])
  members = undefined // Unknown is not authority.
  authority.signal('SIGKILL')
  expect(sent).toHaveLength(1)
  members = new Map([
    [100, 'different-birth'],
    [101, 'reused-child-pid'],
  ])
  authority.signal('SIGKILL')
  expect(sent).toHaveLength(1)
  // Even a later matching-looking snapshot cannot revive revoked authority.
  members = new Map([[101, 'child-birth']])
  authority.signal('SIGKILL')
  expect(sent).toHaveLength(1)
})

test('an absent initial leader or an observed empty group cannot authorize signalling', () => {
  let members = new Map<number, string>()
  const sent: string[] = []
  const absent = new OwnedGroupAuthority(
    100,
    () => members,
    (_, signal) => {
      sent.push(signal)
    },
  )
  members.set(100, 'new-process')
  absent.signal('SIGKILL')
  const owned = new OwnedGroupAuthority(
    100,
    () => members,
    (_, signal) => {
      sent.push(signal)
    },
  )
  members = new Map()
  owned.signal('SIGTERM')
  members.set(100, 'new-process')
  owned.signal('SIGKILL')
  expect(sent).toEqual([])
})

test.runIf(process.platform === 'linux')(
  'failed cleanup revokes signalling authority before late exit or group reuse',
  { timeout: 10_000 },
  async () => {
    let authority: OwnedGroupAuthority | undefined
    let members = new Map<number, string>()
    const sent: string[] = []
    await expect(
      startOwnedBrowser(input(), () => {}, {
        groupAbsent: () => false, // Exit cannot be established; retain recovery evidence.
        groupAuthority: (pid) => {
          members.set(pid, 'original-birth')
          authority = new OwnedGroupAuthority(
            pid,
            () => members,
            (_, signal) => {
              sent.push(signal)
            },
          )
          return authority
        },
      }),
    ).rejects.toMatchObject({ reasonCode: 'browser_recovery_required' })
    const count = sent.length
    // The cached failed close is not a permanent licence for the daemon exit hook.
    authority!.signal('SIGKILL')
    members = new Map([[authority!.groupId, 'reused-after-late-exit']])
    authority!.signal('SIGKILL')
    expect(sent).toHaveLength(count)
    expect(authority!.refresh()).toBe(false)
  },
)

test('CDP endpoint parsing accepts only the fresh child loopback authority and browser path', () => {
  expect(
    parseOwnedEndpoint(
      'DevTools listening on ws://127.0.0.1:12345/devtools/browser/abc-123',
      12345,
    ),
  ).toBe('ws://127.0.0.1:12345/devtools/browser/abc-123')
  for (const endpoint of [
    'ws://127.0.0.1:12346/devtools/browser/abc',
    'ws://example.com:12345/devtools/browser/abc',
    'ws://127.0.0.1:12345/devtools/page/abc',
    'ws://127.0.0.1:12345/devtools/browser/abc?token=secret',
    'ws://user:pass@127.0.0.1:12345/devtools/browser/abc',
    'http://127.0.0.1:12345/json/version',
    'ws://0.0.0.0:12345/devtools/browser/abc',
  ])
    expect(parseOwnedEndpoint(`DevTools listening on ${endpoint}`, 12345)).toBeNull()
})

test.runIf(process.platform === 'linux')(
  'listener ownership rejects a foreign PID and a wildcard listener',
  async () => {
    for (const host of ['127.0.0.1', '0.0.0.0']) {
      const server = createServer()
      await new Promise<void>((resolve) => server.listen(0, host, resolve))
      try {
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('no fixture address')
        expect(await ownsLoopbackListener(process.pid, address.port)).toBe(host === '127.0.0.1')
        expect(await ownsLoopbackListener(999_999_999, address.port)).toBe(false)
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    }
  },
)

test('direct argv pins persistent profile, loopback CDP and proxy without Playwright launch defaults', () => {
  const opts = { ...input(), headless: false, display: ':0', proxyUrl: 'http://127.0.0.1:43210' }
  const args = managedLaunchArgs(opts, 43211)
  expect(args).toContain('--remote-debugging-port=43211')
  expect(args).toContain(`--user-data-dir=${opts.profileDir}`)
  expect(args).toContain('--proxy-bypass-list=<-loopback>')
  expect(args).toContain('--proxy-server=http://127.0.0.1:43210')
  for (const banned of [
    '--no-sandbox',
    '--remote-debugging-pipe',
    '--enable-automation',
    '--headless=new',
    '--disable-blink-features=AutomationControlled',
  ])
    expect(args).not.toContain(banned)
  expect(
    managedLaunchArgs({ ...opts, display: undefined, waylandDisplay: 'wayland-1' }, 43211),
  ).toContain('--ozone-platform=wayland')
})

test.runIf(process.platform === 'linux')(
  'direct startup failure reaps its owned group',
  async () => {
    let pid = 0
    await expect(
      startOwnedBrowser(input(), (value) => {
        pid = value
      }),
    ).rejects.toMatchObject({ reasonCode: 'browser_start_failed' })
    expect(pid).toBeGreaterThan(0)
    expect(probeProcessPresence(pid)).toBe('absent')
    expect(probeProcessGroupPresence(pid)).toBe('absent')
  },
)

test.runIf(process.platform === 'linux')(
  'startup timeout escalates a TERM-ignoring child to KILL and proves exit',
  { timeout: 10_000 },
  async () => {
    let pid = 0
    const opts = input(
      "process.on('SIGTERM', () => { require('node:fs').writeFileSync(process.env.HOME + '/term-ignored', 'yes') }); setInterval(() => {}, 1000)",
    )
    await expect(
      startOwnedBrowser(
        opts,
        (value) => {
          pid = value
        },
        { startupMs: 1_000 },
      ),
    ).rejects.toMatchObject({ reasonCode: 'browser_start_timeout' })
    expect(existsSync(join(opts.home, 'term-ignored'))).toBe(true)
    expect(probeProcessPresence(pid)).toBe('absent')
    expect(probeProcessGroupPresence(pid)).toBe('absent')
  },
)

test.runIf(process.platform === 'linux')(
  'a child advertising an unowned debugging endpoint is refused and reaped',
  async () => {
    let pid = 0
    const opts = input(`
    const port = process.argv.find(arg => arg.startsWith('--remote-debugging-port=')).split('=')[1];
    process.stderr.write('DevTools listening on ws://127.0.0.1:' + port + '/devtools/browser/forged\\n');
    setInterval(() => {}, 1000);
  `)
    await expect(
      startOwnedBrowser(opts, (value) => {
        pid = value
      }),
    ).rejects.toMatchObject({ reasonCode: 'browser_security_unavailable' })
    expect(probeProcessPresence(pid)).toBe('absent')
  },
)

test.runIf(process.platform === 'linux')(
  'a failed spawn has no listener or owned group to adopt',
  async () => {
    const opts = input()
    await expect(
      startOwnedBrowser({ ...opts, executablePath: join(opts.home, 'missing') }, () => {
        throw new Error('must not claim a PID')
      }),
    ).rejects.toMatchObject({ reasonCode: 'browser_start_failed' })
  },
)
