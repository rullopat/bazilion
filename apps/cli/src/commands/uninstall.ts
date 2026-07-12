import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defineCommand } from 'citty'
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
  if (!existsSync(p)) return false
  rmSync(p, { recursive: true, force: true })
  return true
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
      description: 'Skip confirmations (data tier only unless --all is set)',
    },
    all: {
      type: 'boolean',
      description: 'Also remove configs, logs, and skills (full wipe)',
    },
  },
  async run({ args }) {
    const paths = resolveCliPaths(args.home)
    const dbFile = join(paths.home, 'bazilion.db')
    const profilesDir = join(paths.home, 'profiles')
    const agentsDir = join(paths.home, 'agents')
    const teamsDir = join(paths.home, 'teams')
    const skillsDir = join(paths.home, 'skills')
    const logsDir = join(paths.home, 'logs')

    if (!existsSync(paths.home)) {
      console.log(`nothing to remove: ${paths.home} does not exist`)
      return
    }

    console.log(`about to uninstall bazilion at ${paths.home}`)
    console.log('')

    const dataTargets = [dbFile, `${dbFile}-wal`, `${dbFile}-shm`, profilesDir, agentsDir, teamsDir]

    const needsPrompt = !args.yes
    const readLine = needsPrompt ? makeLineReader() : null
    const wipeData =
      args.yes ||
      (await askYes(
        readLine as () => Promise<string>,
        'remove DB + agent / profile / workspace data?',
      ))
    if (!wipeData) {
      console.log('aborted')
      process.stdin.pause()
      return
    }

    // Tier 2: ask only after data wipe is confirmed — configs/logs/skills are
    // reusable across reinstalls, so the two-tier split lets an operator
    // factory-reset agents while keeping credentials + imported skills.
    const wipeAll =
      args.all ||
      (args.yes
        ? false
        : await askYes(
            readLine as () => Promise<string>,
            'also remove configs, logs, and skills? (full wipe of ~/.bazilion)',
          ))

    process.stdin.pause()

    for (const p of dataTargets) {
      if (removePath(p)) console.log(`removed ${p}`)
    }

    if (wipeAll) {
      const configTargets = [paths.authFile, logsDir, skillsDir]
      for (const p of configTargets) {
        if (removePath(p)) console.log(`removed ${p}`)
      }
      // If nothing else is left in $BAZILION_HOME, drop the empty dir too so
      // a subsequent `bazilion serve` re-bootstraps into a truly fresh home.
      if (readdirSync(paths.home).length === 0) {
        rmSync(paths.home, { recursive: true, force: true })
        console.log(`removed ${paths.home}`)
      } else {
        console.log(`${paths.home} still has unmanaged files; left in place`)
      }
    } else {
      console.log('')
      console.log('kept: auth.json, logs/, skills/')
      console.log(`re-run 'bazilion serve' to recreate the DB when you're ready.`)
    }
  },
})
