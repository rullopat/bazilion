// Actual macOS non-GUI qualification fixture. SessionCreate affects ONLY this fresh child and
// its descendants, not the operator's login/session/configuration. No keychain/auth handles or
// application modules are acquired before this public Security.framework call.
import { createRequire } from 'node:module'

if (process.platform !== 'darwin') throw new Error('actual macOS is required')
const require = createRequire(import.meta.url)
const ffi = require('koffi')
if (ffi.version !== '3.3.3') throw new Error('unexpected native fixture binding')
const security = ffi.load('/System/Library/Frameworks/Security.framework/Security')
const create = security.func('int32_t SessionCreate(uint32_t, uint32_t)')
const info = security.func('int32_t SessionGetInfo(uint32_t, void *, void *)')
const status = create(0, 0)
if (status !== 0) throw new Error(`non-GUI child SessionCreate refused (${status}); no fallback`)
const session = Buffer.alloc(4)
const attributes = Buffer.alloc(4)
if (info(0xffffffff, session, attributes) !== 0 || (attributes.readUInt32LE() & 0x10) !== 0)
  throw new Error('fresh child did not establish a non-graphical security session')

const { probeDarwinGuiSession } = await import('../../src/lib/process/darwin-gui.ts')
const { resolveBrowserMode } = await import('../../src/lib/browser/executable.ts')
const { launchManagedBrowser } = await import('../../src/lib/browser/launch.ts')
const { getSsrfProxy, closeSsrfProxy } = await import('../../src/lib/browser/proxy.ts')
const { resolvePaths } = await import('../../src/core/paths.ts')
const { getDarwinProcessInspector } = await import('../../src/lib/process/darwin.ts')
const [executablePath, home] = process.argv.slice(2)
if (!executablePath || !home) throw new Error('missing controlled fixture paths')
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
  // Probe succeeds without importing operator login/keychain data or changing its GUI session.
  getDarwinProcessInspector().assertReady()
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
