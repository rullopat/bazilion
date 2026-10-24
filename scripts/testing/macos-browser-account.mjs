// Operator-authorized, disposable GitHub-hosted macOS test-account provisioning only.
// Never used by the product, an installer, or an operator's ordinary desktop session.
import { spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  appendFileSync,
  chmodSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join, relative, sep } from 'node:path'

function assertDisposableRunner() {
  if (
    process.platform !== 'darwin' ||
    process.arch !== 'arm64' ||
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    process.getuid() === 0 ||
    !process.env.RUNNER_TEMP ||
    !process.env.GITHUB_ENV
  )
    throw new Error(
      'test-account provisioning requires a disposable GitHub-hosted Apple Silicon runner',
    )
}
function security(args, allowFailure = false) {
  const result = spawnSync('/usr/bin/security', args, {
    encoding: 'utf8',
    timeout: 15_000,
    maxBuffer: 64 * 1024,
  })
  // Arguments may contain the generated test password. Never include them or raw command output
  // in errors/logs. There are no personal credentials in this dedicated keychain.
  if (!allowFailure && (result.error || result.status !== 0))
    throw new Error(`test keychain operation failed (${args[0]}, status=${result.status})`)
  return result
}
function quotedPaths(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const path = JSON.parse(line)
      if (typeof path !== 'string' || !isAbsolute(path))
        throw new Error('invalid keychain path observation')
      return path
    })
}
function persist(path, state) {
  writeFileSync(path, JSON.stringify(state), { mode: 0o600 })
  chmodSync(path, 0o600)
}
assertDisposableRunner()
const action = process.argv[2]
if (action === 'setup') {
  const originalList = quotedPaths(security(['list-keychains', '-d', 'user']).stdout)
  const originalDefault = quotedPaths(security(['default-keychain', '-d', 'user']).stdout)
  if (originalDefault.length !== 1)
    throw new Error('expected one original test-account default keychain')
  const dir = mkdtempSync(join(realpathSync(process.env.RUNNER_TEMP), 'bazilion-browser-account-'))
  const statePath = join(dir, 'state.json')
  const keychain = join(dir, 'browser-test.keychain-db')
  const password = randomBytes(32).toString('hex')
  const state = {
    dir,
    keychain,
    password,
    originalList,
    originalDefault: originalDefault[0],
    created: false,
  }
  persist(statePath, state)
  // Export before mutation so the always() cleanup step can restore partial setup too.
  appendFileSync(process.env.GITHUB_ENV, `BAZILION_TEST_MACOS_ACCOUNT_STATE=${statePath}\n`)
  security(['create-keychain', '-p', password, keychain])
  state.created = true
  persist(statePath, state)
  security(['set-keychain-settings', '-lut', '21600', keychain])
  security(['unlock-keychain', '-p', password, keychain])
  security(['list-keychains', '-d', 'user', '-s', keychain])
  security(['default-keychain', '-d', 'user', '-s', keychain])
  console.log(
    'Disposable browser test keychain created, unlocked and selected; no personal keychain used.',
  )
} else if (action === 'cleanup') {
  const statePath = process.env.BAZILION_TEST_MACOS_ACCOUNT_STATE
  if (!statePath) process.exit(0)
  const temp = realpathSync(process.env.RUNNER_TEMP)
  const path = realpathSync(statePath)
  const inside = relative(temp, path)
  if (inside.startsWith(`..${sep}`) || inside === '..' || isAbsolute(inside))
    throw new Error('test keychain state escaped runner temp')
  const state = JSON.parse(readFileSync(path, 'utf8'))
  if (
    join(state.dir, 'state.json') !== path ||
    join(state.dir, 'browser-test.keychain-db') !== state.keychain
  )
    throw new Error('invalid test keychain state')
  security(['list-keychains', '-d', 'user', '-s', ...state.originalList])
  security(['default-keychain', '-d', 'user', '-s', state.originalDefault])
  if (state.created) security(['delete-keychain', state.keychain])
  rmSync(state.dir, { recursive: true })
  console.log(
    'Disposable browser test keychain deleted and original test-account selection restored.',
  )
} else throw new Error('expected setup or cleanup')
