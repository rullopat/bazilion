import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAEMON_PID_FILE } from '../../daemon/src/lib/daemon-liveness.ts'
import type { CliResult } from './helpers.ts'
import { startTestServer } from './server-fixture.ts'

const cliEntry = join(import.meta.dirname, '..', 'src', 'index.ts')

function runUninstall(
  args: string[],
  home: string,
  input?: string,
  env: NodeJS.ProcessEnv = {},
): CliResult {
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', '--no-warnings', cliEntry, 'uninstall', ...args],
    { env: { ...process.env, BAZILION_HOME: home, ...env }, input, encoding: 'utf8' },
  )
  if (result.error) throw result.error
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.status ?? 0 }
}

function exitedProcessId(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  })
  return Number.parseInt(result.stdout, 10)
}

let scratch: string
let home: string
let external: string
beforeEach(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-uninstall-')))
  home = join(scratch, 'home')
  external = join(scratch, 'external-project')
  mkdirSync(home)
  mkdirSync(external)
  writeFileSync(join(external, 'external.txt'), 'keep me')
  for (const file of ['bazilion.db', 'bazilion.db-wal', 'bazilion.db-shm', 'auth.json']) {
    writeFileSync(join(home, file), file)
  }
  for (const dir of ['profiles', 'agents', 'teams', 'browsers', 'skills']) {
    mkdirSync(join(home, dir))
    writeFileSync(join(home, dir, 'managed.txt'), dir)
  }
  // A linked Team is a symlink into the operator's own project.
  symlinkSync(external, join(home, 'teams', 'linked'), 'dir')
  // Left behind by a daemon that crashed: its PID is gone.
  writeFileSync(join(home, DAEMON_PID_FILE), `${exitedProcessId()}\n`)
})
afterEach(() => rmSync(scratch, { recursive: true, force: true }))

describe('uninstall', () => {
  it('reset removes the identity and Agent data, keeps skills and never follows a linked Team', () => {
    const result = runUninstall(['--yes'], home)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(readdirSync(home)).toEqual(['skills'])
    expect(readFileSync(join(home, 'skills', 'managed.txt'), 'utf8')).toBe('skills')
    expect(readFileSync(join(external, 'external.txt'), 'utf8')).toBe('keep me')
    expect(result.stdout).toContain(`reset ${home}; installed skills are kept`)

    // What the reset leaves is still a Bazilion home, so --all can remove it later.
    const all = runUninstall(['--yes', '--all'], home)
    expect(all.exitCode, all.stderr).toBe(0)
    expect(existsSync(home)).toBe(false)
  })

  it('--all removes the Bazilion data and the emptied home, never following a linked Team', () => {
    const result = runUninstall(['--yes', '--all'], home)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(existsSync(home)).toBe(false)
    expect(readFileSync(join(external, 'external.txt'), 'utf8')).toBe('keep me')
    expect(result.stdout).toContain(`removed ${home}`)
  })

  it('--all keeps a home that also holds files Bazilion does not manage', () => {
    writeFileSync(join(home, 'notes.txt'), 'personal notes')
    mkdirSync(join(home, 'logs'))
    const result = runUninstall(['--yes', '--all'], home)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(readdirSync(home).sort()).toEqual(['logs', 'notes.txt'])
    expect(readFileSync(join(home, 'notes.txt'), 'utf8')).toBe('personal notes')
    expect(result.stdout).toContain(`kept ${home}, which also holds logs, notes.txt`)
  })

  it('--all through a symlinked BAZILION_HOME empties its target and keeps the link working', () => {
    const link = join(scratch, 'linked-home')
    symlinkSync(home, link, 'dir')
    const result = runUninstall(['--yes', '--all'], link)
    expect(result.exitCode, result.stderr).toBe(0)
    expect(lstatSync(link).isSymbolicLink()).toBe(true)
    expect(readdirSync(link)).toEqual([])
    expect(result.stdout).toContain(`emptied ${home}`)
  })

  it('asks once and deletes nothing unless the answer is yes', () => {
    for (const input of ['n\n', '', 'later\n']) {
      const declined = runUninstall([], home, input)
      expect(declined.exitCode, declined.stderr).toBe(0)
      expect(declined.stdout).toContain('aborted')
      expect(existsSync(join(home, 'auth.json'))).toBe(true)
    }
    const all = runUninstall(['--all'], home, 'n\n')
    expect(all.stdout).toContain(
      `delete all Bazilion data in ${home}, installed skills included? [y/N]`,
    )

    const confirmed = runUninstall([], home, 'y\n')
    expect(confirmed.exitCode, confirmed.stderr).toBe(0)
    expect(confirmed.stdout).toContain(
      `delete the database, auth.json, profiles, Agents, Teams and browser profiles in ${home}? [y/N]`,
    )
    expect(readdirSync(home)).toEqual(['skills'])
  })

  it('refuses a directory that is not a Bazilion home, even one holding an auth.json', () => {
    const other = join(scratch, 'not-a-home')
    mkdirSync(other)
    writeFileSync(join(other, 'notes.txt'), 'personal files')
    writeFileSync(join(other, 'auth.json'), '{"session":"another tool"}')
    const result = runUninstall(['--yes', '--all', '--home', other], home)
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`${other} is not a Bazilion home`)
    expect(readdirSync(other).sort()).toEqual(['auth.json', 'notes.txt'])
  })

  it('refuses the user home directory, even when it holds a Bazilion database', () => {
    const result = runUninstall(['--yes', '--all'], home, undefined, { HOME: home })
    expect(result.exitCode).not.toBe(0)
    expect(result.stderr).toContain(`refusing to uninstall your home directory ${home}`)
    expect(existsSync(join(home, 'bazilion.db'))).toBe(true)
    expect(existsSync(join(home, 'skills', 'managed.txt'))).toBe(true)
  })

  it('reports a missing home as nothing to remove', () => {
    const result = runUninstall(['--yes'], join(scratch, 'missing'))
    expect(result.exitCode, result.stderr).toBe(0)
    expect(result.stdout).toContain('nothing to remove')
  })

  it('refuses while the daemon runs on the home', async () => {
    const server = await startTestServer({ BAZILION_SCHEDULER: 'off' }, { setupComplete: false })
    try {
      const pid = readFileSync(join(server.home, DAEMON_PID_FILE), 'utf8').trim()
      const result = runUninstall(['--yes', '--all'], server.home)
      expect(result.exitCode).not.toBe(0)
      expect(result.stderr).toContain(`a bazilion daemon (pid ${pid}) is running`)
      expect(existsSync(join(server.home, 'bazilion.db'))).toBe(true)
      expect((await fetch(`${server.url}/api/health`)).ok).toBe(true)
    } finally {
      await server.stop()
    }
  })
})
