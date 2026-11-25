// The Bazilion app on macOS, for people who never open a terminal again after installing:
//
// - a background service (a launchd agent in ~/Library/LaunchAgents) that runs
//   `bazilion dashboard --no-open` from login on, and again if it stops;
// - Bazilion.app in Applications, which runs `bazilion open`: it starts the service when it is
//   not running and opens the web UI in the browser, signed in.
//
// Both run this very install (this Node and this CLI), so `bazilion app install` is run again
// after moving or upgrading it. A home other than ~/.bazilion gets a service of its own, and a
// HOME other than the user's own keeps the app, the service file and the log inside it.

import { spawnSync } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { homedir, userInfo } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { nodeArgs } from './commands/serve.ts'
import { canonicalPath } from './paths.ts'

export const APP_NAME = 'Bazilion'
const DEFAULT_LABEL = 'com.bazilion.dashboard'
/** Inside an app this command made: which service it opens. Another Bazilion.app is left alone. */
const MARKER = 'bazilion-app.json'

const bundledIcon = join(import.meta.dirname, 'assets', 'Bazilion.icns')
const ICON = existsSync(bundledIcon)
  ? bundledIcon
  : join(import.meta.dirname, '..', 'assets', 'Bazilion.icns')

export interface Ports {
  web: string
  daemon: string
}

export interface AppLayout {
  /** The Bazilion home the service runs. */
  home: string
  /** A home other than ~/.bazilion: the service and the app carry it. */
  customHome: boolean
  /** HOME is not the user's own (a scratch HOME): the service and the app carry it too. */
  customUserHome: boolean
  label: string
  plist: string
  log: string
  /** Where the app goes: /Applications when it may be written, else ~/Applications. */
  applications: string
  app: string
}

function writable(dir: string): boolean {
  try {
    accessSync(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

export function appLayout(home: string, applications?: string): AppLayout {
  const userHome = homedir()
  const customUserHome = canonicalPath(userHome) !== canonicalPath(userInfo().homedir)
  const canonicalHome = canonicalPath(home)
  const customHome = canonicalHome !== canonicalPath(join(userInfo().homedir, '.bazilion'))
  const label = customHome
    ? `${DEFAULT_LABEL}.${createHash('sha256').update(canonicalHome).digest('hex').slice(0, 10)}`
    : DEFAULT_LABEL
  const folder =
    applications ??
    (!customUserHome && writable('/Applications')
      ? '/Applications'
      : join(userHome, 'Applications'))
  return {
    home: canonicalHome,
    customHome,
    customUserHome,
    label,
    plist: join(userHome, 'Library', 'LaunchAgents', `${label}.plist`),
    log: join(userHome, 'Library', 'Logs', 'Bazilion', `${label}.log`),
    applications: folder,
    app: join(folder, `${APP_NAME}.app`),
  }
}

/** This install's CLI, run by this Node: what the service and the app start. */
export function cliCommand(...args: string[]): string[] {
  const entry = realpathSync(process.argv[1] ?? '')
  return [process.execPath, ...nodeArgs(entry), ...args]
}

/** What the service and the app need from this shell: this Node first, and the home. */
export function serviceEnvironment(layout: AppLayout): Record<string, string> {
  const dirs = [
    dirname(process.execPath),
    ...(process.env.PATH ?? '').split(delimiter),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean)
  const env: Record<string, string> = {
    PATH: [...new Set(dirs)].join(delimiter),
    LANG: process.env.LANG || 'en_US.UTF-8',
  }
  if (layout.customUserHome) env.HOME = homedir()
  if (layout.customHome) env.BAZILION_HOME = layout.home
  return env
}

function xml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** The launchd agent: run the dashboard from login on, and again whenever it fails. */
export function launchAgentPlist(opts: {
  label: string
  command: string[]
  env: Record<string, string>
  log: string
  workingDirectory: string
}): string {
  const strings = (values: string[]) =>
    values.map((value) => `    <string>${xml(value)}</string>`).join('\n')
  const env = Object.entries(opts.env)
    .map(([key, value]) => `    <key>${xml(key)}</key>\n    <string>${xml(value)}</string>`)
    .join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- Made by \`bazilion app install\`; \`bazilion app remove\` removes it. -->
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xml(opts.label)}</string>
  <key>ProgramArguments</key>
  <array>
${strings(opts.command)}
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${env}
  </dict>
  <key>WorkingDirectory</key>
  <string>${xml(opts.workingDirectory)}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>${xml(opts.log)}</string>
  <key>StandardErrorPath</key>
  <string>${xml(opts.log)}</string>
</dict>
</plist>
`
}

function shellQuote(text: string): string {
  return `'${text.replace(/'/g, `'\\''`)}'`
}

function appleScriptString(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The app's script: run `bazilion open`, and show what went wrong if it fails. */
export function appScript(command: string[], env: Record<string, string>): string {
  const shell = [
    ...Object.entries(env).map(([key, value]) => `${key}=${shellQuote(value)}`),
    ...command.map(shellQuote),
  ].join(' ')
  return `-- Bazilion: start Bazilion when it is not running, then open it in the browser, signed in.
-- Made by \`bazilion app install\`, which makes it again.
on run
\ttry
\t\tdo shell script ${appleScriptString(shell)}
\ton error message
\t\tdisplay dialog message with title "Bazilion" buttons {"OK"} default button "OK" with icon caution
\tend try
end run
`
}

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw new Error(`${command}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${command} failed: ${(result.stderr || result.stdout).trim()}`)
  }
  return result.stdout
}

/** Is this an app `bazilion app install` made? */
export function madeByBazilion(app: string): boolean {
  return existsSync(join(app, 'Contents', 'Resources', MARKER))
}

/**
 * Make Bazilion.app in the layout's folder, replacing one this command made before. It is
 * built beside its destination, so the last step is a rename on the same disk.
 */
export function buildApp(layout: AppLayout, script: string): void {
  if (existsSync(layout.app) && !madeByBazilion(layout.app)) {
    throw new Error(
      `${layout.app} exists and was not made by Bazilion; move it away, then run this again`,
    )
  }
  mkdirSync(layout.applications, { recursive: true })
  const staging = join(layout.applications, `.bazilion-app-${randomBytes(4).toString('hex')}`)
  mkdirSync(staging)
  try {
    const source = join(staging, 'main.applescript')
    writeFileSync(source, script)
    const built = join(staging, `${APP_NAME}.app`)
    run('/usr/bin/osacompile', ['-o', built, source])
    const resources = join(built, 'Contents', 'Resources')
    if (existsSync(ICON)) copyFileSync(ICON, join(resources, 'applet.icns'))
    writeFileSync(
      join(resources, MARKER),
      `${JSON.stringify({ label: layout.label, home: layout.home }, null, 2)}\n`,
    )
    // The icon and the marker change the bundle: seal it again, signed for this Mac only.
    run('/usr/bin/codesign', ['--force', '--sign', '-', built])
    rmSync(layout.app, { recursive: true, force: true })
    renameSync(built, layout.app)
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

function launchctl(args: string[]) {
  return spawnSync('/bin/launchctl', args, { encoding: 'utf8' })
}

function domain(): string {
  return `gui/${process.getuid?.() ?? userInfo().uid}`
}

export interface ServiceState {
  loaded: boolean
  pid: number | null
}

export function serviceState(label: string): ServiceState {
  const printed = launchctl(['print', `${domain()}/${label}`])
  if (printed.status !== 0) return { loaded: false, pid: null }
  const pid = /^\s*pid = (\d+)$/m.exec(printed.stdout)?.[1]
  return { loaded: true, pid: pid ? Number(pid) : null }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Load the service from its file, replacing a loaded one: it starts at once. */
export async function loadService(layout: AppLayout): Promise<void> {
  if (serviceState(layout.label).loaded) launchctl(['bootout', `${domain()}/${layout.label}`])
  // A service that was just booted out can refuse a new bootstrap for a moment.
  let last = ''
  for (let attempt = 0; attempt < 20; attempt++) {
    const loaded = launchctl(['bootstrap', domain(), layout.plist])
    if (loaded.status === 0) return
    last = (loaded.stderr || loaded.stdout).trim()
    await sleep(250)
  }
  throw new Error(`launchctl could not start ${layout.label}: ${last}`)
}

/** Start the installed service when it is not running; loading it starts it too. */
export async function startService(layout: AppLayout): Promise<void> {
  if (!serviceState(layout.label).loaded) return loadService(layout)
  const started = launchctl(['kickstart', `${domain()}/${layout.label}`])
  if (started.status !== 0) {
    throw new Error(
      `launchctl could not start ${layout.label}: ${(started.stderr || started.stdout).trim()}`,
    )
  }
}

/** Stop and unload the service, and wait until launchd has let it go (it does so after a while). */
export async function unloadService(layout: AppLayout): Promise<boolean> {
  if (!serviceState(layout.label).loaded) return false
  launchctl(['bootout', `${domain()}/${layout.label}`])
  for (let waited = 0; waited < 15_000 && serviceState(layout.label).loaded; waited += 250) {
    await sleep(250)
  }
  return true
}

/** The ports an installed service runs the dashboard on, read from its file. */
export function installedPorts(layout: AppLayout): Ports | null {
  if (!existsSync(layout.plist)) return null
  const text = readFileSync(layout.plist, 'utf8')
  const value = (flag: string) =>
    new RegExp(`<string>${flag}</string>\\s*<string>(\\d+)</string>`).exec(text)?.[1]
  const web = value('--port')
  const daemon = value('--daemon-port')
  return web && daemon ? { web, daemon } : null
}

/** The service file, the app and its log: everything `install` made. Data stays in the home. */
export function writeService(layout: AppLayout, ports: Ports): void {
  mkdirSync(dirname(layout.plist), { recursive: true })
  mkdirSync(dirname(layout.log), { recursive: true })
  writeFileSync(
    layout.plist,
    launchAgentPlist({
      label: layout.label,
      command: cliCommand(
        'dashboard',
        '--no-open',
        '--port',
        ports.web,
        '--daemon-port',
        ports.daemon,
      ),
      env: serviceEnvironment(layout),
      log: layout.log,
      workingDirectory: homedir(),
    }),
  )
}
