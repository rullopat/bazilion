// Short-lived, ordinary-user native keychain helper. No tool/model interface. It receives its
// closed input only after daemon-owned birth/group admission. All preferences resolve inside the
// managed HOME; the operator's login keychain, preferences and credentials are never opened.
import { lstatSync } from 'node:fs'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'

let phase = 'admission'
let nativeStatus = null
try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64' || process.geteuid() === 0)
    throw new Error('unsupported native keychain helper')
  let input = ''
  for await (const chunk of process.stdin) {
    input += chunk.toString('utf8')
    if (input.length > 16 * 1024) throw new Error('oversized native keychain input')
  }
  const value = JSON.parse(input)
  if (
    !value ||
    Object.keys(value).sort().join(',') !== 'home,password' ||
    typeof value.home !== 'string' ||
    !isAbsolute(value.home) ||
    value.home !== process.env.HOME ||
    typeof value.password !== 'string' ||
    !/^[0-9a-f]{64}$/.test(value.password)
  )
    throw new Error('invalid native keychain input')
  phase = 'binding'
  const require = createRequire(import.meta.url)
  const ffi = require('koffi')
  if (ffi.version !== '3.3.3') throw new Error('unsupported native binding')
  const security = ffi.load('/System/Library/Frameworks/Security.framework/Security')
  const cf = ffi.load('/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation')
  const interaction = security.func('int32_t SecKeychainSetUserInteractionAllowed(uint8_t)')
  const create = security.func(
    'int32_t SecKeychainCreate(const char *, uint32_t, const void *, uint8_t, void *, void *)',
  )
  const open = security.func('int32_t SecKeychainOpen(const char *, void *)')
  const unlock = security.func('int32_t SecKeychainUnlock(void *, uint32_t, const void *, uint8_t)')
  const select = security.func('int32_t SecKeychainSetDefault(void *)')
  const settings = security.func('int32_t SecKeychainSetSettings(void *, const void *)')
  const release = cf.func('void CFRelease(void *)')
  const check = (status) => {
    nativeStatus = status
    if (status !== 0) throw new Error('native keychain operation refused')
  }
  phase = 'interaction'
  check(interaction(0)) // Never display or wait for authentication/keychain UI.
  const path = join(value.home, 'Library', 'Keychains', 'bazilion.keychain-db')
  let exists = false
  try {
    const stat = lstatSync(path)
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.uid !== process.geteuid()
    )
      throw new Error('unsafe native keychain file')
    exists = true
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const password = Buffer.from(value.password, 'utf8')
  const reference = Buffer.alloc(8)
  phase = exists ? 'open' : 'create'
  check(
    exists ? open(path, reference) : create(path, password.length, password, 0, null, reference),
  )
  const keychain = ffi.decode(reference, 'void *')
  if (keychain === null) throw new Error('native keychain reference missing')
  try {
    phase = 'unlock'
    check(unlock(keychain, password.length, password, 1))
    const configuration = Buffer.alloc(12)
    configuration.writeUInt32LE(1) // SEC_KEYCHAIN_SETTINGS_VERS1; no sleep/interval auto-lock.
    phase = 'settings'
    check(settings(keychain, configuration))
    phase = 'default'
    check(select(keychain))
  } finally {
    password.fill(0)
    release(keychain)
  }
  process.stdout.write('{"ok":true}\n')
} catch {
  // Input and native errors can contain private paths or password material. Never print them.
  process.stderr.write(JSON.stringify({ phase, status: nativeStatus }) + '\n')
  process.exitCode = 1
}
