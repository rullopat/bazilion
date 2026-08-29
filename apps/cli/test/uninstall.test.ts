import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, parse } from 'node:path'
import { describe, expect, it } from 'vitest'
import { acquireHomeRestoreLock, daemonLivenessPath } from '../src/daemon-liveness.ts'
import { type CliResult, makeHome, runCli } from './helpers.ts'
import { startTestServer } from './server-fixture.ts'

const cliEntry = join(import.meta.dirname, '..', 'src', 'index.ts')
const interruptedUninstallEntry = join(import.meta.dirname, 'fixtures', 'interrupted-uninstall.ts')
const STRIP_TYPES_ARGS = ['--experimental-strip-types', '--no-warnings']

function runUninstall(args: string[], home: string, input?: string): CliResult {
  const result = spawnSync(process.execPath, [...STRIP_TYPES_ARGS, cliEntry, ...args], {
    env: { ...process.env, BAZILION_HOME: home },
    input,
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.status ?? 0,
  }
}

function exitedProcessId(): number {
  const result = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`PID fixture failed: ${result.stderr}`)
  return Number.parseInt(result.stdout, 10)
}

function writeManagedResetState(home: string): void {
  for (const file of [
    'bazilion.db',
    'bazilion.db-wal',
    'bazilion.db-shm',
    'bazilion.db-journal',
    'auth.json',
    'config.json',
    'secrets.enc',
  ]) {
    writeFileSync(join(home, file), file)
  }
  for (const dir of ['profiles', 'agents', 'teams']) {
    mkdirSync(join(home, dir), { recursive: true })
    writeFileSync(join(home, dir, 'managed.txt'), dir)
  }
}

function writeRetainedState(home: string): void {
  for (const dir of ['logs', 'skills']) {
    mkdirSync(join(home, dir), { recursive: true })
    writeFileSync(join(home, dir, 'retained.txt'), dir)
  }
}

describe('uninstall command', () => {
  it('resets the DB and auth identity together while preserving logs and skills', () => {
    const h = makeHome()
    const externalGroups = mkdtempSync(join(tmpdir(), 'bazilion-legacy-groups-'))
    try {
      writeManagedResetState(h.home)
      writeRetainedState(h.home)
      writeFileSync(join(externalGroups, 'external.txt'), 'keep me')
      symlinkSync(externalGroups, join(h.home, 'groups'), 'dir')

      const result = runUninstall(['uninstall', '--yes'], h.home)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      for (const entry of [
        'bazilion.db',
        'bazilion.db-wal',
        'bazilion.db-shm',
        'bazilion.db-journal',
        'auth.json',
        'config.json',
        'secrets.enc',
        'profiles',
        'agents',
        'teams',
        'groups',
      ]) {
        expect(existsSync(join(h.home, entry)), entry).toBe(false)
      }
      expect(readFileSync(join(h.home, 'logs', 'retained.txt'), 'utf8')).toBe('logs')
      expect(readFileSync(join(h.home, 'skills', 'retained.txt'), 'utf8')).toBe('skills')
      expect(readFileSync(join(externalGroups, 'external.txt'), 'utf8')).toBe('keep me')
      expect(result.stdout).toContain('kept: logs/, skills/')
      expect(result.stdout).toContain('create a fresh DB and matching auth.json')
      expect(result.stdout).not.toContain('kept: auth.json')
    } finally {
      h.cleanup()
      rmSync(externalGroups, { recursive: true, force: true })
    }
  })

  it('full wipe removes a home containing only current and legacy managed paths', () => {
    const h = makeHome()
    const externalGroups = mkdtempSync(join(tmpdir(), 'bazilion-legacy-groups-'))
    try {
      writeManagedResetState(h.home)
      writeRetainedState(h.home)
      writeFileSync(join(h.home, 'config.json'), 'legacy config')
      writeFileSync(join(h.home, 'secrets.enc'), 'legacy secrets')
      writeFileSync(join(externalGroups, 'external.txt'), 'keep me')
      symlinkSync(externalGroups, join(h.home, 'groups'), 'dir')

      const result = runUninstall(['uninstall', '--yes', '--all'], h.home)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(existsSync(h.home)).toBe(false)
      expect(readFileSync(join(externalGroups, 'external.txt'), 'utf8')).toBe('keep me')
      expect(result.stdout).toContain(`removed ${h.home}`)
    } finally {
      h.cleanup()
      rmSync(externalGroups, { recursive: true, force: true })
    }
  })

  it('unlinks a dangling legacy groups slot during a full wipe', () => {
    const h = makeHome()
    try {
      writeManagedResetState(h.home)
      symlinkSync(join(h.home, 'missing-external-groups'), join(h.home, 'groups'), 'dir')

      const result = runUninstall(['uninstall', '--yes', '--all'], h.home)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(existsSync(h.home)).toBe(false)
    } finally {
      h.cleanup()
    }
  })

  it('reports unmanaged files and leaves the home in place', () => {
    const h = makeHome()
    try {
      writeManagedResetState(h.home)
      writeFileSync(join(h.home, 'operator-note.txt'), 'keep me')

      const result = runUninstall(['uninstall', '--yes', '--all'], h.home)

      expect(result.exitCode).toBe(0)
      expect(result.stderr).toBe('')
      expect(readFileSync(join(h.home, 'operator-note.txt'), 'utf8')).toBe('keep me')
      expect(result.stdout).toContain(`${h.home} still has unmanaged files; left in place`)
    } finally {
      h.cleanup()
    }
  })

  it('keeps an empty symlinked home root so canonical ownership remains stable', () => {
    const h = makeHome()
    const alias = `${h.home}-alias`
    try {
      symlinkSync(h.home, alias, 'dir')
      writeManagedResetState(h.home)
      writeRetainedState(h.home)

      const result = runUninstall(['uninstall', '--yes', '--all', '--home', alias], h.home)

      expect(result.exitCode, result.stderr + result.stdout).toBe(0)
      expect(lstatSync(alias).isSymbolicLink()).toBe(true)
      expect(readdirSync(h.home)).toEqual([])
      expect(result.stdout).toContain('symlinked BAZILION_HOME root is now empty')
      expect(existsSync(daemonLivenessPath(alias))).toBe(false)
    } finally {
      rmSync(alias, { force: true })
      h.cleanup()
    }
  })

  it('describes the reset identity boundary in prompts and help', () => {
    const h = makeHome()
    try {
      writeManagedResetState(h.home)
      writeRetainedState(h.home)

      const interactive = runUninstall(['uninstall'], h.home, 'y\nn\n')
      expect(interactive.exitCode).toBe(0)
      expect(interactive.stdout).toContain(
        'remove DB + auth/config + agent / profile / team data? [y/N]',
      )
      expect(interactive.stdout).toContain(
        `also remove logs and skills? (full wipe of ${h.home}) [y/N]`,
      )
      expect(existsSync(join(h.home, 'auth.json'))).toBe(false)
      expect(existsSync(join(h.home, 'logs'))).toBe(true)

      const helpHome = makeHome()
      try {
        const help = runUninstall(['uninstall', '--help'], helpHome.home)
        expect(help.exitCode).toBe(0)
        expect(help.stdout).toContain('reset tier only unless --all is set')
        expect(help.stdout).toContain('Also remove logs and skills')
      } finally {
        helpHome.cleanup()
      }
    } finally {
      h.cleanup()
    }
  })

  it('refuses filesystem root, the user home, the current directory, and aliases to them', () => {
    const h = makeHome()
    const rootAlias = join(h.home, 'root-alias')
    try {
      symlinkSync(parse(process.cwd()).root, rootAlias, 'dir')
      for (const [target, reason] of [
        [parse(process.cwd()).root, 'filesystem root'],
        [homedir(), 'user home directory'],
        [process.cwd(), 'current working directory'],
        [rootAlias, 'filesystem root'],
        [dirname(homedir()), 'an ancestor of the user home directory'],
        [dirname(process.cwd()), 'an ancestor of the current working directory'],
      ] as const) {
        const result = runUninstall(['uninstall', '--yes', '--home', target], h.home)
        expect(result.exitCode, target).not.toBe(0)
        expect(result.stderr + result.stdout, target).toContain(
          `refusing to uninstall from ${reason}`,
        )
      }
    } finally {
      h.cleanup()
    }
  })

  it('fails closed without removing files while the daemon owns the home', async () => {
    const server = await startTestServer({ BAZILION_SCHEDULER: 'off' }, { setupComplete: false })
    try {
      const sentinel = join(server.home, 'keep-while-live.txt')
      writeFileSync(sentinel, 'still here')

      const result = await server.cli(['uninstall', '--yes'])

      expect(result.exitCode).not.toBe(0)
      expect(result.stderr + result.stdout).toMatch(
        /daemon is running.*stop it before uninstalling/s,
      )
      expect(readFileSync(sentinel, 'utf8')).toBe('still here')
      expect(existsSync(join(server.home, 'bazilion.db'))).toBe(true)
      expect(existsSync(join(server.home, 'auth.json'))).toBe(true)
      const health = await fetch(`${server.url}/api/health`)
      expect(health.ok).toBe(true)
    } finally {
      await server.stop()
    }
  })

  it('publishes uninstalling before deletion and excludes every competing owner', async () => {
    const h = makeHome()
    const restoreFixture = mkdtempSync(join(tmpdir(), 'bazilion-live-uninstall-'))
    const archive = join(restoreFixture, 'backup.tar.gz')
    const runtimePath = daemonLivenessPath(h.home)
    writeFileSync(archive, 'not reached: ownership fails before archive validation')
    writeManagedResetState(h.home)
    const lock = await acquireHomeRestoreLock(h.home, 'uninstalling')
    try {
      expect(JSON.parse(readFileSync(runtimePath, 'utf8'))).toMatchObject({
        pid: process.pid,
        owner: 'restore',
        state: 'uninstalling',
      })

      const secondUninstall = runUninstall(['uninstall', '--yes'], h.home)
      expect(secondUninstall.exitCode).not.toBe(0)
      expect(secondUninstall.stderr + secondUninstall.stdout).toMatch(
        /uninstall process.*wait for it to finish before uninstalling/s,
      )

      const attemptedRestore = await runCli(['backup', 'restore', archive, '--force'], h.home)
      expect(attemptedRestore.exitCode).not.toBe(0)
      expect(attemptedRestore.stderr + attemptedRestore.stdout).toMatch(
        /uninstall process.*wait for it to finish before restoring/s,
      )

      const attemptedDaemon = await runCli(['serve', '--port', '0'], h.home, {
        BAZILION_SCHEDULER: 'off',
      })
      expect(attemptedDaemon.exitCode).not.toBe(0)
      expect(attemptedDaemon.stderr + attemptedDaemon.stdout).toMatch(
        /uninstall process.*modifying this home.*wait for it to finish/s,
      )

      // All three contenders lose before the active uninstall has deleted a
      // single member of the DB/auth identity pair.
      expect(existsSync(join(h.home, 'bazilion.db'))).toBe(true)
      expect(existsSync(join(h.home, 'auth.json'))).toBe(true)
    } finally {
      lock.markUninstallComplete()
      lock.release()
      rmSync(restoreFixture, { recursive: true, force: true })
      rmSync(runtimePath, { force: true })
      h.cleanup()
    }
  })

  it('retains an uncompleted uninstall marker on handled failure', async () => {
    const h = makeHome()
    const runtimePath = daemonLivenessPath(h.home)
    try {
      writeManagedResetState(h.home)
      const lock = await acquireHomeRestoreLock(h.home, 'uninstalling')
      lock.release()

      const record = JSON.parse(readFileSync(runtimePath, 'utf8')) as Record<string, unknown>
      expect(record).toMatchObject({ owner: 'restore', state: 'uninstalling' })

      // Model the command process finishing after its handled error. Only the
      // same uninstall operation may reclaim the now-dead retained marker.
      record.pid = exitedProcessId()
      writeFileSync(runtimePath, `${JSON.stringify(record, null, 2)}\n`)
      await expect(acquireHomeRestoreLock(h.home)).rejects.toThrow(
        /previous Bazilion uninstall was interrupted/,
      )

      const resumed = runUninstall(['uninstall', '--yes'], h.home)
      expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0)
      expect(resumed.stderr + resumed.stdout).toContain('resuming interrupted Bazilion uninstall')
      expect(existsSync(runtimePath)).toBe(false)
    } finally {
      rmSync(runtimePath, { force: true })
      h.cleanup()
    }
  })

  it('keeps an interrupted uninstall fail-closed until a later uninstall finishes it', async () => {
    const h = makeHome()
    const restoreFixture = mkdtempSync(join(tmpdir(), 'bazilion-dead-uninstall-'))
    const archive = join(restoreFixture, 'backup.tar.gz')
    const runtimePath = daemonLivenessPath(h.home)
    try {
      writeManagedResetState(h.home)
      writeRetainedState(h.home)
      writeFileSync(archive, 'not reached: ownership fails before archive validation')

      const interrupted = spawnSync(
        process.execPath,
        [...STRIP_TYPES_ARGS, interruptedUninstallEntry, h.home],
        { encoding: 'utf8' },
      )
      if (interrupted.error) throw interrupted.error
      expect(interrupted.status).toBe(23)
      expect(existsSync(join(h.home, 'bazilion.db'))).toBe(false)
      expect(existsSync(join(h.home, 'auth.json'))).toBe(true)
      expect(JSON.parse(readFileSync(runtimePath, 'utf8'))).toMatchObject({
        owner: 'restore',
        state: 'uninstalling',
      })

      await expect(acquireHomeRestoreLock(h.home)).rejects.toThrow(
        /previous Bazilion uninstall was interrupted.*same `bazilion uninstall` command/s,
      )

      const attemptedRestore = await runCli(['backup', 'restore', archive, '--force'], h.home)
      expect(attemptedRestore.exitCode).not.toBe(0)
      expect(attemptedRestore.stderr + attemptedRestore.stdout).toMatch(
        /previous Bazilion uninstall was interrupted.*same `bazilion uninstall` command/s,
      )

      const attemptedDaemon = await runCli(['serve', '--port', '0'], h.home, {
        BAZILION_SCHEDULER: 'off',
      })
      expect(attemptedDaemon.exitCode).not.toBe(0)
      expect(attemptedDaemon.stderr + attemptedDaemon.stdout).toMatch(
        /previous Bazilion uninstall was interrupted.*same `bazilion uninstall` command/s,
      )
      // Refusal happens before bootstrap can recreate either half of the
      // deliberately inconsistent DB/auth identity pair.
      expect(existsSync(join(h.home, 'bazilion.db'))).toBe(false)
      expect(existsSync(join(h.home, 'auth.json'))).toBe(true)

      const resumed = runUninstall(['uninstall', '--yes', '--all'], h.home)
      expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0)
      expect(resumed.stderr + resumed.stdout).toContain('resuming interrupted Bazilion uninstall')
      expect(existsSync(h.home)).toBe(false)
      expect(existsSync(runtimePath)).toBe(false)
    } finally {
      rmSync(restoreFixture, { recursive: true, force: true })
      rmSync(runtimePath, { force: true })
      h.cleanup()
    }
  })

  it('clears an interrupted full-wipe marker when the home is already absent', () => {
    const h = makeHome()
    const runtimePath = daemonLivenessPath(h.home)
    try {
      writeManagedResetState(h.home)

      const interrupted = spawnSync(
        process.execPath,
        [...STRIP_TYPES_ARGS, interruptedUninstallEntry, h.home, 'full-home'],
        { encoding: 'utf8' },
      )
      if (interrupted.error) throw interrupted.error
      expect(interrupted.status).toBe(23)
      expect(existsSync(h.home)).toBe(false)
      expect(existsSync(runtimePath)).toBe(true)

      const resumed = runUninstall(['uninstall', '--yes', '--all'], h.home)
      expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0)
      expect(resumed.stderr + resumed.stdout).toContain('resuming interrupted Bazilion uninstall')
      expect(resumed.stdout).toContain(`nothing to remove: ${h.home} does not exist`)
      expect(existsSync(runtimePath)).toBe(false)
    } finally {
      rmSync(runtimePath, { force: true })
      h.cleanup()
    }
  })

  it('cannot bypass an interrupted symlink-home wipe by retrying through the alias', async () => {
    const h = makeHome()
    const alias = `${h.home}-alias`
    const runtimePath = daemonLivenessPath(h.home)
    try {
      symlinkSync(h.home, alias, 'dir')
      writeManagedResetState(h.home)
      writeRetainedState(h.home)

      const interrupted = spawnSync(
        process.execPath,
        [...STRIP_TYPES_ARGS, interruptedUninstallEntry, alias, 'symlink-full-home'],
        { encoding: 'utf8' },
      )
      if (interrupted.error) throw interrupted.error
      expect(interrupted.status).toBe(23)
      expect(lstatSync(alias).isSymbolicLink()).toBe(true)
      expect(existsSync(runtimePath)).toBe(true)
      expect(daemonLivenessPath(alias)).toBe(runtimePath)

      const daemonAttempt = await runCli(['serve', '--port', '0'], alias, {
        BAZILION_SCHEDULER: 'off',
      })
      expect(daemonAttempt.exitCode).not.toBe(0)
      expect(daemonAttempt.stderr + daemonAttempt.stdout).toMatch(
        /previous Bazilion uninstall was interrupted/,
      )

      const resumed = runUninstall(['uninstall', '--yes', '--all', '--home', alias], h.home)
      expect(resumed.exitCode, resumed.stderr + resumed.stdout).toBe(0)
      expect(resumed.stderr + resumed.stdout).toContain('resuming interrupted Bazilion uninstall')
      expect(lstatSync(alias).isSymbolicLink()).toBe(true)
      expect(readdirSync(h.home)).toEqual([])
      expect(existsSync(runtimePath)).toBe(false)
    } finally {
      rmSync(runtimePath, { force: true })
      rmSync(alias, { force: true })
      h.cleanup()
    }
  })
})
