import { existsSync, lstatSync, readdirSync, realpathSync, rmSync } from 'node:fs'
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
    const homeIsSymlink = lstatSync(targetHome).isSymbolicLink()

    console.log(`about to uninstall bazilion at ${targetHome}`)
    console.log('')

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
