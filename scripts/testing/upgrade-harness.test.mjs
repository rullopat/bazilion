import assert from 'node:assert/strict'
import { once } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import test from 'node:test'
import {
  awaitDaemon,
  CleanupUnconfirmedError,
  cleanRefusal,
  cleanupFixture,
  DEFAULT_MATRIX,
  fixtureEnv,
  healthy,
  ownedChild,
  readFixtureLedger,
  stateManifest,
} from '../migration-upgrade-matrix.mjs'

const refusal = 'Bazilion cannot start because this home uses an incompatible database schema.'

function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'upgrade-harness-test-'))
  const env = fixtureEnv(base, '/usr/bin')
  const children = []
  t.after(async () => {
    await cleanupFixture(base, children)
  })
  return {
    base,
    env,
    launch(code) {
      const owned = ownedChild(
        process.execPath,
        ['-e', code],
        { cwd: base, env },
        { termMs: 50, killMs: 500 },
      )
      children.push(owned)
      return owned
    },
  }
}

async function server(t, status, body) {
  const s = createServer((_request, response) => {
    response.writeHead(status)
    response.end(body)
  })
  s.listen(0, '127.0.0.1')
  await once(s, 'listening')
  t.after(
    () => new Promise((resolve, reject) => s.close((error) => (error ? reject(error) : resolve()))),
  )
  return `http://127.0.0.1:${s.address().port}/api/health`
}

test('import is inert and defaults declare eight prior-schema refusals', () => {
  assert.equal(DEFAULT_MATRIX.length, 8)
  assert.equal(DEFAULT_MATRIX[0].tag, 'v0.22.0')
  assert.ok(DEFAULT_MATRIX.every((entry) => entry.expect === 'refuse'))
})

test('fixture environment never spreads operator credentials/configuration', (t) => {
  const f = fixture(t)
  process.env.SYNTHETIC_HARNESS_SECRET = 'fake-test-secret'
  try {
    const env = fixtureEnv(f.base, '/usr/bin')
    assert.equal(env.SYNTHETIC_HARNESS_SECRET, undefined)
    assert.equal(env.NODE_OPTIONS, undefined)
    assert.equal(env.GITHUB_TOKEN, undefined)
    assert.equal(env.ANTHROPIC_API_KEY, undefined)
    assert.equal(env.HOME, join(f.base, 'runtime-home'))
    assert.equal(env.BAZILION_SCHEDULER, 'off')
    assert.equal(env.BROWSER_ENABLED, 'false')
    assert.equal(env.npm_config_userconfig, '/dev/null')
  } finally {
    delete process.env.SYNTHETIC_HARNESS_SECRET
  }
})

test('already closed real child stops without waiting for a lost close event', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  const owned = f.launch('process.exit(0)')
  const closed = await owned.closed
  assert.equal(closed.code, 0)
  assert.deepEqual(await owned.stop(), closed)
  assert.deepEqual(await owned.stop(), closed)
})

test('spawn failure is observed and never classified as schema refusal', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  const owned = ownedChild(join(f.base, 'not-an-executable'), [], { env: f.env })
  t.after(() => owned.stop())
  const result = await owned.closed
  assert.ok(result.spawnError)
  await assert.rejects(
    awaitDaemon(owned, 'http://127.0.0.1:1/api/health'),
    (error) => !cleanRefusal(error),
  )
})

test('actual startup exit 1 with schema diagnostic is a clean refusal', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  const owned = f.launch(`process.stderr.write(${JSON.stringify(refusal)}); process.exitCode = 1`)
  await assert.rejects(awaitDaemon(owned, 'http://127.0.0.1:1/api/health'), (error) => {
    assert.equal(error.outcome.code, 1)
    assert.equal(error.outcome.signal, null)
    return cleanRefusal(error)
  })
})

test('wrong exit or diagnostic cannot be relabelled clean refusal', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  for (const [code, text] of [
    [0, refusal],
    [2, refusal],
    [1, 'unrelated startup error'],
  ]) {
    const owned = f.launch(
      `process.stderr.write(${JSON.stringify(text)}); process.exitCode = ${code}`,
    )
    await assert.rejects(
      awaitDaemon(owned, 'http://127.0.0.1:1/api/health'),
      (error) => !cleanRefusal(error),
    )
  }
})

test('hanging child that printed a refusal is killed/closed, not accepted as refusal', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  const owned = f.launch(
    `process.on('SIGTERM', () => {}); process.stderr.write(${JSON.stringify(refusal)}); console.log('ready'); setInterval(() => {}, 1000)`,
  )
  await once(owned.child.stdout, 'data')
  await assert.rejects(awaitDaemon(owned, 'http://127.0.0.1:1/api/health', 80), (error) => {
    assert.equal(error.reason, 'timed out')
    assert.equal(error.outcome.forced, true)
    assert.equal(error.outcome.signal, 'SIGKILL')
    assert.equal(cleanRefusal(error), false)
    return true
  })
  assert.ok(owned.outcome())
})

test('health requires HTTP 200 and ok:true; error pages/oversized bodies refuse', async (t) => {
  assert.equal(await healthy(await server(t, 200, '{"ok":true}')), true)
  assert.equal(await healthy(await server(t, 500, '{"ok":true}')), false)
  assert.equal(await healthy(await server(t, 401, '{"ok":true}')), false)
  assert.equal(await healthy(await server(t, 200, '{"ok":false}')), false)
  assert.equal(await healthy(await server(t, 200, 'not json')), false)
  assert.equal(await healthy(await server(t, 200, `${' '.repeat(5000)}{"ok":true}`)), false)
})

test('healthy child is admitted only while its actual close remains unobserved', {
  timeout: 5000,
}, async (t) => {
  const f = fixture(t)
  const owned = f.launch('setInterval(() => {}, 1000)')
  assert.equal(await awaitDaemon(owned, await server(t, 200, '{"ok":true}')), owned)
})

test('state evidence covers DB/auth, nested files and ownership siblings without following links', (t) => {
  const f = fixture(t)
  const state = join(f.base, 'state')
  mkdirSync(join(state, 'home'), { recursive: true })
  writeFileSync(join(state, 'home', 'bazilion.db'), 'fake-db')
  writeFileSync(join(state, 'home', 'auth.json'), 'fake-auth')
  writeFileSync(join(state, '.home-owner'), 'fixture owner')
  const external = join(f.base, 'external')
  writeFileSync(external, 'do not follow')
  symlinkSync(external, join(state, 'home', 'link'))
  const before = stateManifest(state)
  assert.ok(before.some((row) => row.path === '.home-owner'))
  assert.equal(before.find((row) => row.path === join('home', 'link')).link, external)
  assert.equal(before.find((row) => row.path === join('home', 'link')).sha256, undefined)
  writeFileSync(external, 'changed outside fixture state')
  assert.deepEqual(stateManifest(state), before)
  writeFileSync(join(state, 'home', 'auth.json'), 'changed-auth')
  assert.notDeepEqual(stateManifest(state), before)
})

test('fixture ledger inspection preserves actual SQLite and paired auth bytes', (t) => {
  const f = fixture(t)
  const home = join(f.base, 'state')
  mkdirSync(home)
  writeFileSync(join(home, 'auth.json'), 'synthetic auth fixture')
  const db = new DatabaseSync(join(home, 'bazilion.db'))
  db.exec(
    "CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at INTEGER); INSERT INTO schema_migrations VALUES ('0001_init', 1)",
  )
  db.close()
  const before = stateManifest(home)
  assert.deepEqual(
    readFixtureLedger(home).map((row) => row.version),
    ['0001_init'],
  )
  assert.deepEqual(stateManifest(home), before)
})

test('unknown cleanup retains state and still attempts other owned cleanup', async () => {
  const base = mkdtempSync(join(tmpdir(), 'upgrade-harness-retained-'))
  let secondStopped = false
  try {
    // A modelled *negative* effect-boundary test, not process-tree proof.
    await assert.rejects(
      cleanupFixture(base, [
        {
          stop: async () => {
            throw new CleanupUnconfirmedError('unknown')
          },
        },
        {
          stop: async () => {
            secondStopped = true
          },
        },
      ]),
      CleanupUnconfirmedError,
    )
    assert.equal(secondStopped, true)
    assert.equal(existsSync(base), true)
  } finally {
    rmSync(base, { recursive: true })
  }
})

test('fixture deletion waits until every selected owned close settles', async () => {
  const order = []
  let release
  const pending = new Promise((resolve) => {
    release = resolve
  })
  const cleanup = cleanupFixture('fixture-only', [{ stop: () => pending }], () => {
    order.push('removed')
  })
  await Promise.resolve()
  assert.deepEqual(order, [])
  release()
  await cleanup
  assert.deepEqual(order, ['removed'])
})
