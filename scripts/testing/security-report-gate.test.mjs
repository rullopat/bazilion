// Orchestration tests with a fake pnpm executor: NOT actual security-acceptance evidence.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '../..')
for (const outcome of ['executor_failure', 'validation_failure', 'success']) {
  test(`real gate with fake executor: ${outcome}`, (t) => {
    const directory = mkdtempSync(join(tmpdir(), 'security-gate-fake-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const stub = join(directory, 'pnpm')
    writeFileSync(
      stub,
      `#!${process.execPath}
const fs = require('node:fs')
const path = require('node:path')
const cases = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'security/acceptance-manifest.json'), 'utf8')).cases
const args = process.argv.slice(2)
if (args[0] === '--filter') process.exit(0)
if (args[1] === 'list') {
 console.log(JSON.stringify(cases.map(c => ({file:path.join(process.cwd(),c.file),name:c.test}))))
 process.exit(0)
}
if (args[1] !== 'run') process.exit(99)
const reportPath = args.find(a => a.startsWith('--outputFile=')).slice('--outputFile='.length)
const outcome = process.env.FAKE_SECURITY_OUTCOME
const report = {synthetic:true,success:true,testResults:cases.map((c,i) => {
 const parts = c.test.split(' > ')
 return {name:path.join(process.cwd(),c.file),assertionResults:[{title:parts.pop(),ancestorTitles:parts,status:outcome==='validation_failure'&&i===0?'pending':'passed'}]}
})}
fs.writeFileSync(reportPath,JSON.stringify(report))
process.exit(outcome === 'executor_failure' ? 1 : 0)
`,
      { mode: 0o700 },
    )
    const result = spawnSync(process.execPath, [join(root, 'scripts/security-acceptance.mjs')], {
      cwd: root,
      env: {
        ...process.env,
        PATH: directory,
        TMPDIR: directory,
        FAKE_SECURITY_OUTCOME: outcome,
      },
      encoding: 'utf8',
      timeout: 10000,
    })
    assert.equal(result.error, undefined)
    const retained = readdirSync(directory).filter((name) =>
      name.startsWith('bazilion-security-acceptance-'),
    )
    if (outcome === 'success') {
      assert.equal(result.status, 0, result.stderr)
      assert.deepEqual(retained, [])
      return
    }
    assert.equal(result.status, 1)
    assert.equal(retained.length, 1)
    const reportPath = join(directory, retained[0], 'report.json')
    assert.ok(existsSync(reportPath))
    assert.equal(statSync(dirname(reportPath)).mode & 0o777, 0o700)
    assert.equal(JSON.parse(readFileSync(reportPath, 'utf8')).synthetic, true)
    assert.ok(result.stderr.includes(dirname(reportPath)))
    assert.ok(!result.stdout.includes('security acceptance passed:'))
    assert.match(
      result.stderr,
      outcome === 'executor_failure' ? /exited 1/ : /finished with pending/,
    )
  })
}
