import { existsSync, lstatSync, readdirSync, rmdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import { assertDaemonStopped, DAEMON_PID_FILE } from '../../../daemon/src/lib/daemon-liveness.ts'
import { confirm } from '../command-helpers.ts'
import { canonicalPath, requestedHome } from '../paths.ts'

// The reset deletes these and keeps installed skills; --all deletes the skills too.
const RESET_ENTRIES = [
  'profiles',
  'agents',
  'teams',
  'browsers',
  DAEMON_PID_FILE,
  'bazilion.db-wal',
  'bazilion.db-shm',
  'bazilion.db-journal',
  'bazilion.db',
  'auth.json',
]
const ALL_ENTRIES = [...RESET_ENTRIES, 'skills']

export const uninstallCommand = defineCommand({
  meta: {
    name: 'uninstall',
    description: 'Delete the Bazilion data in ~/.bazilion (or BAZILION_HOME)',
  },
  args: {
    home: { type: 'string', description: 'Uninstall this home instead of BAZILION_HOME' },
    yes: { type: 'boolean', description: 'Do not ask for confirmation' },
    all: { type: 'boolean', description: 'Also delete installed skills, then the emptied home' },
  },
  async run({ args }) {
    const requested = requestedHome(args.home)
    const home = canonicalPath(requested)
    if (!existsSync(home)) {
      console.log(`nothing to remove: ${home} does not exist`)
      return
    }
    if (home === canonicalPath(homedir())) {
      throw new Error(
        `refusing to uninstall your home directory ${home}; delete Bazilion's files by hand`,
      )
    }
    // A directory given by mistake is refused: a home has bazilion.db, or only Bazilion's entries.
    const unmanaged = readdirSync(home).filter((entry) => !ALL_ENTRIES.includes(entry))
    if (!existsSync(join(home, 'bazilion.db')) && unmanaged.length > 0) {
      throw new Error(
        `${home} is not a Bazilion home: no bazilion.db, and it holds ${unmanaged.join(', ')}`,
      )
    }
    assertDaemonStopped(home)

    const scope = args.all
      ? `all Bazilion data in ${home}, installed skills included`
      : `the database, auth.json, profiles, Agents, Teams and browser profiles in ${home}`
    if (!args.yes && !(await confirm(`delete ${scope}?`))) {
      console.log('aborted')
      return
    }
    // Again: a daemon may have started while the question was open.
    assertDaemonStopped(home)
    // Linked Team slots are symlinks: rmSync unlinks them and never touches their targets.
    for (const entry of args.all ? ALL_ENTRIES : RESET_ENTRIES) {
      rmSync(join(home, entry), { recursive: true, force: true })
    }
    if (!args.all) {
      console.log(`reset ${home}; installed skills are kept`)
      console.log("run 'bazilion serve' to start again with a fresh database and auth.json")
      return
    }
    const left = readdirSync(home).sort()
    if (left.length > 0) {
      console.log(`removed the Bazilion data; kept ${home}, which also holds ${left.join(', ')}`)
    } else if (lstatSync(requested).isSymbolicLink()) {
      // Deleting the link's target would leave BAZILION_HOME dangling.
      console.log(`emptied ${home}`)
    } else {
      rmdirSync(home)
      console.log(`removed ${home}`)
    }
  },
})
