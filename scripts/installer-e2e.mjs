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
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
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
    const probe = createNetServer()
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

/** Deterministic OpenAI-compatible provider: one streamed assistant reply, no tools. */
function startFinalAnswerProvider() {
  const server = createHttpServer((request, response) => {
    if (!request.url?.includes('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    // pi consumes the response as an SSE stream: emit the assistant delta,
    // a terminal finish_reason, and the [DONE] sentinel.
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    const chunk = (delta, finishReason = null) => ({
      id: 'e2e-final',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta, finish_reason: finishReason }],
    })
    response.write(
      `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'e2e final answer reached the transcript' }))}\n\n`,
    )
    response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`)
    response.write('data: [DONE]\n\n')
    response.end()
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

/**
 * Linux-only phase 2: the coding-command turn. Uses a second fresh home and
 * daemon with the BAZ-041 scripted provider (coding_command round, then final
 * answer), executed host-side with the sandbox off, asserting the receipt
 * lands in `coding_commands`.
 */
async function runCodingPhase(bazilionBin) {
  const codingHome = mkdtempSync(join(tmpdir(), 'bazilion-e2e-coding-'))
  const codingProviderPort = await freePort()
  const codingDaemonPort = await freePort()
  const codingProvider = spawn(
    'node',
    [
      join(import.meta.dirname, 'fake-coding-provider.mjs'),
      String(codingProviderPort),
      'echo e2e-coding-tick',
    ],
    { stdio: 'ignore' },
  )
  let codingDaemon = null
  try {
    await new Promise((resolve) => setTimeout(resolve, 500))
    codingDaemon = spawn(bazilionBin, ['serve', '--port', String(codingDaemonPort)], {
      env: {
        ...process.env,
        BAZILION_HOME: codingHome,
        LMSTUDIO_URL: `http://127.0.0.1:${codingProviderPort}/v1`,
        BAZILION_BASH_SANDBOX: 'off',
      },
      shell: IS_WIN,
      stdio: 'ignore',
    })
    await waitForHealthy(`http://127.0.0.1:${codingDaemonPort}/api/health`)
    // Phase-2 CLI calls must reach THIS phase's daemon — the shared run()
    // helper defaults to the phase-1 daemon via daemonEnv().
    const codingEnv = {
      BAZILION_HOME: codingHome,
      BAZILION_SERVER: `http://127.0.0.1:${codingDaemonPort}`,
      BAZILION_TOKEN: JSON.parse(readFileSync(join(codingHome, 'auth.json'), 'utf8')).token,
    }
    for (const args of [
      ['provider', 'enable', 'lmstudio'],
      ['provider', 'models-set', 'lmstudio', 'baz041-stub'],
    ]) {
      const result = await run(bazilionBin, args, { env: codingEnv })
      if (result.code !== 0)
        fail(`coding phase: bazilion ${args.join(' ')}`, result.stderr + result.stdout)
    }
    const spawned = await run(bazilionBin, ['agent', 'spawn', '--profile', 'default'], {
      env: codingEnv,
    })
    const codingAgentId = spawned.stdout.match(/spawned agent (\S+)/)?.[1]
    if (spawned.code !== 0 || !codingAgentId) {
      fail('coding phase: agent spawn', spawned.stderr + spawned.stdout)
      return
    }
    const turn = await run(
      bazilionBin,
      ['agent', 'chat', codingAgentId, '--message', 'run the check'],
      { env: codingEnv },
    )
    if (turn.code !== 0) {
      fail('coding phase: coding-command turn', (turn.stderr + turn.stdout).slice(0, 400))
      return
    }
    const receipts = new DatabaseSync(join(codingHome, 'bazilion.db'), { readOnly: true })
      .prepare('SELECT COUNT(*) AS count FROM coding_commands')
      .get()
    if (!receipts || receipts.count < 1) fail('coding receipt recorded', JSON.stringify(receipts))
  } finally {
    if (codingDaemon && codingDaemon.exitCode === null) killTree(codingDaemon)
    codingProvider.kill()
    rmSync(codingHome, { recursive: true, force: true })
  }
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
  // Install into a controlled prefix: the runner's global prefix is not
  // reliably resolvable for child processes on Windows ('bazilion' is not
  // recognized), and `--prefix` makes the shim location deterministic on
  // every OS (<prefix>/bazilion.cmd on Windows, <prefix>/bin/bazilion else).
  const npmPrefix = mkdtempSync(join(tmpdir(), 'bazilion-e2e-npm-'))
  step(`npm install -g --prefix ${npmPrefix} ${tarball}`)
  const install = await run('npm', ['install', '-g', '--prefix', npmPrefix, tarball])
  if (install.code !== 0) fail('npm install -g', install.stderr + install.stdout)
  globalBinDir = npmPrefix
  // npm's shim layout differs per OS (and the shim is not on PATH for child
  // processes on Windows), so invoke the installed bin entry through node
  // directly. npm nests modules under lib/node_modules on unix and
  // node_modules on Windows — probe both and show the layout if absent.
  const cliCandidates = [
    join(npmPrefix, 'lib', 'node_modules', 'bazilion', 'dist', 'cli.js'),
    join(npmPrefix, 'node_modules', 'bazilion', 'dist', 'cli.js'),
  ]
  const bazilionBinFound = cliCandidates.find((candidate) => existsSync(candidate))
  if (!bazilionBinFound) {
    const layout = []
    const walk = (dir, depth) => {
      if (depth > 2) return
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const child = join(dir, entry.name)
        layout.push(child)
        if (entry.isDirectory()) walk(child, depth + 1)
      }
    }
    try {
      walk(npmPrefix, 0)
    } catch {
      layout.push(`(cannot list ${npmPrefix})`)
    }
    fail(
      'installed bin entry not found',
      `looked for ${cliCandidates.join(', ')}; prefix layout:\n${layout.slice(0, 60).join('\n')}`,
    )
  }
  const bazilionBin = bazilionBinFound

  const version = await run(bazilionBin, ['--version'])
  if (version.code !== 0 || !/\d+\.\d+\.\d+/.test(version.stdout)) {
    fail('bazilion --version after global install', version.stderr + version.stdout)
  } else {
    console.log(`    installed bazilion ${version.stdout.trim()}`)
  }

  step(`start deterministic provider and daemon on a fresh home (${process.platform})`)
  // Phase 1 (every OS): a final-answer-only provider — a plain chat turn,
  // which works off-Linux. The coding turn needs the Linux-only workspace
  // claim, so it runs as phase 2 in its own home (Linux only).
  provider = await startFinalAnswerProvider()
  daemonPort = await freePort()
  daemon = spawn(bazilionBin, ['serve', '--port', String(daemonPort)], {
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
    const result = await run(bazilionBin, args, { env: { BAZILION_HOME: home } })
    if (result.code !== 0) fail(`bazilion ${args.join(' ')}`, result.stderr + result.stdout)
  }
  const afterSetup = await (await fetch(`http://127.0.0.1:${daemonPort}/api/health`)).json()
  if (afterSetup?.auth?.setupComplete !== true) {
    fail('setup completion after provider + curated model', JSON.stringify(afterSetup?.auth))
  }

  step('spawn an agent into the auto-created default team')
  const spawned = await run(bazilionBin, [
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
    bazilionBin,
    ['agent', 'chat', agentId, '--message', 'please answer with the fixed reply'],
    { env: { BAZILION_HOME: home } },
  )
  if (turn.code !== 0 || !turn.stdout.includes(provider.finalText)) {
    fail('one-shot chat turn', (turn.stderr + turn.stdout).slice(0, 400))
  }

  if (IS_LINUX) {
    step('linux only: coding-command turn host-side in a second fresh home')
    await runCodingPhase(bazilionBin)
  }

  step('stop the daemon and uninstall the home')
  killTree(daemon)
  await new Promise((resolve) => setTimeout(resolve, 1_000))
  const uninstall = await run(bazilionBin, ['uninstall', '--yes'], { env: { BAZILION_HOME: home } })
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
