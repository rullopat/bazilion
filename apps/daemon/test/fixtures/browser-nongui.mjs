// Actual macOS non-GUI qualification fixture. An explicitly authorized disposable-CI bootstrap
// creates ONLY this child's audit session, drops all elevated credentials, then execs a fresh
// ordinary-user Node before tsx/application imports. No product privilege or session API is added.
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') throw new Error('actual macOS is required')
const require = createRequire(import.meta.url)
const ffi = require('koffi')
if (ffi.version !== '3.3.3') throw new Error('unexpected native fixture binding')
const security = ffi.load('/System/Library/Frameworks/Security.framework/Security')
const create = security.func('int32_t SessionCreate(uint32_t, uint32_t)')
const info = security.func('int32_t SessionGetInfo(uint32_t, void *, void *)')
const session = Buffer.alloc(4)
const attributes = Buffer.alloc(4)
const beforeStatus = info(0xffffffff, session, attributes)
console.error(
  `controlled session before create: status=${beforeStatus}, graphicAccess=${Boolean(attributes.readUInt32LE() & 0x10)}, uid=${process.geteuid?.()}`,
)
let [phase, ...args] = process.argv.slice(2)
if (phase === '--create-session') {
  if (process.getuid() !== 0 || process.env.BAZILION_TEST_DISPOSABLE_MACOS !== '1')
    throw new Error(
      'privileged non-GUI bootstrap is restricted to the authorized disposable CI fixture',
    )
  const [uidText, gidText, executablePath, home, accountState] = args
  const uid = Number(uidText)
  const gid = Number(gidText)
  if (
    !Number.isSafeInteger(uid) ||
    uid <= 0 ||
    !Number.isSafeInteger(gid) ||
    gid < 0 ||
    !executablePath ||
    !home ||
    !accountState
  )
    throw new Error('invalid ordinary-user fixture identity or paths')
  ffi.errno(0)
  const status = create(0, 0)
  const errno = ffi.errno()
  if (status !== 0)
    throw new Error(
      `non-GUI child SessionCreate refused (status=${status}, errno=${errno}); no fallback`,
    )
  if (info(0xffffffff, session, attributes) !== 0 || (attributes.readUInt32LE() & 0x10) !== 0)
    throw new Error('fresh child did not establish a non-graphical security session')
  // Bind the newly created audit session to the ordinary test user using the public BSD API.
  // SessionCreate starts with AU_DEFAUDITID; retaining that is not a normal daemon login context.
  const system = ffi.load('/usr/lib/libSystem.B.dylib')
  const setAuditUser = system.func('int setauid(const uint32_t *)')
  const auditUser = Buffer.alloc(4)
  auditUser.writeUInt32LE(uid)
  if (setAuditUser(auditUser) !== 0)
    throw new Error('failed to bind ordinary-user test audit session')
  const securitySessionId = process.env.SECURITYSESSIONID
  if (!securitySessionId || !/^[0-9a-f]+$/i.test(securitySessionId))
    throw new Error('native session creation did not publish its audit identity')
  process.setgroups([])
  process.setgid(gid)
  process.setuid(uid)
  if (
    process.getuid() !== uid ||
    process.geteuid() !== uid ||
    process.getgid() !== gid ||
    process.getegid() !== gid ||
    process.getgroups().some((group) => group !== gid)
  )
    throw new Error('non-GUI fixture failed to irreversibly drop elevated credentials')
  let rootRegainDenied = false
  try {
    process.setuid(0)
  } catch (error) {
    if (error.code !== 'EPERM') throw error
    rootRegainDenied = true
  }
  if (!rootRegainDenied || process.getuid() !== uid || process.geteuid() !== uid)
    throw new Error('non-GUI fixture retained root credentials after privilege drop')
  console.error(
    `controlled non-GUI audit session created; credentials dropped to uid=${uid}, gid=${gid}`,
  )
  process.execve(
    process.execPath,
    [
      process.execPath,
      '--import',
      'tsx/esm',
      process.argv[1],
      '--session-ready',
      executablePath,
      home,
      accountState,
    ],
    {
      PATH: '/usr/bin:/bin:/usr/sbin',
      HOME: home,
      LANG: 'C',
      LC_ALL: 'C',
      BAZILION_TEST_DISPOSABLE_MACOS: '1',
      SECURITYSESSIONID: securitySessionId,
    },
  )
  throw new Error('non-GUI ordinary-user exec unexpectedly returned')
}
if (process.getuid() === 0 || process.geteuid() === 0)
  throw new Error('a browser must never run in the privileged bootstrap')
if (phase !== '--session-ready') {
  // A genuinely non-GUI ordinary-user daemon may use its existing session. A GUI process cannot
  // guess that state or silently change mode when creation/admission is unavailable.
  args = [phase, ...args]
}
if (beforeStatus !== 0 || (attributes.readUInt32LE() & 0x10) !== 0)
  throw new Error('ordinary-user child has not established a non-graphical security session')

const [executablePath, home, accountState] = args
if (!executablePath || !home) throw new Error('missing controlled fixture paths')
if (accountState) {
  if (process.env.BAZILION_TEST_DISPOSABLE_MACOS !== '1')
    throw new Error('test account provisioning was not admitted')
  const { readFileSync, statSync } = await import('node:fs')
  const { spawnSync } = await import('node:child_process')
  const stat = statSync(accountState)
  if (stat.uid !== process.getuid() || (stat.mode & 0o077) !== 0)
    throw new Error('unsafe test-account state permissions')
  const { keychain, password } = JSON.parse(readFileSync(accountState, 'utf8'))
  // Unlock in THIS new audit session after permanent privilege drop. Generated disposable test
  // credentials only; never log the command arguments, password or keychain contents.
  const unlocked = spawnSync('/usr/bin/security', ['unlock-keychain', '-p', password, keychain], {
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024,
  })
  if (unlocked.error || unlocked.status !== 0)
    throw new Error('disposable non-GUI test keychain could not be unlocked')
}
const { probeDarwinGuiSession } = await import('../../src/lib/process/darwin-gui.ts')
const { resolveBrowserMode } = await import('../../src/lib/browser/executable.ts')
const { launchManagedBrowser } = await import('../../src/lib/browser/launch.ts')
const { getSsrfProxy, closeSsrfProxy } = await import('../../src/lib/browser/proxy.ts')
const { resolvePaths } = await import('../../src/core/paths.ts')
const { getDarwinProcessInspector } = await import('../../src/lib/process/darwin.ts')
const availability = probeDarwinGuiSession()
const auto = resolveBrowserMode('auto')
const headed = resolveBrowserMode('headed')
if (availability !== 'unavailable' || auto.mode !== 'headless' || headed.ok)
  throw new Error('non-GUI Quartz/mode evidence did not agree; no synthetic override')
let handle
try {
  handle = await launchManagedBrowser({
    paths: resolvePaths(home),
    agentId: 'nongui-agent',
    teamId: 'nongui-team',
    executablePath,
    headless: true,
    proxyUrl: await getSsrfProxy(),
    deps: { daemonInstanceId: 'controlled-nongui-child' },
  })
  const page = handle.context.pages()[0] ?? (await handle.context.newPage())
  await page.setContent('<title>actual non-GUI managed browser</title><h1>Non-GUI fixture</h1>')
  if ((await page.title()) !== 'actual non-GUI managed browser')
    throw new Error('non-GUI browser failed')
  const screenshot = await page.screenshot()
  if (!screenshot.length) throw new Error('non-GUI screenshot failed')
  await handle.close()
  handle = undefined
  getDarwinProcessInspector().assertReady()
  if (info(0xffffffff, session, attributes) !== 0 || (attributes.readUInt32LE() & 0x10) !== 0)
    throw new Error('non-GUI caller-session evidence changed during browser qualification')
  process.stdout.write(
    JSON.stringify({
      availability,
      mode: auto.mode,
      headedRefused: !headed.ok,
      screenshot: true,
      closed: true,
      graphicAccess: false,
    }) + '\n',
  )
} finally {
  await handle?.close()
  await closeSsrfProxy()
}
