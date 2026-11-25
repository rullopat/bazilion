import { existsSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import {
  type AppLayout,
  appLayout,
  appScript,
  buildApp,
  cliCommand,
  installedPorts,
  loadService,
  madeByBazilion,
  serviceEnvironment,
  serviceState,
  unloadService,
  writeService,
} from '../mac-app.ts'
import { requestedHome } from '../paths.ts'
import { responds, waitFor } from './dashboard.ts'

const START_MS = 120_000

function macOnly(): void {
  if (process.platform !== 'darwin') {
    throw new Error('the Bazilion app is for macOS; elsewhere, run `bazilion dashboard`')
  }
}

const applicationsArg = {
  type: 'string',
  description: 'The folder for Bazilion.app (default /Applications, or ~/Applications)',
} as const

/** Shorten the user's home to ~ in what is printed. */
function shown(path: string): string {
  const home = homedir()
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

/** The apps `remove` and `status` look at: the one given, or both usual folders. */
function candidateApps(layout: AppLayout, given: string | undefined): string[] {
  const usual = [
    join('/Applications', 'Bazilion.app'),
    join(homedir(), 'Applications', 'Bazilion.app'),
  ]
  const apps = given || layout.customUserHome ? [layout.app] : [layout.app, ...usual]
  return [...new Set(apps)].filter((app) => existsSync(app) && madeByBazilion(app))
}

const installCmd = defineCommand({
  meta: {
    name: 'install',
    description:
      'Add Bazilion.app and run Bazilion in the background from login on (macOS); again to update them',
  },
  args: {
    applications: applicationsArg,
    port: { type: 'string', description: 'Web UI port (default 4322)' },
    'daemon-port': { type: 'string', description: 'Daemon port (default 4321)' },
  },
  async run({ args }) {
    macOnly()
    const layout = appLayout(requestedHome(), args.applications)
    const ports = {
      web: args.port ?? installedPorts(layout)?.web ?? '4322',
      daemon: args['daemon-port'] ?? installedPorts(layout)?.daemon ?? '4321',
    }
    writeService(layout, ports)
    buildApp(
      layout,
      appScript(
        cliCommand('open', '--port', ports.web, '--daemon-port', ports.daemon),
        serviceEnvironment(layout),
      ),
    )
    // A Bazilion this service does not run, such as `bazilion dashboard` in a terminal, keeps
    // the ports: the service's dashboard then uses it and ends, and runs it at the next login.
    const elsewhere =
      !serviceState(layout.label).pid &&
      (await responds(`http://127.0.0.1:${ports.daemon}/api/health`))
    await loadService(layout)
    const webUrl = `http://127.0.0.1:${ports.web}`
    try {
      await waitFor(`http://127.0.0.1:${ports.daemon}/api/health`, 'the daemon', START_MS)
      await waitFor(webUrl, 'the web UI', START_MS)
    } catch {
      throw new Error(`Bazilion did not start; what it said is in ${layout.log}`)
    }
    console.log(`app:       ${shown(layout.app)}`)
    console.log(
      elsewhere
        ? `service:   ${layout.label}; another Bazilion already runs on these ports (a terminal?), so this one starts once that one stops, or when you log in`
        : `service:   ${layout.label}, running; it starts again when you log in`,
    )
    console.log(`dashboard: ${webUrl}`)
    console.log(`log:       ${shown(layout.log)}`)
  },
})

const removeCmd = defineCommand({
  meta: {
    name: 'remove',
    description:
      'Stop Bazilion running in the background and remove Bazilion.app (keeps your data)',
  },
  args: { applications: applicationsArg },
  async run({ args }) {
    macOnly()
    const layout = appLayout(requestedHome(), args.applications)
    const removed: string[] = []
    if (await unloadService(layout)) removed.push(`the service ${layout.label}`)
    for (const path of [layout.plist, layout.log]) {
      if (existsSync(path)) {
        rmSync(path, { force: true })
        removed.push(shown(path))
      }
    }
    for (const app of candidateApps(layout, args.applications)) {
      rmSync(app, { recursive: true, force: true })
      removed.push(shown(app))
    }
    console.log(
      removed.length > 0 ? `removed ${removed.join(', ')}` : 'the Bazilion app is not installed',
    )
    console.log(`your data in ${shown(layout.home)} is kept; \`bazilion uninstall\` deletes it`)
  },
})

const statusCmd = defineCommand({
  meta: {
    name: 'status',
    description: 'Whether the Bazilion app is installed and running (macOS)',
  },
  args: { applications: applicationsArg },
  async run({ args }) {
    macOnly()
    const layout = appLayout(requestedHome(), args.applications)
    const apps = candidateApps(layout, args.applications)
    if (!existsSync(layout.plist) && apps.length === 0) {
      console.log('not installed: `bazilion app install` adds it')
      return
    }
    const state = serviceState(layout.label)
    const ports = installedPorts(layout)
    const web = ports ? `http://127.0.0.1:${ports.web}` : null
    console.log(
      `app:       ${apps.map(shown).join(', ') || '(missing: `bazilion app install` makes it again)'}`,
    )
    console.log(
      `service:   ${layout.label}, ${state.pid ? `running (pid ${state.pid})` : state.loaded ? 'not running' : 'not loaded'}`,
    )
    if (web) console.log(`dashboard: ${web}${(await responds(web)) ? '' : ' (not answering)'}`)
    console.log(`log:       ${shown(layout.log)}`)
  },
})

export const appCommand = defineCommand({
  meta: {
    name: 'app',
    description: 'The Bazilion app on macOS: in Applications, running in the background',
  },
  subCommands: { install: installCmd, remove: removeCmd, status: statusCmd },
})
