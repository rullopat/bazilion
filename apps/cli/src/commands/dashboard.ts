import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { connect } from 'node:net'
import { join } from 'node:path'
import { defineCommand } from 'citty'
import { resolveCliPaths } from '../paths.ts'

const bundledDaemonEntry = join(import.meta.dirname, 'daemon.js')
const sourceDaemonEntry = join(import.meta.dirname, '..', '..', '..', 'daemon', 'src', 'index.ts')
const daemonEntry = existsSync(bundledDaemonEntry) ? bundledDaemonEntry : sourceDaemonEntry

const bundledWebServerEntry = join(import.meta.dirname, 'web-server.js')
const sourceWebServerEntry = join(import.meta.dirname, '..', 'web-server.ts')
const webServerEntry = existsSync(bundledWebServerEntry)
  ? bundledWebServerEntry
  : sourceWebServerEntry

const bundledWebDist = join(import.meta.dirname, 'web')
const sourceWebDist = join(import.meta.dirname, '..', '..', '..', 'web', 'dist')
const webDist = existsSync(bundledWebDist) ? bundledWebDist : sourceWebDist

function nodeArgs(entry: string): string[] {
  return entry.endsWith('.ts') ? ['--import', 'tsx/esm', entry] : [entry]
}

async function responds(url: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    return res.status >= 200 && res.status < 500
  } catch {
    return false
  }
}

function probeHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1'
  if (host === '::') return '::1'
  return host
}

function isTcpPortOpen(host: string, port: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: probeHost(host), port: Number(port) })
    const done = (open: boolean): void => {
      socket.removeAllListeners()
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(600)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

async function bazilionDaemonRunning(url: string, port: string): Promise<boolean> {
  try {
    const res = await fetch(`${url}/api/health`)
    if (res.ok) {
      const body = (await res.json().catch(() => null)) as { ok?: unknown } | null
      if (body?.ok === true) return true
    }
  } catch {
    return false
  }

  throw new Error(
    `port ${port} is already serving HTTP, but it is not a healthy bazilion daemon. Re-run with --daemon-port <free-port>.`,
  )
}

async function bazilionWebRunning(url: string, port: string): Promise<boolean> {
  try {
    const res = await fetch(url)
    if (res.status >= 200 && res.status < 500) {
      const html = await res.text()
      if (html.includes('<title>bazilion</title>') || html.includes('>bazilion<')) {
        return true
      }
    }
  } catch {
    return false
  }

  throw new Error(
    `port ${port} is already serving HTTP, but it is not the bazilion web UI. Re-run with --port <free-port>.`,
  )
}

async function waitFor(url: string, label: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await responds(url)) return
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timed out waiting for ${label} at ${url}`)
}

function openBrowser(url: string): void {
  const platform = process.platform
  const cmd =
    platform === 'darwin'
      ? 'open'
      : platform === 'win32'
        ? 'cmd'
        : process.env.BROWSER || 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url]
  const proc = spawn(cmd, args, { detached: true, stdio: 'ignore' })
  proc.unref()
}

function spawnProcess(label: string, entry: string, env: NodeJS.ProcessEnv): ChildProcess {
  if (!existsSync(entry)) {
    throw new Error(`${label} entry not found at ${entry}`)
  }
  return spawn(process.execPath, nodeArgs(entry), {
    env,
    stdio: 'inherit',
  })
}

export const dashboardCommand = defineCommand({
  meta: {
    name: 'dashboard',
    description: 'Start the bazilion daemon and bundled web UI',
  },
  args: {
    port: { type: 'string', description: 'Web UI port (default 4322)' },
    host: {
      type: 'string',
      description: 'Web UI host (default 127.0.0.1). Use loopback unless you know why not.',
    },
    'daemon-port': { type: 'string', description: 'Daemon port (default 4321)' },
    'daemon-host': {
      type: 'string',
      description: 'Daemon host (default 127.0.0.1). Use loopback unless you know why not.',
    },
    open: {
      type: 'boolean',
      description: 'Open the dashboard in your browser (default true)',
      default: true,
    },
  },
  async run({ args }) {
    const webHost = args.host ?? '127.0.0.1'
    const webPort = args.port ?? '4322'
    const daemonHost = args['daemon-host'] ?? '127.0.0.1'
    const daemonPort = args['daemon-port'] ?? '4321'
    const daemonUrl = `http://${daemonHost}:${daemonPort}`
    const webUrl = `http://${webHost}:${webPort}`
    const authFile = resolveCliPaths().authFile

    if (webHost !== '127.0.0.1' && webHost !== 'localhost' && webHost !== '::1') {
      console.error('')
      console.error(
        `warning: binding web UI to ${webHost} - the dashboard may be reachable beyond loopback.`,
      )
      console.error('  keep it behind a trusted network or a TLS proxy.')
      console.error('')
    }

    const children: ChildProcess[] = []
    let signalled = false
    const terminateChildren = (): void => {
      signalled = true
      for (const child of children) {
        try {
          child.kill('SIGTERM')
        } catch {}
      }
    }

    try {
      const daemonRunning = await bazilionDaemonRunning(daemonUrl, daemonPort)
      if (daemonRunning) {
        console.log(`using existing bazilion daemon at ${daemonUrl}`)
      } else {
        if (await isTcpPortOpen(daemonHost, daemonPort)) {
          throw new Error(
            `daemon port ${daemonPort} is already in use. Re-run with --daemon-port <free-port>.`,
          )
        }
        console.log(`starting bazilion daemon at ${daemonUrl}`)
        const daemon = spawnProcess('daemon', daemonEntry, {
          ...process.env,
          HOST: daemonHost,
          PORT: daemonPort,
        })
        children.push(daemon)
        await waitFor(`${daemonUrl}/api/health`, 'bazilion daemon')
      }

      const webRunning = await bazilionWebRunning(webUrl, webPort)
      if (webRunning) {
        console.log(`using existing bazilion web UI at ${webUrl}`)
      } else {
        if (await isTcpPortOpen(webHost, webPort)) {
          throw new Error(
            `web UI port ${webPort} is already in use. Re-run with --port <free-port>.`,
          )
        }
        if (!existsSync(join(webDist, 'server', 'server.js'))) {
          throw new Error(
            `bazilion web UI bundle not found at ${webDist}. Run "pnpm --filter @bazilion/web build" from a source checkout, or reinstall the published package.`,
          )
        }
        console.log(`starting bazilion web UI at ${webUrl}`)
        const web = spawnProcess('web UI', webServerEntry, {
          ...process.env,
          WEB_HOST: webHost,
          WEB_PORT: webPort,
          BAZILION_DAEMON: daemonUrl,
          BAZILION_WEB_DIST: webDist,
        })
        children.push(web)
        await waitFor(webUrl, 'bazilion web UI')
      }

      console.log('')
      console.log(`dashboard: ${webUrl}`)
      console.log(`token:     ${authFile}`)
      if (args.open) openBrowser(webUrl)
    } catch (err) {
      terminateChildren()
      throw err
    }

    if (children.length === 0) return

    process.on('SIGINT', terminateChildren)
    process.on('SIGTERM', terminateChildren)

    await new Promise<void>((resolve) => {
      let remaining = children.length
      for (const child of children) {
        child.on('close', (code) => {
          remaining--
          if (!signalled && code && code !== 0) process.exitCode = code
          if (remaining === 0) resolve()
        })
      }
    })

    if (signalled) process.exitCode = 0
  },
})
