// Consume the genuine, unpublished library tarballs together: no registry,
// lifecycle scripts, workspace links, provider calls or manifest substitution.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { InstallerProcesses } from './installer-process.mjs'

const repo = fileURLToPath(new URL('../../', import.meta.url))
const artifactDir = resolve(process.argv[2] ?? '')
assert.ok(process.argv[2], 'Pass the directory containing all three packed packages')
const version = JSON.parse(readFileSync(join(repo, 'apps/cli/package.json'), 'utf8')).version
const artifacts = ['bazilion', 'bazilion-api-types', 'bazilion-client'].map((name) => {
  const path = join(artifactDir, `${name}-${version}.tgz`)
  assert.ok(existsSync(path), `Missing versioned artifact: ${path}`)
  return { path, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') }
})
const npmCli = [
  join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
].find(existsSync)
assert.ok(npmCli, 'npm entry unavailable; no tool-manager shim fallback')
const root = mkdtempSync(join(tmpdir(), 'bazilion-library-artifacts-'))
const consumer = join(root, 'consumer')
for (const path of [consumer, join(root, 'home'), join(root, 'cache')]) mkdirSync(path)
const rc = join(root, 'npm-user.rc')
const globalRc = join(root, 'npm-global.rc')
writeFileSync(rc, '', { mode: 0o600 })
writeFileSync(globalRc, '', { mode: 0o600 })
const env = {
  PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
  HOME: join(root, 'home'),
  TMPDIR: root,
  npm_config_cache: join(root, 'cache'),
  npm_config_userconfig: rc,
  npm_config_globalconfig: globalRc,
  npm_config_offline: 'true',
  DO_NOT_TRACK: '1',
  CI: '1',
}
const processes = new InstallerProcesses()
let failure
try {
  const run = async (args) => {
    const result = await processes.run(process.execPath, args, { cwd: consumer, env })
    assert.equal(result.code, 0, result.stderr + result.stdout)
    assert.equal(result.signal, null)
    assert.equal(result.spawnError, undefined)
    return result.stdout
  }
  // Supplying both local tarballs satisfies the client's new API-types version
  // without publishing either one or resolving an older registry substitute.
  await run([
    npmCli,
    'install',
    '--offline',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--engine-strict',
    '--prefix',
    consumer,
    artifacts[1].path,
    artifacts[2].path,
  ])
  for (const name of ['api-types', 'client']) {
    const manifest = JSON.parse(
      readFileSync(join(consumer, 'node_modules/@bazilion', name, 'package.json'), 'utf8'),
    )
    assert.equal(manifest.name, `@bazilion/${name}`)
    assert.equal(manifest.version, version)
    assert.equal(manifest.engines?.node, '^26.12.1')
    assert.deepEqual(
      Object.keys(manifest.dependencies ?? {}),
      name === 'client' ? ['@bazilion/api-types'] : [],
    )
  }
  writeFileSync(
    join(consumer, 'runtime.mjs'),
    `
import assert from 'node:assert/strict'
import { PROFILE_FILES } from '@bazilion/api-types'
import { createClient } from '@bazilion/client'
assert.ok(PROFILE_FILES.includes('SOUL.md'))
const client = createClient({ serverUrl: 'http://127.0.0.1:1', token: 'synthetic-no-request' })
assert.equal(typeof client.get, 'function')
`,
  )
  await run(['runtime.mjs'])
  writeFileSync(
    join(consumer, 'consumer.mts'),
    `
import type { HealthReport, PlatformCapabilitiesReport } from '@bazilion/api-types'
import type { BazilionClient } from '@bazilion/client'
declare const client: BazilionClient
const report: Promise<HealthReport> = client.get<HealthReport>('/api/health/details')
void report
export function platform(health: HealthReport): PlatformCapabilitiesReport {
  return health.platformCapabilities
}
`,
  )
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        noEmit: true,
        strict: true,
        skipLibCheck: false,
        module: 'NodeNext',
        target: 'ES2023',
        types: [],
        lib: ['ES2023', 'DOM'],
      },
      files: ['consumer.mts'],
    }),
  )
  await run([join(repo, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'])
} catch (error) {
  failure = error
}
try {
  await processes.closeAll()
} catch (error) {
  console.error(`library fixture retained for unconfirmed cleanup: ${root}`)
  throw failure ? new AggregateError([failure, error], 'library trial and cleanup failed') : error
}
if (failure) {
  console.error(`failed library fixture retained: ${root}`)
  throw failure
}
rmSync(root, { recursive: true })
console.log(
  JSON.stringify({
    kind: 'versioned-library-artifacts',
    version,
    artifacts,
    offlineInstall: true,
    lifecycleScripts: false,
    runtimeImports: true,
    browserOnlyTypes: true,
    ownedClosesSettled: true,
    fixtureRemoved: true,
  }),
)
