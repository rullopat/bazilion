import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { defineCommand } from 'citty'
import { acquireHomeRestoreLock } from '../daemon-liveness.ts'
import { resolveCliPaths } from '../paths.ts'

// Line-buffered stdin reader. `node:readline/promises` drops data after EOF
// on piped input (a known Node quirk with back-to-back `question()` calls),
// so we read chunks ourselves and emit one line per call.
function makeLineReader(): () => Promise<string> {
  let buffer = ''
  let ended = false
  const queue: ((line: string) => void)[] = []

  const tryDeliver = (): void => {
    while (queue.length > 0) {
      const nlIdx = buffer.indexOf('\n')
      if (nlIdx === -1) {
        if (ended) {
          const resolve = queue.shift()
          resolve?.(buffer)
          buffer = ''
        } else {
          return
        }
      } else {
        const line = buffer.slice(0, nlIdx)
        buffer = buffer.slice(nlIdx + 1)
        const resolve = queue.shift()
        resolve?.(line)
      }
    }
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    tryDeliver()
  })
  process.stdin.on('end', () => {
    ended = true
    tryDeliver()
  })

  return () =>
    new Promise<string>((resolve) => {
      queue.push(resolve)
      tryDeliver()
    })
}

async function askYes(readLine: () => Promise<string>, prompt: string): Promise<boolean> {
  process.stdout.write(`${prompt} [y/N] `)
  const answer = (await readLine()).trim().toLowerCase()
  return answer === 'y' || answer === 'yes'
}

const BROWSER_OWNER_REMEDY =
  'Leave the browser profile, owner marker and lock files untouched. ' +
  'Use supported browser status/stop controls; if ownership remains uncertain, ' +
  'keep uninstall blocked and seek operator support.'

/**
 * BAZ-069 T12: refuse the destructive uninstall while any managed browser
 * slot's owner marker names a process that may still be alive. CLI-local —
 * reads only `browsers/<id>/owner.json`; never imports daemon runtime. A
 * symlinked `browsers` root is unlinked (never followed), so no external
 * target is scanned or touched.
 */
function assertNoLiveBrowserOwner(browsersDir: string): void {
  let rootStat: import('node:fs').Stats
  try {
    rootStat = lstatSync(browsersDir)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  if (rootStat.isSymbolicLink()) return // removed by unlink below; never followed

  let slots: string[] = []
  try {
    slots = readdirSync(browsersDir)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return
    throw error
  }
  for (const slot of slots) {
    const markerPath = join(browsersDir, slot, 'owner.json')
    let raw: string
    try {
      raw = readFileSync(markerPath, 'utf8')
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') continue
      // An unreadable marker is unknown ownership: fail closed.
      throw new Error(
        `refusing to uninstall: browser slot ${slot} has an unreadable owner marker. ` +
          BROWSER_OWNER_REMEDY,
      )
    }
    let marker: unknown
    try {
      marker = JSON.parse(raw)
    } catch {
      throw new Error(
        `refusing to uninstall: browser slot ${slot} has a corrupt owner marker. ` +
          BROWSER_OWNER_REMEDY,
      )
    }
    const presence = markerOwnerPresence(marker)
    if (presence === 'alive') {
      throw new Error(
        `refusing to uninstall: browser slot ${slot} is owned by a process that is still ` +
          'alive (orphaned browser). ' +
          BROWSER_OWNER_REMEDY,
      )
    }
    if (presence === 'unknown') {
      throw new Error(
        `refusing to uninstall: cannot prove browser slot ${slot}'s owner process is gone. ` +
          BROWSER_OWNER_REMEDY,
      )
    }
  }
}

function markerOwnerPresence(marker: unknown): 'alive' | 'absent' | 'unknown' {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return 'unknown'
  const record = marker as Record<string, unknown>
  if (!['starting', 'running', 'stopping'].includes(String(record.phase))) return 'unknown'
  const probes: number[] = []
  for (const key of ['pid', 'processGroupId']) {
    const value = record[key]
    if (value === undefined) continue
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > 0x7fffffff
    ) {
      return 'unknown'
    }
    probes.push(key === 'pid' ? value : -value)
  }
  // A crash can occur after spawn and before the PID is persisted. No phase
  // without process identity is positive proof of absence.
  if (probes.length === 0) return 'unknown'
  for (const pid of probes) {
    try {
      process.kill(pid, 0)
      return 'alive' // probe success: the process exists
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : undefined
      if (code === 'ESRCH') continue // positively absent
      return 'unknown' // EPERM and anything else never reads as "safe"
    }
  }
  return 'absent'
}

function removePath(p: string): boolean {
  try {
    // Unlike existsSync(), lstatSync() sees dangling symlinks. Managed Team
    // and legacy Group slots may be symlinks; rmSync unlinks the slot without
    // traversing into or deleting its external target.
    lstatSync(p)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return false
    throw error
  }
  rmSync(p, { recursive: true, force: true })
  return true
}

function canonicalExistingPath(path: string): string {
  try {
    return realpathSync.native(path)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    return resolve(path)
  }
}

function containsPath(container: string, candidate: string): boolean {
  const nested = relative(container, candidate)
  return nested === '' || (nested !== '..' && !nested.startsWith(`..${sep}`) && !isAbsolute(nested))
}

export function assertSafeUninstallHome(home: string): string {
  const target = resolve(home)
  const canonical = canonicalExistingPath(target)
  const userHome = canonicalExistingPath(homedir())
  const workingDirectory = canonicalExistingPath(process.cwd())
  const exactForbidden = new Map<string, string>([
    [parse(canonical).root, 'filesystem root'],
    [userHome, 'user home directory'],
    [workingDirectory, 'current working directory'],
  ])
  const reason = exactForbidden.get(canonical)
  if (reason) throw new Error(`refusing to uninstall from ${reason}: ${target}`)
  if (containsPath(canonical, userHome)) {
    throw new Error(`refusing to uninstall from an ancestor of the user home directory: ${target}`)
  }
  if (containsPath(canonical, workingDirectory)) {
    throw new Error(
      `refusing to uninstall from an ancestor of the current working directory: ${target}`,
    )
  }
  return target
}

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Wipe bazilion state from ~/.bazilion (or BAZILION_HOME)',
  },
  args: {
    home: { type: 'string', description: 'Override BAZILION_HOME' },
    yes: {
      type: 'boolean',
      description: 'Skip confirmations (reset tier only unless --all is set)',
    },
    all: {
      type: 'boolean',
      description: 'Also remove logs and skills (full wipe)',
    },
  },
  async run({ args }) {
    const paths = resolveCliPaths(args.home)
    const targetHome = assertSafeUninstallHome(paths.home)
    // resolveCliPaths canonicalizes (the daemon validates paths against the
    // canonical spelling), so a symlinked BAZILION_HOME arrives here spelled
    // as its real target. Detect the alias from the requested spelling: an
    // uninstall through a symlink keeps the root slot stable (below).
    const requestedHome = resolve(
      args.home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion'),
    )
    let requestedIsSymlink = false
    try {
      requestedIsSymlink = lstatSync(requestedHome).isSymbolicLink()
    } catch {
      // A missing requested spelling cannot be a symlink.
    }
    const homeIsSymlink = requestedIsSymlink
    const dbFile = join(targetHome, 'bazilion.db')
    const profilesDir = join(targetHome, 'profiles')
    const agentsDir = join(targetHome, 'agents')
    const teamsDir = join(targetHome, 'teams')
    const legacyGroupsDir = join(targetHome, 'groups')
    const skillsDir = join(targetHome, 'skills')
    const logsDir = join(targetHome, 'logs')
    const legacyConfigFile = join(targetHome, 'config.json')
    const legacySecretsFile = join(targetHome, 'secrets.enc')

    if (!existsSync(targetHome)) {
      // A full wipe can remove the home and then be interrupted before its
      // sibling ownership record is released. Acquire the same operation so a
      // retry can reclaim that dead marker instead of leaving the home
      // permanently blocked from daemon startup and restore.
      const uninstallLock = await acquireHomeRestoreLock(targetHome, 'uninstalling')
      try {
        console.log(`nothing to remove: ${targetHome} does not exist`)
        uninstallLock.markUninstallComplete()
      } finally {
        uninstallLock.release()
      }
      return
    }

    console.log(`about to uninstall bazilion at ${targetHome}`)
    console.log('')

    // BAZ-069 T12: the reset tier also removes the root browser slot tree —
    // managed profiles hold site credentials. A slot whose owner marker names
    // a LIVE process (an orphaned browser the daemon no longer tracks) blocks
    // the destructive uninstall: never delete a live browser's profile.
    const browsersDir = join(targetHome, 'browsers')
    assertNoLiveBrowserOwner(browsersDir)

    const resetTargets = [
      dbFile,
      `${dbFile}-wal`,
      `${dbFile}-shm`,
      `${dbFile}-journal`,
      join(targetHome, 'auth.json'),
      legacyConfigFile,
      legacySecretsFile,
      profilesDir,
      agentsDir,
      teamsDir,
      legacyGroupsDir,
      browsersDir,
    ]

    const needsPrompt = !args.yes
    const readLine = needsPrompt ? makeLineReader() : null
    const wipeData =
      args.yes ||
      (await askYes(
        readLine as () => Promise<string>,
        'remove DB + auth/config + agent / profile / team data?',
      ))
    if (!wipeData) {
      console.log('aborted')
      process.stdin.pause()
      return
    }

    // Tier 2: ask only after reset is confirmed. auth.json belongs to the DB's
    // bootstrap-token row, so both tiers remove it as one identity pair. Logs
    // and imported skills remain reusable across a clean bootstrap.
    const wipeAll =
      args.all ||
      (args.yes
        ? false
        : await askYes(
            readLine as () => Promise<string>,
            `also remove logs and skills? (full wipe of ${targetHome})`,
          ))

    process.stdin.pause()
    // Share the daemon/restore ownership primitive for the entire destructive
    // window. A daemon that is live or starting wins the lock and uninstall
    // fails closed before removing any state.
    const uninstallLock = await acquireHomeRestoreLock(targetHome, 'uninstalling')
    try {
      // The earlier check is advisory: prompts can leave time for a daemon to
      // start, spawn a browser and exit. Revalidate under exclusive ownership.
      assertNoLiveBrowserOwner(browsersDir)
      for (const p of resetTargets) {
        if (removePath(p)) console.log(`removed ${p}`)
      }

      if (wipeAll) {
        const fullWipeTargets = [logsDir, skillsDir]
        for (const p of fullWipeTargets) {
          if (removePath(p)) console.log(`removed ${p}`)
        }
        // If nothing else is left in $BAZILION_HOME, drop the empty dir too so
        // a subsequent `bazilion serve` re-bootstraps into a truly fresh home.
        if (readdirSync(targetHome).length === 0 && !homeIsSymlink) {
          rmSync(targetHome, { recursive: true, force: true })
          console.log(`removed ${targetHome}`)
        } else if (homeIsSymlink && readdirSync(targetHome).length === 0) {
          // The sibling ownership record is keyed to this symlink's canonical
          // target. Unlinking the alias before the record is released would
          // let an interrupted retry compute a different identity and bypass
          // the durable uninstall marker. Keep the empty root slot stable.
          console.log(`kept ${targetHome}: symlinked BAZILION_HOME root is now empty`)
        } else {
          console.log(`${targetHome} still has unmanaged files; left in place`)
        }
      } else {
        console.log('')
        console.log('kept: logs/, skills/')
        console.log(
          `re-run 'bazilion serve' to create a fresh DB and matching auth.json when you're ready.`,
        )
      }
      uninstallLock.markUninstallComplete()
    } finally {
      uninstallLock.release()
    }
  },
})
