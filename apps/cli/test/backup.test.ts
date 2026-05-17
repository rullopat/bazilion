import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest'
import { makeHome, runCli, type TestHome } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
beforeAll(async () => {
  server = await startTestServer()
})
afterAll(() => server.stop())
beforeEach(() => server.reset())

test('backup create downloads a tar.gz with the home contents', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'hello')
  const out = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)

  const res = await server.cli(['backup', 'create', out])
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('done')
  expect(existsSync(out)).toBe(true)
  expect(statSync(out).size).toBeGreaterThan(0)

  rmSync(out, { force: true })
})

test('backup restore extracts the tar.gz into a fresh home', async () => {
  writeFileSync(join(server.home, 'marker.txt'), 'restored-value')
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  // Restore into an empty dir. `runCli` doesn't need a server for this — the
  // restore path is pure-offline — but we pass a valid home so the `--home`
  // flag gets exercised.
  const target: TestHome = { home: join(tmpdir(), `bz-restore-${Date.now()}`), cleanup() {} }
  mkdirSync(target.home, { recursive: true })
  const res = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(res.exitCode).toBe(0)
  expect(res.stdout).toContain('restored to')
  expect(existsSync(join(target.home, 'marker.txt'))).toBe(true)
  expect(readFileSync(join(target.home, 'marker.txt'), 'utf8')).toBe('restored-value')
  expect(existsSync(join(target.home, 'bazilion.db'))).toBe(true)

  rmSync(archive, { force: true })
  rmSync(target.home, { recursive: true, force: true })
})

test('backup restore refuses a non-empty target without --force', async () => {
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  const target = makeHome()
  // `makeHome` returns an empty dir; drop a file so restore sees non-empty.
  writeFileSync(join(target.home, 'stray.txt'), 'do not destroy')
  const res = await runCli(['backup', 'restore', archive, '--home', target.home], target.home)
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr + res.stdout).toMatch(/not empty.*--force/)
  // File still there
  expect(existsSync(join(target.home, 'stray.txt'))).toBe(true)

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup restore --force overwrites a non-empty target', async () => {
  writeFileSync(join(server.home, 'fresh.txt'), 'from-backup')
  const archive = join(tmpdir(), `bz-backup-${Date.now()}.tar.gz`)
  await server.cli(['backup', 'create', archive])

  const target = makeHome()
  writeFileSync(join(target.home, 'stray.txt'), 'old data')
  const res = await runCli(
    ['backup', 'restore', archive, '--home', target.home, '--force'],
    target.home,
  )
  expect(res.exitCode).toBe(0)
  // The stray file is gone, backup content landed
  expect(existsSync(join(target.home, 'stray.txt'))).toBe(false)
  expect(existsSync(join(target.home, 'fresh.txt'))).toBe(true)

  rmSync(archive, { force: true })
  target.cleanup()
})

test('backup restore errors clearly on a missing file', async () => {
  const target = makeHome()
  const res = await runCli(
    ['backup', 'restore', '/definitely/not/a/real/path.tar.gz', '--home', target.home],
    target.home,
  )
  expect(res.exitCode).not.toBe(0)
  expect(res.stderr + res.stdout).toMatch(/backup file not found/)
  target.cleanup()
})
