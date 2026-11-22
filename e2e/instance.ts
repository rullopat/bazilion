// A whole Bazilion on a scratch home, as the published package runs it: the built daemon and web
// server (`pnpm build` first), with LM Studio pointed at a stand-in model server. For the browser
// tests and the website's pictures; never the operator's own ~/.bazilion.

import { type ChildProcess, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')
const CLI = join(ROOT, 'apps', 'cli', 'dist', 'cli.js')
const WEB_SERVER = join(ROOT, 'apps', 'cli', 'dist', 'web-server.js')

export interface Instance {
  home: string
  /** The web UI, e.g. http://127.0.0.1:51234 */
  web: string
  /** The daemon's API. */
  daemon: string
  token: string
  /** Call the daemon's API as the operator; throws on an error status. */
  api<T = unknown>(path: string, init?: { method?: string; body?: unknown }): Promise<T>
  /** One chat turn, read to the end of its stream (or left running when not awaited). */
  chat(agentId: string, message: string, options?: { questionMode?: 'web' }): Promise<string>
  /** Stop the daemon and the web server and start them again on the same home and ports. */
  restart(): Promise<void>
  /** Stop both; a scratch home is removed. */
  stop(): Promise<void>
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number }
      server.close(() => resolve(port))
    })
  })
}

async function waitFor(
  url: string,
  ok: (status: number) => boolean,
  what: string,
  log: () => string,
) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (ok(response.status)) return
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`${what} did not start at ${url}:\n${log().slice(-3000)}`)
}

/** Each child leads its own process group: `bazilion serve` runs the daemon as its child. */
function stopGroup(child: ChildProcess | undefined): Promise<void> {
  if (!child?.pid || child.exitCode !== null) return Promise.resolve()
  const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    return Promise.resolve()
  }
  const timer = setTimeout(() => {
    try {
      if (child.pid) process.kill(-child.pid, 'SIGKILL')
    } catch {}
  }, 5_000)
  return closed.finally(() => clearTimeout(timer))
}

export async function startInstance({
  modelUrl,
  home: given,
  env = {},
}: {
  /** The stand-in model server's base URL (…/v1), served as LM Studio. */
  modelUrl: string
  /** A home to use (kept afterwards); a new scratch home otherwise (removed by stop). */
  home?: string
  env?: Record<string, string>
}): Promise<Instance> {
  if (!existsSync(CLI) || !existsSync(WEB_SERVER))
    throw new Error('the built CLI is missing: run `pnpm build` first')
  const home = given ?? realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-e2e-')))
  const daemonPort = await freePort()
  const webPort = await freePort()
  const daemon = `http://127.0.0.1:${daemonPort}`
  const web = `http://127.0.0.1:${webPort}`
  let output = ''
  const children: ChildProcess[] = []
  const start = (args: string[], extra: Record<string, string>) => {
    const child = spawn(process.execPath, args, {
      cwd: home,
      env: {
        ...process.env,
        BAZILION_HOME: home,
        BAZILION_SCHEDULER: 'off',
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        LMSTUDIO_URL: modelUrl,
        ...env,
        ...extra,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    child.stdout?.on('data', (chunk) => {
      output += chunk
    })
    child.stderr?.on('data', (chunk) => {
      output += chunk
    })
    children.push(child)
    return child
  }

  const boot = async () => {
    start([CLI, 'serve', '--port', String(daemonPort)], { PORT: String(daemonPort) })
    await waitFor(
      `${daemon}/api/health`,
      (status) => status === 200 || status === 401,
      'the daemon',
      () => output,
    )
    start([WEB_SERVER], {
      BAZILION_DAEMON: daemon,
      WEB_HOST: '127.0.0.1',
      WEB_PORT: String(webPort),
    })
    await waitFor(
      `${web}/login`,
      (status) => status === 200,
      'the web server',
      () => output,
    )
  }
  await boot()
  const token = (JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')) as { token: string })
    .token
  const headers = { authorization: `Bearer ${token}` }

  const instance: Instance = {
    home,
    web,
    daemon,
    token,
    async api<T>(path: string, init: { method?: string; body?: unknown } = {}) {
      const response = await fetch(`${daemon}${path}`, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers: {
          ...headers,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
      const text = await response.text()
      if (!response.ok)
        throw new Error(`${init.method ?? 'GET'} ${path}: ${response.status} ${text.slice(0, 300)}`)
      return (text ? JSON.parse(text) : undefined) as T
    },
    async chat(agentId, message, options = {}) {
      const response = await fetch(`${daemon}/api/agents/${agentId}/chat`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ message, attachments: [], ...options }),
      })
      const text = await response.text()
      if (!response.ok) throw new Error(`chat ${agentId}: ${response.status} ${text.slice(0, 300)}`)
      return text
    },
    async restart() {
      await Promise.all(children.splice(0).map(stopGroup))
      await boot()
    },
    async stop() {
      await Promise.all(children.splice(0).map(stopGroup))
      if (!given) rmSync(home, { recursive: true, force: true })
    },
  }
  return instance
}

/** Connect LM Studio (the stand-in) and choose its model, as Setup's first run does. */
export async function connectStandIn(instance: Instance, model: string): Promise<void> {
  await instance.api('/api/config/providers/lmstudio/enabled', {
    method: 'PUT',
    body: { enabled: true },
  })
  await instance.api('/api/config/providers/lmstudio/models', {
    method: 'PUT',
    body: { models: [model] },
  })
}
