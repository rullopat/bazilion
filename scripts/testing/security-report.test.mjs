import assert from 'node:assert/strict'
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
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { withSecurityReport } from './security-report.mjs'

function fixture(t) {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'security-report-test-'))
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }))
  const messages = []
  return { temporaryRoot, reportFailure: (message) => messages.push(message), messages }
}

test('only successful execution and validation remove the private report directory', (t) => {
  const options = fixture(t)
  const result = withSecurityReport((path) => {
    assert.equal(statSync(dirname(path)).mode & 0o777, 0o700)
    writeFileSync(path, '{"success":true}')
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).success, true)
    return 'validated'
  }, options)
  assert.equal(result, 'validated')
  assert.deepEqual(readdirSync(options.temporaryRoot), [])
  assert.deepEqual(options.messages, [])
})

test('nonzero executor failure preserves exact partial report bytes and the original error', (t) => {
  const options = fixture(t)
  const error = new Error('Vitest exited 1')
  let path
  assert.throws(
    () =>
      withSecurityReport((reportPath) => {
        path = reportPath
        writeFileSync(path, '{"failure":"original"}')
        throw error
      }, options),
    (actual) => actual === error,
  )
  assert.equal(readFileSync(path, 'utf8'), '{"failure":"original"}')
  assert.equal(options.messages.length, 1)
  assert.ok(options.messages[0].includes(dirname(path)))
})

test('failure before any report keeps an honestly named diagnostic directory, not a fake report', (t) => {
  const options = fixture(t)
  let path
  assert.throws(
    () =>
      withSecurityReport((reportPath) => {
        path = reportPath
        throw new Error('spawn failed')
      }, options),
    /spawn failed/,
  )
  assert.ok(existsSync(dirname(path)))
  assert.equal(existsSync(path), false)
})

test('malformed report validation failure retains malformed bytes', (t) => {
  const options = fixture(t)
  let path
  assert.throws(
    () =>
      withSecurityReport((reportPath) => {
        path = reportPath
        writeFileSync(path, '{invalid')
        JSON.parse(readFileSync(path, 'utf8'))
      }, options),
    SyntaxError,
  )
  assert.equal(readFileSync(path, 'utf8'), '{invalid')
})

test('sequential failures cannot overwrite earlier reports, even in the same process', (t) => {
  const options = fixture(t)
  const paths = []
  for (const value of ['first', 'second']) {
    assert.throws(
      () =>
        withSecurityReport((path) => {
          paths.push(path)
          writeFileSync(path, value)
          throw new Error(value)
        }, options),
      new RegExp(value),
    )
  }
  assert.notEqual(paths[0], paths[1])
  assert.equal(readFileSync(paths[0], 'utf8'), 'first')
  assert.equal(readFileSync(paths[1], 'utf8'), 'second')
})

test('diagnostic logging failure cannot mask the original failure', (t) => {
  const options = fixture(t)
  const original = new Error('original')
  let path
  assert.throws(
    () =>
      withSecurityReport(
        (reportPath) => {
          path = reportPath
          throw original
        },
        {
          ...options,
          reportFailure: () => {
            throw new Error('logger failed')
          },
        },
      ),
    (error) => error === original,
  )
  assert.ok(existsSync(dirname(path)))
})
