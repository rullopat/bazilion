#!/usr/bin/env node
// Smoke test of the packed CLI: install the tarball into a scratch npm prefix, check that every
// package the bundle imports is installed, serve a scratch home against a stub OpenAI-compatible
// provider, run one chat turn through the bundled worker, render the bundled web login page, then
// stop everything.
//
//   node scripts/pack-smoke.mjs <path/to/bazilion-x.y.z.tgz>

import { execFile, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { isBuiltin } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const tarball = resolve(process.argv[2] ?? '')
if (!process.argv[2] || !existsSync(tarball)) {
  console.error('usage: node scripts/pack-smoke.mjs <bazilion-x.y.z.tgz>')
  process.exit(2)
}
const expectedVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '../apps/cli/package.json'), 'utf8'),
).version
const REPLY = 'pack smoke reply'

const scratch = mkdtempSync(join(tmpdir(), 'bazilion-pack-smoke-'))
const prefix = join(scratch, 'prefix')
const home = join(scratch, 'home')
const packageDir = join(prefix, 'lib', 'node_modules', 'bazilion')
const bin = join(prefix, 'bin', 'bazilion')
/** Static and dynamic imports of a bare package name (group 1), ignoring any subpath. */
const BARE_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(?\s*)["']((?:@[\w.-]+\/)?\w[\w.-]*)(?:\/[^"']*)?["']/g
/** Long-running children, each the leader of its own process group. */
const children = []

function step(name) {
  console.log(`==> ${name}`)
}

/** Signal a child's whole process group: `bazilion serve` runs the daemon as its own child. */
function signalGroup(child, signal) {
  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    if (error.code !== 'ESRCH') throw error
  }
}

// The children are outside this process group, so an interrupted run stops them itself.
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    for (const { child } of children) if (child.pid !== undefined) signalGroup(child, 'SIGKILL')
    rmSync(scratch, { recursive: true, force: true })
    process.exit(1)
  })

/** Run a command to completion and return its stdout; a failure reports the command's stderr. */
async function run(command, args, env = {}) {
  // Asynchronous on purpose: the stub provider below is served from this process.
  const { stdout } = await execFileAsync(command, args, { env: { ...process.env, ...env } })
  return stdout
}

/** Start a long-running child and resolve with the URL it prints once it is listening. */
function startListening(command, args, env, pattern) {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  })
  // 'close' waits for every process holding the output pipes, the daemon included.
  const closed = new Promise((done) => child.once('close', done))
  children.push({ child, closed })
  let output = ''
  return new Promise((resolveUrl, reject) => {
    const fail = (error) => {
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => fail(new Error(`no listening line:\n${output}`)), 60_000)
    const onData = (chunk) => {
      output += chunk
      const url = pattern.exec(output)?.[1]
      if (url) {
        clearTimeout(timer)
        resolveUrl(url)
      }
    }
    child.stdout.on('data', onData)
    child.stderr.on('data', onData)
    child.once('error', fail)
    child.once('exit', (code) =>
      fail(new Error(`exited with ${code} before listening:\n${output}`)),
    )
  })
}

async function stop({ child, closed }) {
  if (child.pid === undefined) return
  signalGroup(child, 'SIGTERM')
  const timer = setTimeout(() => signalGroup(child, 'SIGKILL'), 10_000)
  await closed
  clearTimeout(timer)
}

// A stub OpenAI-compatible endpoint that streams one fixed assistant reply.
const provider = createServer((request, response) => {
  request.resume()
  if (request.method !== 'POST' || !request.url?.endsWith('/chat/completions')) {
    response.writeHead(404).end()
    return
  }
  const chunk = (delta, finishReason = null) =>
    `data: ${JSON.stringify({ id: 'smoke', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`
  response.writeHead(200, { 'content-type': 'text/event-stream' })
  response.end(
    `${chunk({ role: 'assistant', content: REPLY })}${chunk({}, 'stop')}data: [DONE]\n\n`,
  )
})

try {
  step(`npm install -g ${tarball}`)
  await run('npm', ['install', '-g', '--no-audit', '--no-fund', '--prefix', prefix, tarball], {
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
  })

  step('bazilion --version')
  const version = (await run(bin, ['--version'])).trim()
  if (version !== expectedVersion)
    throw new Error(`version ${version}, expected ${expectedVersion}`)

  // The web server build is split per route, so a page render alone does not load every import.
  step('every package the bundle imports is a declared, installed dependency')
  const { dependencies } = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const imported = new Set()
  for (const file of readdirSync(join(packageDir, 'dist'), { recursive: true })) {
    if (!/\.m?js$/.test(file)) continue
    const source = readFileSync(join(packageDir, 'dist', file), 'utf8')
    for (const [, name] of source.matchAll(BARE_IMPORT)) if (!isBuiltin(name)) imported.add(name)
  }
  const missing = [...imported].filter(
    (name) => !dependencies[name] || !existsSync(join(packageDir, 'node_modules', name)),
  )
  if (missing.length > 0) throw new Error(`not installed as dependencies: ${missing.join(', ')}`)

  step('bazilion serve on a fresh home')
  await new Promise((done) => provider.listen(0, '127.0.0.1', done))
  const daemonUrl = await startListening(
    bin,
    ['serve', '--port', '0'],
    {
      BAZILION_HOME: home,
      LMSTUDIO_URL: `http://127.0.0.1:${provider.address().port}/v1`,
      BAZILION_SCHEDULER: 'off',
    },
    /bazilion daemon listening at (http:\/\/\S+)\n/,
  )
  const health = await (await fetch(`${daemonUrl}/api/health`)).json()
  if (health.ok !== true) throw new Error(`unhealthy daemon: ${JSON.stringify(health)}`)

  step('configure a provider, spawn an Agent and chat through the bundled worker')
  const cli = (...args) => run(bin, args, { BAZILION_HOME: home, BAZILION_SERVER: daemonUrl })
  await cli('provider', 'enable', 'lmstudio')
  await cli('provider', 'models-set', 'lmstudio', 'smoke-model')
  const spawned = await cli('agent', 'spawn', '--profile', 'default')
  const agentId = /spawned agent (\S+)/.exec(spawned)?.[1]
  if (!agentId) throw new Error('agent spawn printed no id')
  const chat = await cli('agent', 'chat', agentId, '--message', 'hi')
  if (!chat.includes(REPLY)) throw new Error(`chat reply missing:\n${chat}`)

  step('the bundled web UI renders the login page')
  const webUrl = await startListening(
    process.execPath,
    [join(packageDir, 'dist', 'web-server.js')],
    { BAZILION_HOME: home, BAZILION_DAEMON: daemonUrl, WEB_HOST: '127.0.0.1', WEB_PORT: '0' },
    /bazilion web UI listening at (http:\/\/\S+)\n/,
  )
  const login = await fetch(`${webUrl}/login`)
  const html = await login.text()
  if (login.status !== 200 || !html.includes('Open Bazilion'))
    throw new Error(`login page: HTTP ${login.status}`)

  console.log('pack smoke test passed')
} finally {
  await Promise.all(children.map(stop))
  provider.closeAllConnections()
  provider.close()
  rmSync(scratch, { recursive: true, force: true })
}
