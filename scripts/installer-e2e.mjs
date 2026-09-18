#!/usr/bin/env node
// BAZ-049 fresh-machine installer E2E.
//
// Proves the packed CLI artifact installs, bootstraps a genuine home, serves a
// first chat turn, and uninstalls cleanly — the operator path the website
// onboards people into. Runs on the CI OS matrix (ubuntu, macos, windows).
//
//   node scripts/installer-e2e.mjs <path-to-packed-tarball.tgz>
//
// Hermetic by design: no API key, no network egress, no docker. The provider
// is deterministic:
//   - Linux: scripts/fake-coding-provider.mjs (BAZ-041) with
//     BAZILION_BASH_SANDBOX=off — the turn emits a coding_command executed
//     host-side, then a final answer, so the receipt path is exercised too.
//   - macOS/Windows: an inline final-answer-only provider, because the coding
//     pipeline is Linux-only by product boundary (BAZ-057).
//
// The website's install.sh/install.ps1 mostly ensure Node 24 (CI brings its
// own), so the product surface proven here is: `npm install -g <tarball>` →
// `bazilion serve` bootstraps a fresh BAZILION_HOME → CLI configures the
// provider → agent spawn → one-shot turn → `uninstall --yes` leaves the home
// reset.

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const IS_WIN = process.platform === 'win32'
const IS_LINUX = process.platform === 'linux'
const tarball = process.argv[2]
const failures = []

if (!tarball || !existsSync(tarball)) {
  console.error(`usage: node scripts/installer-e2e.mjs <packed-tarball.tgz> (got: ${tarball})`)
  process.exit(2)
}

function step(name) {
  console.log(`==> ${name}`)
}

function fail(name, detail) {
  failures.push(name)
  console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`)
}

function run(cmd, args, { env } = {}) {
  return new Promise((resolve) => {
    // `shell` resolves the global `bazilion` shim (bazilion.cmd) on Windows.
    const child = spawn(cmd, args, {
      env: {
        ...process.env,
        ...(globalBinDir ? { PATH: `${globalBinDir}${delimiter}${process.env.PATH}` } : {}),
        ...daemonEnv(),
        ...env,
      },
      shell: IS_WIN,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', (error) => resolve({ code: -1, stdout, stderr: `${stderr}${error}` }))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

// Killing a shell shim on Windows orphans the real child unless the tree dies.
function killTree(child) {
  if (IS_WIN) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })
}

async function waitForHealthy(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url)
      if (response.ok) return await response.json()
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`daemon did not become healthy at ${url}`)
}

/** Deterministic OpenAI-compatible provider: one assistant reply, no tools. */
function startFinalAnswerProvider() {
  const server = createServer((request, response) => {
    if (!request.url?.includes('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(
      JSON.stringify({
        id: 'e2e-final',
        object: 'chat.completion',
        choices: [
          {
            index: 0,
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'e2e final answer reached the transcript' },
          },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    )
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        model: 'e2e-stub',
        finalText: 'e2e final answer reached the transcript',
        url: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => server.close(),
      })
    })
  })
}

/** Linux: the BAZ-041 scripted provider — coding_command round, then final answer. */
function startCodingProvider() {
  return freePort().then(
    (p) =>
      new Promise((resolve, reject) => {
        const child = spawn(
          'node',
          [
            join(import.meta.dirname, 'fake-coding-provider.mjs'),
            String(p),
            'echo e2e-coding-tick',
          ],
          { stdio: 'ignore' },
        )
        child.on('error', reject)
        setTimeout(
          () =>
            resolve({
              model: 'baz041-stub',
              finalText: 'The command finished; I inspected the output.',
              url: `http://127.0.0.1:${p}/v1`,
              close: () => child.kill(),
            }),
          500,
        )
      }),
  )
}

// CLI discovery defaults to 127.0.0.1:4321; these E2E daemons never sit
// there. Point every CLI call at this run's daemon explicitly.
let daemonPort = null
let globalBinDir = null
function daemonEnv() {
  return daemonPort
    ? {
        BAZILION_HOME: home,
        BAZILION_SERVER: `http://127.0.0.1:${daemonPort}`,
        BAZILION_TOKEN: bootstrapToken(),
      }
    : { BAZILION_HOME: home }
}

function bootstrapToken() {
  return JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8')).token
}

// ─────────────────────────────────────────────────────────────────────────────

const home = mkdtempSync(join(tmpdir(), 'bazilion-e2e-'))
const daemonLogs = []
let daemon = null
let provider = null

try {
  step(`npm install -g ${tarball}`)
  const install = await run('npm', ['install', '-g', tarball])
  if (install.code !== 0) fail('npm install -g', install.stderr + install.stdout)
  // The npm global bin dir is not reliably on PATH for child processes on
  // Windows runners ('bazilion' is not recognized). Resolve the prefix and
  // prepend it for every subsequent spawn.
  const prefix = (await run('npm', ['config', 'get', 'prefix'])).stdout.trim()
  if (!prefix) fail('npm config get prefix', 'empty output')
  globalBinDir = prefix

  const version = await run('bazilion', ['--version'])
  if (version.code !== 0 || !/\d+\.\d+\.\d+/.test(version.stdout)) {
    fail('bazilion --version after global install', version.stderr + version.stdout)
  } else {
    console.log(`    installed bazilion ${version.stdout.trim()}`)
  }

  step(`start deterministic provider and daemon on a fresh home (${process.platform})`)
  provider = IS_LINUX ? await startCodingProvider() : await startFinalAnswerProvider()
  daemonPort = await freePort()
  daemon = spawn('bazilion', ['serve', '--port', String(daemonPort)], {
    env: {
      ...process.env,
      ...(globalBinDir ? { PATH: `${globalBinDir}${delimiter}${process.env.PATH}` } : {}),
      BAZILION_HOME: home,
      LMSTUDIO_URL: provider.url,
      BAZILION_BASH_SANDBOX: 'off',
    },
    shell: IS_WIN,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  daemon.stdout.on('data', (chunk) => daemonLogs.push(chunk))
  daemon.stderr.on('data', (chunk) => daemonLogs.push(chunk))
  const posture = await waitForHealthy(`http://127.0.0.1:${daemonPort}/api/health`)

  if (posture?.auth?.required !== true) {
    fail('auth posture on fresh home', JSON.stringify(posture?.auth))
  }

  step('configure provider and curated model (first-run setup via CLI)')
  for (const args of [
    ['provider', 'enable', 'lmstudio'],
    ['provider', 'models-set', 'lmstudio', provider.model],
  ]) {
    const result = await run('bazilion', args, { env: { BAZILION_HOME: home } })
    if (result.code !== 0) fail(`bazilion ${args.join(' ')}`, result.stderr + result.stdout)
  }
  const afterSetup = await (await fetch(`http://127.0.0.1:${daemonPort}/api/health`)).json()
  if (afterSetup?.auth?.setupComplete !== true) {
    fail('setup completion after provider + curated model', JSON.stringify(afterSetup?.auth))
  }

  step('spawn an agent into the auto-created default team')
  const spawned = await run('bazilion', [
    'agent',
    'spawn',
    '--profile',
    'default',
    '--name',
    'e2e-probe',
  ])
  const agentId = spawned.stdout.match(/spawned agent (\S+)/)?.[1]
  if (spawned.code !== 0 || !agentId) fail('agent spawn', spawned.stderr + spawned.stdout)

  step('one-shot chat turn through the deterministic provider')
  const turn = await run(
    'bazilion',
    ['agent', 'chat', agentId, '--message', 'please answer with the fixed reply'],
    { env: { BAZILION_HOME: home } },
  )
  if (turn.code !== 0 || !turn.stdout.includes(provider.finalText)) {
    fail('one-shot chat turn', (turn.stderr + turn.stdout).slice(0, 400))
  }
  if (IS_LINUX) {
    const receipts = new DatabaseSync(join(home, 'bazilion.db'), { readOnly: true })
      .prepare('SELECT COUNT(*) AS count FROM coding_commands')
      .get()
    if (!receipts || receipts.count < 1) fail('coding receipt recorded', JSON.stringify(receipts))
  }

  step('stop the daemon and uninstall the home')
  killTree(daemon)
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const uninstall = await run('bazilion', ['uninstall', '--yes'], { env: { BAZILION_HOME: home } })
  if (uninstall.code !== 0) fail('uninstall --yes', uninstall.stderr + uninstall.stdout)
  if (existsSync(join(home, 'bazilion.db')) || existsSync(join(home, 'auth.json'))) {
    fail('home reset removes db + auth.json', `left: ${readdirSync(home).join(', ')}`)
  }

  if (failures.length === 0) {
    console.log(`\ninstaller E2E passed on ${process.platform}`)
  } else {
    console.error(`\ninstaller E2E FAILED on ${process.platform}: ${failures.join(', ')}`)
    console.error(`--- daemon output tail ---\n${daemonLogs.join('').slice(-2_000)}`)
    process.exit(1)
  }
} catch (error) {
  console.error(`installer E2E FAILED on ${process.platform}: ${error?.stack ?? error}`)
  console.error(`--- daemon output tail ---\n${daemonLogs.join('').slice(-2_000)}`)
  process.exit(1)
} finally {
  if (daemon && daemon.exitCode === null) killTree(daemon)
  provider?.close()
  rmSync(home, { recursive: true, force: true })
}
