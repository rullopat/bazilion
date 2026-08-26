import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const manifestPath = join(root, 'security', 'acceptance-manifest.json')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))

function fail(message) {
  throw new Error(`security acceptance: ${message}`)
}

if (manifest.version !== 1 || !Array.isArray(manifest.cases) || manifest.cases.length === 0) {
  fail('manifest version 1 with at least one required case is required')
}

const ids = new Set()
const keys = new Set()
for (const item of manifest.cases) {
  if (!item.id || !item.owner || !item.file || !item.test)
    fail('every case needs id/owner/file/test')
  if (ids.has(item.id)) fail(`duplicate case id: ${item.id}`)
  ids.add(item.id)
  const key = `${item.file}\0${item.test}`
  if (keys.has(key)) fail(`duplicate required test: ${item.file} :: ${item.test}`)
  keys.add(key)
}

const files = [...new Set(manifest.cases.map((item) => item.file))].sort()

function run(args, options = {}) {
  const result = spawnSync('pnpm', args, {
    cwd: root,
    env: { ...process.env, BAZILION_SECURITY_ACCEPTANCE: '1', CI: '1' },
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  })
  if (result.error) fail(`${args.join(' ')} could not start: ${result.error.message}`)
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '')
    fail(`${args.join(' ')} exited ${result.status}`)
  }
  return result.stdout
}

console.log(`security acceptance: validating ${manifest.cases.length} required cases`)
run(['--filter', '@bazilion/web', 'build'])

const listed = JSON.parse(run(['vitest', 'list', ...files, '--json'], { capture: true }))
const collected = new Set(listed.map((item) => `${relative(root, item.file)}\0${item.name}`))
for (const item of manifest.cases) {
  if (!collected.has(`${item.file}\0${item.test}`)) {
    fail(`required case was not collected: ${item.id} (${item.file} :: ${item.test})`)
  }
}

const resultPath = join(tmpdir(), `bazilion-security-acceptance-${process.pid}.json`)
try {
  run([
    'vitest',
    'run',
    ...files,
    '--reporter=json',
    `--outputFile=${resultPath}`,
    '--no-file-parallelism',
    '--maxWorkers=1',
  ])
  const report = JSON.parse(readFileSync(resultPath, 'utf8'))
  const outcomes = new Map()
  for (const file of report.testResults ?? []) {
    const path = relative(root, file.name)
    for (const assertion of file.assertionResults ?? []) {
      const name = [...assertion.ancestorTitles, assertion.title].join(' > ')
      outcomes.set(`${path}\0${name}`, assertion.status)
    }
  }
  for (const item of manifest.cases) {
    const status = outcomes.get(`${item.file}\0${item.test}`)
    if (status !== 'passed') fail(`required case ${item.id} finished with ${status ?? 'no result'}`)
  }
  if (!report.success) fail('Vitest report was not successful')
} finally {
  rmSync(resultPath, { force: true })
}

console.log(`security acceptance passed: ${manifest.cases.length} required adversarial cases`)
console.log('live deployment evidence remains separate: bazilion gateway preflight')
