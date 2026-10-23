#!/usr/bin/env node
// BAZ-049 fresh-machine installer E2E.
//
// Guarded packed-artifact trial: npm install with scripts disabled, then only
// project-admitted dependency rebuilds, fresh-home/SSR/chat/MCP/coding/reset checks.
// This is NOT qualification of unrestricted default npm lifecycle execution.
// Local release evidence uses disposable outer containment; CI targets Ubuntu/macOS.
//
//   node scripts/installer-e2e.mjs <path-to-packed-tarball.tgz>
//
// Application trial: no real API key/provider or Docker. Dependency cache population
// is a separate declared step; BAZILION_INSTALLER_OFFLINE=1 forbids install fetching.
// The provider
// is deterministic:
//   - Linux: scripts/fake-coding-provider.mjs (BAZ-041) with
//     BAZILION_BASH_SANDBOX=off — the turn emits a coding_command executed
//     host-side, then a final answer, so the receipt path is exercised too.
//   - macOS: ordinary installed CLI/API/browser turns with the inline provider.
//   - Windows: unsupported; the explicit safe-read refusal remains tested.
//
// The website's install.sh/install.ps1 mostly ensure Node 24 (CI brings its
// own). The guarded profile checked here is: npm global install with scripts off →
// explicit admitted offline rebuilds →
// `bazilion serve` bootstraps a fresh BAZILION_HOME → CLI configures the
// provider → agent spawn → one-shot turn → `uninstall --yes` leaves the home
// reset.

import { createHash } from 'node:crypto'
import {
  closeSync,
  existsSync,
  fsyncSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { createServer as createHttpServer } from 'node:http'
import { createServer as createNetServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import {
  finalizeInstallerFixture,
  INSTALLER_BUILD_ALLOWLIST,
  InstallerProcesses,
  readBoundedText,
  runGuardedUninstall,
} from './testing/installer-process.mjs'
import { PORTABLE_CHAT_INSTRUCTION, qualifyPortableChat } from './testing/portable-chat-smoke.mjs'

const processes = new InstallerProcesses()
const spawn = (...args) => processes.spawn(...args)
const IS_LINUX = process.platform === 'linux'
const SUPPORTS_AGENT_TURNS = IS_LINUX || process.platform === 'darwin'
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

async function run(cmd, args, { env, cwd, timeoutMs = 120_000 } = {}) {
  return processes.run(
    cmd,
    args,
    {
      env: { ...process.env, ...daemonEnv(), ...env },
      cwd,
    },
    timeoutMs,
  )
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

async function waitForHealthy(child, url) {
  return processes.healthy(child, url)
}

/** Deterministic OpenAI-compatible provider: one streamed assistant reply, no tools. */
function startFinalAnswerProvider() {
  let mcpRoundTrips = 0
  let instructedTurns = 0
  const server = createHttpServer(async (request, response) => {
    if (!request.url?.includes('/chat/completions')) {
      response.writeHead(404).end()
      return
    }
    const body = []
    for await (const part of request) body.push(part)
    const payload = JSON.parse(Buffer.concat(body).toString())
    const lastUser = JSON.stringify(payload.messages.findLast((m) => m.role === 'user')?.content)
    if (lastUser?.includes('BAZ057 instructed')) {
      if (!JSON.stringify(payload).includes(PORTABLE_CHAT_INSTRUCTION)) {
        response.writeHead(400).end('repository instructions missing from actual provider request')
        return
      }
      instructedTurns++
    }
    const mcpTrial = JSON.stringify(
      payload.messages.findLast((m) => m.role === 'user')?.content,
    )?.includes('packed MCP probe')
    const toolReply = payload.messages.some(
      (m) => m.role === 'tool' && JSON.stringify(m.content)?.includes('packed MCP fixture read'),
    )
    if (
      mcpTrial &&
      (!payload.tools.some((t) => t.function.name === 'mcp__packed__foo') ||
        JSON.stringify(payload).includes('PACKED_SYNTHETIC_BEARER'))
    ) {
      response.writeHead(400).end('packed MCP declaration/credential boundary failed')
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
    if (mcpTrial && !toolReply) {
      response.write(
        `data: ${JSON.stringify(chunk({ role: 'assistant', tool_calls: [{ index: 0, id: 'packed_mcp', type: 'function', function: { name: 'mcp__packed__foo', arguments: '{}' } }] }))}\n\n`,
      )
      response.write(`data: ${JSON.stringify(chunk({}, 'tool_calls'))}\n\n`)
    } else {
      if (mcpTrial && toolReply) mcpRoundTrips++
      response.write(
        `data: ${JSON.stringify(chunk({ role: 'assistant', content: 'e2e final answer reached the transcript' }))}\n\n`,
      )
      response.write(`data: ${JSON.stringify(chunk({}, 'stop'))}\n\n`)
    }
    response.write('data: [DONE]\n\n')
    response.end()
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        model: 'e2e-stub',
        finalText: 'e2e final answer reached the transcript',
        url: `http://127.0.0.1:${server.address().port}/v1`,
        close: () =>
          new Promise((resolve, reject) => {
            server.closeAllConnections()
            server.close((error) => (error ? reject(error) : resolve()))
          }),
        get mcpRoundTrips() {
          return mcpRoundTrips
        },
        get instructedTurns() {
          return instructedTurns
        },
      })
    })
  })
}

async function startPackedMcpFixture() {
  const methods = []
  const server = createHttpServer(async (req, res) => {
    if (req.method === 'GET') {
      res.writeHead(405).end()
      return
    }
    if (req.method === 'DELETE') {
      res.writeHead(204).end()
      return
    }
    const body = []
    for await (const part of req) body.push(part)
    const message = JSON.parse(Buffer.concat(body).toString())
    methods.push(message.method)
    if (req.headers.authorization !== 'Bearer PACKED_SYNTHETIC_BEARER') {
      res.writeHead(401).end()
      return
    }
    if (message.id === undefined) {
      res.writeHead(202).end()
      return
    }
    const result =
      message.method === 'initialize'
        ? {
            protocolVersion: message.params.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: 'packed-fixture', version: '1' },
          }
        : message.method === 'tools/list'
          ? { tools: [{ name: 'foo', inputSchema: { type: 'object', properties: {} } }] }
          : { content: [{ type: 'text', text: 'packed MCP fixture read' }] }
    res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'packed-fixture' })
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    methods,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

/**
 * Linux-only phase 2: the coding-command turn. Uses a second fresh home and
 * daemon with the BAZ-041 scripted provider (coding_command round, then final
 * answer), executed host-side with the sandbox off, asserting the receipt
 * lands in `coding_commands`.
 */
async function runCodingPhase(bazilionBin) {
  const codingHome = join(fixtureRoot, 'coding-home')
  mkdirSync(codingHome)
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
    codingDaemon = spawn(
      process.execPath,
      [bazilionBin, 'serve', '--port', String(codingDaemonPort)],
      {
        env: {
          ...process.env,
          BAZILION_HOME: codingHome,
          LMSTUDIO_URL: `http://127.0.0.1:${codingProviderPort}/v1`,
          BAZILION_BASH_SANDBOX: 'off',
        },
        stdio: 'ignore',
      },
    )
    await waitForHealthy(codingDaemon, `http://127.0.0.1:${codingDaemonPort}/api/health`)
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
      const result = await run(process.execPath, [bazilionBin, ...args], { env: codingEnv })
      if (result.code !== 0)
        fail(`coding phase: bazilion ${args.join(' ')}`, result.stderr + result.stdout)
    }
    const spawned = await run(
      process.execPath,
      [bazilionBin, 'agent', 'spawn', '--profile', 'default'],
      { env: codingEnv },
    )
    const codingAgentId = spawned.stdout.match(/spawned agent (\S+)/)?.[1]
    if (spawned.code !== 0 || !codingAgentId) {
      fail('coding phase: agent spawn', spawned.stderr + spawned.stdout)
      return
    }
    const turn = await run(
      process.execPath,
      [bazilionBin, 'agent', 'chat', codingAgentId, '--message', 'run the check'],
      { env: codingEnv },
    )
    if (turn.code !== 0) {
      fail('coding phase: coding-command turn', (turn.stderr + turn.stdout).slice(0, 400))
      return
    }
    const db = new DatabaseSync(join(codingHome, 'bazilion.db'), { readOnly: true })
    try {
      const receipts = db.prepare('SELECT COUNT(*) AS count FROM coding_commands').get()
      if (!receipts || receipts.count < 1) fail('coding receipt recorded', JSON.stringify(receipts))
    } finally {
      db.close()
    }
  } finally {
    await processes.stop(codingDaemon, { graceful: true })
    await processes.stop(codingProvider)
    // The shared fixture root is removed only after all owned closes and all assertions pass.
  }
}

// CLI discovery defaults to 127.0.0.1:4321; these E2E daemons never sit
// there. Point every CLI call at this run's daemon explicitly.
let daemonPort = null
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

const fixtureRoot = mkdtempSync(join(tmpdir(), 'bazilion-installer-'))
const home = join(fixtureRoot, 'home')
mkdirSync(home)
let npmPrefix = null
let daemonLogs = ''
const captureDaemonLog = (bytes) => {
  daemonLogs = (daemonLogs + bytes.toString()).slice(-64 * 1024)
}
const expectedVersion = JSON.parse(
  readFileSync(join(import.meta.dirname, '../apps/cli/package.json'), 'utf8'),
).version
let daemon = null
let web = null
let provider = null
let portableChat = null

try {
  // Install into a controlled prefix: the runner's global prefix is not
  // reliably resolvable for child processes on Windows ('bazilion' is not
  // recognized), and `--prefix` makes the shim location deterministic on
  // every OS (<prefix>/bazilion.cmd on Windows, <prefix>/bin/bazilion else).
  // Install through npm (its own platform shim works on every runner; the
  // child shell only mangles OUR later node spawns, which go shell-less
  // through process.execPath + the installed dist/cli.js). This is the
  // guarded variant of `npm install -g` (not unrestricted lifecycle scripts), and it installs the
  // package's production dependencies — without which the bundled cli.js
  // cannot load.
  npmPrefix = join(fixtureRoot, 'npm-prefix')
  mkdirSync(npmPrefix)
  const npmCli = [
    join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  ].find((path) => existsSync(path))
  if (!npmCli)
    throw new Error('Installed npm CLI entry unavailable; do not fall back to tool-manager shims')
  const userConfig = join(fixtureRoot, 'npm-user.rc')
  const globalConfig = join(fixtureRoot, 'npm-global.rc')
  writeFileSync(userConfig, '', { mode: 0o600 })
  writeFileSync(globalConfig, '', { mode: 0o600 })
  const npmConfig = [`--userconfig=${userConfig}`, `--globalconfig=${globalConfig}`]
  const offline = process.env.BAZILION_INSTALLER_OFFLINE === '1' ? ['--offline'] : []
  step(`guarded npm install -g --ignore-scripts --prefix ${npmPrefix} ${tarball}`)
  const install = await run(
    process.execPath,
    [
      npmCli,
      ...npmConfig,
      'install',
      '-g',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--engine-strict',
      ...offline,
      '--prefix',
      npmPrefix,
      tarball,
    ],
    {
      env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' },
      timeoutMs: 600_000,
    },
  )
  if (install.code !== 0) {
    fail('guarded npm install -g', install.stderr + install.stdout)
    throw new Error('guarded install failed; retain fixture, do not execute partial install')
  }
  // npm nests modules under node_modules on Windows and lib/node_modules on
  // unix — probe both and show the layout if absent.
  const cliCandidates = [
    join(npmPrefix, 'node_modules', 'bazilion', 'dist', 'cli.js'),
    join(npmPrefix, 'lib', 'node_modules', 'bazilion', 'dist', 'cli.js'),
  ]
  const bazilionBinFound = cliCandidates.find((candidate) => existsSync(candidate))
  if (!bazilionBinFound) {
    const layout = []
    const walk = (dir, depth) => {
      if (depth > 4) return
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
  if (!bazilionBin) throw new Error('installed bin entry not found after diagnostics')
  const moduleRoot = dirname(bazilionBin)
  const packageRoot = dirname(moduleRoot)
  const nodeHeaders = resolve(dirname(process.execPath), '..')
  if (!existsSync(join(nodeHeaders, 'include/node/node.h')))
    throw new Error('Offline Node headers prerequisite missing; no header download fallback')
  const policy = readFileSync(join(import.meta.dirname, '../pnpm-workspace.yaml'), 'utf8')
    .split('allowBuilds:\n')[1]
    ?.split('minimumReleaseAgeExclude:')[0]
  const admitted = policy
    ?.split('\n')
    .filter((line) => line.trim().endsWith(': true'))
    .map((line) => line.trim().split(': ')[0].replaceAll("'", ''))
    .sort()
  if (JSON.stringify(admitted) !== JSON.stringify([...INSTALLER_BUILD_ALLOWLIST].sort()))
    throw new Error('Installer build admission differs from project positive allowlist')
  step('offline rebuild of project-admitted production dependency scripts only')
  const rebuild = await run(
    process.execPath,
    [
      npmCli,
      ...npmConfig,
      'rebuild',
      ...INSTALLER_BUILD_ALLOWLIST,
      '--offline',
      '--no-audit',
      '--no-fund',
      '--prefix',
      packageRoot,
    ],
    {
      env: {
        PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1',
        npm_config_nodedir: nodeHeaders,
        npm_config_jobs: '2',
      },
      cwd: packageRoot,
      timeoutMs: 600_000,
    },
  )
  if (rebuild.code !== 0) {
    fail('admitted dependency rebuild', rebuild.stderr + rebuild.stdout)
    throw new Error('admitted rebuild failed')
  }

  const version = await run(process.execPath, [bazilionBin, '--version'])
  if (
    version.code !== 0 ||
    version.stdout.match(/\b\d+\.\d+\.\d+(?:-[^\s]+)?\b/)?.[0] !== expectedVersion
  ) {
    const distListing = existsSync(join(moduleRoot, 'dist'))
      ? readdirSync(join(moduleRoot, 'dist')).slice(0, 12).join(', ')
      : '(no dist)'
    const nodeProbe = await run(process.execPath, ['-e', 'console.log("node-probe-ok")'])
    fail(
      'bazilion --version after global install',
      `exit ${version.code}, stdout ${version.stdout.length}B, stderr ${version.stderr.length}B: ${version.stderr + version.stdout}` +
        `\n    dist: ${distListing}` +
        `\n    node probe: exit ${nodeProbe.code}, out ${nodeProbe.stdout.trim()}`,
    )
    throw new Error('Installed version check failed; no CLI replay or daemon launch')
  } else {
    console.log(`    installed bazilion ${version.stdout.trim()}`)
  }

  step(`start deterministic provider and daemon on a fresh home (${process.platform})`)
  // Ordinary turns are qualified on Linux/macOS. Git-backed coding evidence
  // retains its separate Linux-only phase and admission boundary.
  provider = await startFinalAnswerProvider()
  daemonPort = await freePort()
  daemon = spawn(process.execPath, [bazilionBin, 'serve', '--port', String(daemonPort)], {
    env: {
      ...process.env,
      BAZILION_HOME: home,
      LMSTUDIO_URL: provider.url,
      BAZILION_BASH_SANDBOX: 'off',
      BROWSER_ENABLED: 'true',
      BROWSER_HEADLESS: 'true',
      BROWSER_ALLOW_PRIVATE_NETWORK: 'false',
      BROWSER_EXECUTABLE_PATH: undefined,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  daemon.stdout.on('data', captureDaemonLog)
  daemon.stderr.on('data', captureDaemonLog)
  const posture = await waitForHealthy(daemon, `http://127.0.0.1:${daemonPort}/api/health`)

  if (posture?.auth?.required !== true) {
    fail('auth posture on fresh home', JSON.stringify(posture?.auth))
  }

  step('configure provider and curated model (first-run setup via CLI)')
  for (const args of [
    ['provider', 'enable', 'lmstudio'],
    ['provider', 'models-set', 'lmstudio', provider.model],
  ]) {
    const result = await run(process.execPath, [bazilionBin, ...args], {
      env: { BAZILION_HOME: home },
    })
    if (result.code !== 0) fail(`bazilion ${args.join(' ')}`, result.stderr + result.stdout)
  }
  const afterSetup = await (await fetch(`http://127.0.0.1:${daemonPort}/api/health`)).json()
  if (afterSetup?.auth?.setupComplete !== true) {
    fail('setup completion after provider + curated model', JSON.stringify(afterSetup?.auth))
  }

  step('packed web login renders outside the workspace dependency tree')
  const webPort = await freePort()
  web = spawn(process.execPath, [join(moduleRoot, 'web-server.js')], {
    env: {
      ...process.env,
      BAZILION_HOME: home,
      BAZILION_DAEMON: `http://127.0.0.1:${daemonPort}`,
      BAZILION_WEB_DIST: join(moduleRoot, 'web'),
      WEB_HOST: '127.0.0.1',
      WEB_PORT: String(webPort),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  web.stdout.on('data', captureDaemonLog)
  web.stderr.on('data', captureDaemonLog)
  let login
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      login = await fetch(`http://127.0.0.1:${webPort}/login`, {
        signal: AbortSignal.timeout(2_000),
      })
      break // An HTTP failure is a packaging failure, not a startup retry.
    } catch {
      if (web.exitCode !== null) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  const loginHtml = login ? await readBoundedText(login, 256 * 1024) : undefined
  if (login?.status !== 200 || !loginHtml?.includes('Open Bazilion'))
    fail('packed web login SSR', `HTTP ${login?.status ?? 'unavailable'}`)

  step('spawn an agent into the auto-created default team')
  const spawned = await run(process.execPath, [
    bazilionBin,
    'agent',
    'spawn',
    '--profile',
    'default',
    '--name',
    'e2e-probe',
  ])
  const agentId = spawned.stdout.match(/spawned agent (\S+)/)?.[1]
  if (spawned.code !== 0 || !agentId) fail('agent spawn', spawned.stderr + spawned.stdout)

  if (agentId) {
    step('packed ordinary search readiness and disablement (no provider probe)')
    const search = await run(process.execPath, [bazilionBin, 'agent', 'search', 'status', agentId])
    let searchStatus
    try {
      searchStatus = JSON.parse(search.stdout)
    } catch {
      fail('packed search status is JSON', search.stderr + search.stdout)
    }
    if (
      search.code !== 0 ||
      !['configured', 'unavailable', 'disabled'].includes(searchStatus?.state)
    )
      fail('packed search readiness', search.stderr + search.stdout)
    const disableSearch = await run(process.execPath, [
      bazilionBin,
      'config',
      'set',
      'BAZILION_WEB_SEARCH',
      'off',
    ])
    const disabledSearch = await run(process.execPath, [
      bazilionBin,
      'agent',
      'search',
      'status',
      agentId,
    ])
    if (
      disableSearch.code !== 0 ||
      disabledSearch.code !== 0 ||
      !disabledSearch.stdout.includes('"disabled"')
    )
      fail(
        'packed search disablement',
        disableSearch.stderr + disabledSearch.stderr + disabledSearch.stdout,
      )

    step('packed browser status diagnoses missing and installed executable selections')
    const missingPath = join(home, 'definitely-missing-browser-executable')
    const missingSet = await run(process.execPath, [
      bazilionBin,
      'config',
      'set',
      'BROWSER_EXECUTABLE_PATH',
      missingPath,
    ])
    if (missingSet.code !== 0)
      fail('set missing browser path', missingSet.stderr + missingSet.stdout)
    const missing = await run(process.execPath, [
      bazilionBin,
      'agent',
      'browser',
      'status',
      agentId,
    ])
    let missingStatus
    try {
      missingStatus = JSON.parse(missing.stdout)
    } catch {
      fail('packed missing-browser status is JSON', missing.stderr + missing.stdout)
    }
    if (
      missing.code !== 0 ||
      missingStatus?.availability !== 'unavailable' ||
      missingStatus?.reasonCode !== 'browser_invalid_executable' ||
      !/fix or clear|correct or clear/i.test(missingStatus?.remedy ?? '')
    ) {
      fail('packed invalid-browser diagnostic', missing.stderr + missing.stdout)
    }
    const cleared = await run(process.execPath, [
      bazilionBin,
      'config',
      'rm',
      'BROWSER_EXECUTABLE_PATH',
    ])
    if (cleared.code !== 0) fail('clear missing browser path', cleared.stderr + cleared.stdout)

    const requestedBrowser = process.env.BAZILION_TEST_BROWSER_EXECUTABLE
    if (requestedBrowser) {
      if (!existsSync(requestedBrowser)) {
        fail('requested installed browser exists', requestedBrowser)
      } else {
        const selected = await run(process.execPath, [
          bazilionBin,
          'config',
          'set',
          'BROWSER_EXECUTABLE_PATH',
          requestedBrowser,
        ])
        if (selected.code !== 0)
          fail('set installed browser path', selected.stderr + selected.stdout)
      }
    }
    const available = await run(process.execPath, [
      bazilionBin,
      'agent',
      'browser',
      'status',
      agentId,
    ])
    let availableStatus
    try {
      availableStatus = JSON.parse(available.stdout)
    } catch {
      fail('packed browser availability status is JSON', available.stderr + available.stdout)
    }
    if (available.code !== 0) {
      fail('packed browser availability status', available.stderr + available.stdout)
    } else if (availableStatus?.availability === 'configured') {
      if (
        !availableStatus.selectedBrowser?.name ||
        !['headed', 'headless'].includes(availableStatus.selectedBrowser?.mode) ||
        !['configured', 'installed', 'bundled'].includes(availableStatus.selectedBrowser?.source)
      ) {
        fail('packed installed-browser diagnostic has selection facts', available.stdout)
      }
      if (requestedBrowser && availableStatus.selectedBrowser?.source !== 'configured') {
        fail('packed explicit installed-browser selection', available.stdout)
      }
      if (available.stdout.includes(requestedBrowser ?? '\0')) {
        fail('packed browser status does not disclose executable path', available.stdout)
      }
    } else if (
      availableStatus?.availability !== 'unavailable' ||
      availableStatus?.reasonCode !== 'browser_not_found' ||
      !/install a supported browser/i.test(availableStatus?.remedy ?? '')
    ) {
      fail('packed missing-browser discovery diagnostic', available.stdout)
    }
    if (!requestedBrowser) {
      console.log(
        availableStatus?.availability === 'configured'
          ? `    detected ${availableStatus.selectedBrowser.name} (${availableStatus.selectedBrowser.source}); no launch was attempted`
          : '    no supported browser installed; actionable browser_not_found diagnostic confirmed',
      )
    }
  }

  step('packed Pi MCP: retired SSE, encrypted HTTP credential, discovery and worker round-trip')
  const packedMcp = await startPackedMcpFixture()
  try {
    const retired = await run(process.execPath, [
      bazilionBin,
      'mcp',
      'add',
      'legacy',
      '--transport',
      'sse',
      '--url',
      packedMcp.url,
    ])
    if (retired.code === 0 || !retired.stderr.includes('legacy SSE is unsupported'))
      fail('packed SSE refusal', retired.stderr + retired.stdout)
    const added = await run(process.execPath, [
      bazilionBin,
      'mcp',
      'add',
      'packed',
      '--transport',
      'http',
      '--url',
      packedMcp.url,
      '--token',
      'PACKED_SYNTHETIC_BEARER',
    ])
    const serverId = added.stdout.trim().split(/\s+/)[0]
    if (added.code !== 0 || !serverId) fail('packed MCP add', added.stderr + added.stdout)
    else {
      const tested = await run(process.execPath, [bazilionBin, 'mcp', 'test', serverId])
      if (tested.code !== 0 || !tested.stdout.includes('foo'))
        fail('packed MCP discovery', tested.stderr + tested.stdout)
      const shown = await run(process.execPath, [bazilionBin, 'mcp', 'show', serverId])
      if (shown.stdout.includes('PACKED_SYNTHETIC_BEARER'))
        fail('packed MCP token disclosure', shown.stdout)
      if (SUPPORTS_AGENT_TURNS && agentId) {
        const mcpTurn = await run(process.execPath, [
          bazilionBin,
          'agent',
          'chat',
          agentId,
          '--message',
          'packed MCP probe: use mcp__packed__foo once',
        ])
        if (
          mcpTurn.code !== 0 ||
          !mcpTurn.stdout.includes(provider.finalText) ||
          provider.mcpRoundTrips !== 1 ||
          packedMcp.methods.filter((m) => m === 'tools/call').length !== 1
        )
          fail(
            'packed MCP worker round-trip',
            `model receipts=${provider.mcpRoundTrips}, tool POSTs=${packedMcp.methods.filter((m) => m === 'tools/call').length}, exit=${mcpTurn.code}: ${(mcpTurn.stderr + mcpTurn.stdout).slice(-1000)}`,
          )
      }
      const removed = await run(process.execPath, [bazilionBin, 'mcp', 'rm', serverId])
      if (removed.code !== 0) fail('packed MCP delete', removed.stderr + removed.stdout)
    }
  } finally {
    await packedMcp.close()
  }

  if (SUPPORTS_AGENT_TURNS) {
    step('packed owned MCP stdio: native admission, catalog and descendant retirement')
    const script = join(fixtureRoot, 'mcp-stdio-fixture.mjs')
    const pidFile = join(fixtureRoot, 'mcp-stdio-descendant.pid')
    writeFileSync(
      script,
      readFileSync(new URL('../apps/daemon/test/fixtures/mcp-stdio.mjs', import.meta.url)),
      { mode: 0o600 },
    )
    const { token } = JSON.parse(readFileSync(join(home, 'auth.json'), 'utf8'))
    const response = await fetch(`http://127.0.0.1:${daemonPort}/api/mcp-servers`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        origin: `http://127.0.0.1:${daemonPort}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        name: 'packed_stdio',
        transport: 'stdio',
        command: process.execPath,
        args: [script, pidFile],
      }),
      signal: AbortSignal.timeout(30_000),
    })
    const registered = await response.json()
    const serverId = registered.server?.id
    if (!response.ok || !serverId) {
      fail('packed owned stdio registration', `HTTP ${response.status}`)
    } else {
      try {
        const tested = await run(process.execPath, [bazilionBin, 'mcp', 'test', serverId])
        if (tested.code !== 0 || !tested.stdout.includes('foo') || !existsSync(pidFile))
          fail('packed owned stdio catalog', tested.stderr + tested.stdout)
      } finally {
        const removed = await run(process.execPath, [bazilionBin, 'mcp', 'rm', serverId])
        if (removed.code !== 0)
          fail('packed owned stdio retirement', removed.stderr + removed.stdout)
      }
    }
  }

  step('one-shot chat turn through the deterministic provider')
  const turn = await run(
    process.execPath,
    [bazilionBin, 'agent', 'chat', agentId, '--message', 'please answer with the fixed reply'],
    { env: { BAZILION_HOME: home } },
  )
  if (SUPPORTS_AGENT_TURNS) {
    if (turn.code !== 0 || !turn.stdout.includes(provider.finalText)) {
      fail('one-shot chat turn', (turn.stderr + turn.stdout).slice(0, 400))
    }
  } else {
    // Unsupported platforms remain explicitly refused; no simulated support
    // or weaker fallback is substituted for actual platform qualification.
    const output = turn.stderr + turn.stdout
    if (turn.code === 0 || !output.includes('safe_reads_unavailable')) {
      fail(
        'off-Linux turn refusal is not clean/explicit',
        `exit ${turn.code}: ${output.slice(0, 400)}`,
      )
    }
    const healthAfter = await (await fetch(`http://127.0.0.1:${daemonPort}/api/health`)).json()
    if (healthAfter?.auth?.setupComplete !== true) {
      fail('daemon unhealthy after refused turn', JSON.stringify(healthAfter?.auth))
    }
    console.log('    refused cleanly with safe_reads_unavailable (documented boundary)')
  }

  if (SUPPORTS_AGENT_TURNS && agentId) {
    step('installed empty/instructed Team turns through API, CLI and real browser UI')
    portableChat = await qualifyPortableChat({
      home,
      moduleRoot,
      daemonUrl: `http://127.0.0.1:${daemonPort}`,
      webUrl: `http://127.0.0.1:${webPort}`,
      agentId,
      finalText: provider.finalText,
      runCli: (message) =>
        run(process.execPath, [bazilionBin, 'agent', 'chat', agentId, '--message', message]),
      runDoctor: () => run(process.execPath, [bazilionBin, 'doctor']),
    })
    if (provider.instructedTurns !== 3)
      fail('three instructed turns reached the provider', `observed ${provider.instructedTurns}`)
    console.log(`    portable chat: ${JSON.stringify(portableChat)}`)
  }

  if (IS_LINUX) {
    step('linux only: coding-command turn host-side in a second fresh home')
    await runCodingPhase(bazilionBin)
  }

  step('stop the daemon and uninstall the home')
  await processes.stop(web, { graceful: true })
  await processes.stop(daemon, { graceful: true })
  await runGuardedUninstall(processes, failures, async () => {
    const uninstall = await run(process.execPath, [bazilionBin, 'uninstall', '--yes'], {
      env: { BAZILION_HOME: home },
    })
    if (uninstall.code !== 0) fail('uninstall --yes', uninstall.stderr + uninstall.stdout)
    if (existsSync(join(home, 'bazilion.db')) || existsSync(join(home, 'auth.json'))) {
      fail('home reset removes db + auth.json', `left: ${readdirSync(home).join(', ')}`)
    }
  })

  if (failures.length) process.exitCode = 1
} catch (error) {
  console.error(`installer E2E FAILED on ${process.platform}: ${error?.stack ?? error}`)
  console.error(`--- daemon output tail ---\n${daemonLogs.slice(-2_000)}`)
  process.exitCode = 1
} finally {
  const closes = await Promise.allSettled([processes.closeAll(), provider?.close()])
  const cleanupErrors = closes
    .filter((item) => item.status === 'rejected')
    .map((item) => String(item.reason))
  if (cleanupErrors.length) {
    process.exitCode = 1
    console.error('installer cleanup unconfirmed/abnormal; fixture retained', cleanupErrors)
  }
  const passed = !process.exitCode && failures.length === 0 && cleanupErrors.length === 0
  const report = {
    profile:
      'npm scripts disabled, explicit project-positive rebuilds only; not unrestricted npm install',
    artifact: {
      path: tarball,
      sha256: createHash('sha256').update(readFileSync(tarball)).digest('hex'),
      expectedVersion,
    },
    platform: process.platform,
    node: process.version,
    portableChat,
    fixtureRoot,
    passed,
    failures,
    cleanupErrors,
    ownershipLimit:
      'owned child/pipe closes; not arbitrary-descendant or abnormal-host proof; outer containment required',
    processes: processes.facts(),
    daemonTail: daemonLogs,
  }
  let evidenceFd
  try {
    await finalizeInstallerFixture(report, {
      writeEvidence: (value) => {
        evidenceFd ??= openSync(
          process.env.BAZILION_INSTALLER_EVIDENCE ?? join(fixtureRoot, 'evidence.json'),
          'wx',
          0o600,
        )
        const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
        let offset = 0
        while (offset < bytes.length) {
          const written = writeSync(evidenceFd, bytes, offset, bytes.length - offset, offset)
          if (written <= 0) throw new Error('installer evidence write made no progress')
          offset += written
        }
        ftruncateSync(evidenceFd, bytes.length)
        fsyncSync(evidenceFd)
      },
      removeFixture: () => rmSync(fixtureRoot, { recursive: true }),
    })
  } finally {
    if (evidenceFd !== undefined) closeSync(evidenceFd)
  }
  if (report.passed) {
    console.log(`\nguarded installer E2E passed on ${process.platform}; owned closes settled`)
  } else {
    process.exitCode = 1
    console.error(
      `installer fixture removal=${report.fixtureRemoval.status}: ${fixtureRoot}; failures=${failures.join(', ')}`,
      report.cleanupErrors,
    )
  }
}
