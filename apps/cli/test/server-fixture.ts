import { type ChildProcess, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openDb,
  providerModelRepo,
  providerStateRepo,
  registerTeam,
  resolvePaths,
  runMigrations,
  webTokenRepo,
} from '../../daemon/src/core/index.ts'
import { type CliResult, runCli } from './helpers.ts'

// Tests now boot the standalone daemon (apps/daemon/src/index.ts) — the
// authority for /api/* — instead of the Astro web app, which only renders
// pages and proxies to the daemon. tsx loader keeps the source-mode
// invocation matching `bazilion serve`.
const daemonEntry = join(import.meta.dirname, '..', '..', 'daemon', 'src', 'index.ts')

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.listen(0, () => {
      const addr = srv.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('unexpected server address'))
        return
      }
      const port = addr.port
      srv.close((err) => (err ? reject(err) : resolve(port)))
    })
    srv.on('error', reject)
  })
}

/**
 * Create a fresh `~/.bazilion`-shaped home: tempdir + subdirs + migrated db +
 * a bootstrap token row in `web_tokens` + an `auth.json` exposing the
 * plaintext for the CLI to use as a bearer. Mirrors the daemon's first-run
 * bootstrap (`apps/daemon/src/lib/ctx.ts:bootstrap`) without the subprocess
 * overhead.
 */
export interface TestServerFixtureOptions {
  /** Defaults to true because most integration tests exercise the unlocked API. */
  setupComplete?: boolean
}

function initHome(options: TestServerFixtureOptions = {}): { home: string; token: string } {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-test-'))
  const paths = resolvePaths(home)
  for (const d of [
    paths.home,
    paths.profilesDir,
    paths.agentsDir,
    paths.skillsDir,
    paths.teamsDir,
    paths.logsDir,
  ]) {
    mkdirSync(d, { recursive: true })
  }
  const db = openDb(paths.db)
  runMigrations(db)
  // Mint a bootstrap token row + write its plaintext into auth.json.
  const created = webTokenRepo.create(db, 'bootstrap', { kind: 'bootstrap' })
  writeFileSync(paths.authFile, `${JSON.stringify({ token: created.token }, null, 2)}\n`)
  if (options.setupComplete !== false) {
    // Enable lmstudio + ollama by default for test setup — the integration
    // tests mount their mock server via LMSTUDIO_URL and expect model resolution
    // to succeed. Real installs default to all providers disabled and require
    // the admin to toggle them on via /config.
    providerStateRepo.setEnabled(db, 'lmstudio', true)
    providerStateRepo.setEnabled(db, 'ollama', true)
    // Curate a placeholder model so the first-run middleware gate sees setup
    // as complete (isSetupComplete = any enabled provider has ≥1 curated model).
    // Tests that care about a specific model still override via --model.
    providerModelRepo.replace(db, 'lmstudio', ['test-model'])
    providerModelRepo.replace(db, 'ollama', ['test-model'])
    // Seed the 'default' team so spawnAgent's default-team fallback works
    // without tests having to register one first. Matches the fresh-install
    // post-first-run-setup state.
    registerTeam(db, { id: 'default', name: 'Default' }, paths)
  }
  db.close()
  return { home, token: created.token }
}

/** Test-only readiness: the endpoint must come from this child's bound-listener output. */
export async function waitForFixtureServer(
  proc: ChildProcess,
  token: string,
  timeoutMs = 20_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs
  const url = await new Promise<string>((resolve, reject) => {
    if (!proc.stdout) return reject(new Error('fixture stdout pipe is unavailable'))
    let output = ''
    const finish = (error?: Error, endpoint?: string) => {
      clearTimeout(timer)
      proc.stdout?.removeListener('data', onData)
      proc.removeListener('close', onClose)
      proc.removeListener('error', onError)
      proc.stdout?.resume()
      if (error) reject(error)
      else resolve(endpoint as string)
    }
    const onData = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-65_536)
      // Require the complete line; a chunk ending mid-port is not an endpoint.
      const match = /(?:^|\n)bazilion daemon listening at (http:\/\/127\.0\.0\.1:(\d+))\r?\n/.exec(
        output,
      )
      if (match && Number(match[2]) > 0 && Number(match[2]) <= 65_535) finish(undefined, match[1])
    }
    const onClose = () =>
      finish(new Error(`fixture exited before publishing its listener: ${output}`))
    const onError = (error: Error) => finish(error)
    const timer = setTimeout(
      () => finish(new Error(`fixture listener deadline exceeded: ${output}`)),
      timeoutMs,
    )
    proc.stdout.on('data', onData)
    proc.once('close', onClose)
    proc.once('error', onError)
    if (proc.exitCode !== null || proc.signalCode !== null) onClose()
  })
  // Authentication failure is not liveness and is never retried as startup success.
  const response = await fetch(`${url}/api/auth/whoami`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(Math.max(1, deadline - Date.now())),
    redirect: 'error',
  })
  if (response.status !== 200)
    throw new Error(`fixture owner authentication failed: HTTP ${response.status}`)
  const owner = (await response.json()) as {
    authenticated?: boolean
    principal?: { kind?: string }
  }
  if (owner.authenticated !== true || owner.principal?.kind !== 'bootstrap')
    throw new Error('fixture owner authentication returned an unexpected principal')
  if (proc.exitCode !== null || proc.signalCode !== null)
    throw new Error('fixture exited during owner authentication')
  return url
}

export interface TestServer {
  home: string
  url: string
  token: string
  /** Run the CLI as a subprocess against this test server. */
  cli(args: string[], extraEnv?: NodeJS.ProcessEnv): Promise<CliResult>
  /**
   * Wipe per-test state (DB rows + on-disk profiles/agents/skills/teams dirs)
   * so the same daemon process can host multiple tests. Lets test files use
   * `beforeAll(start)` + `beforeEach(reset)` instead of paying daemon cold
   * start per test. The server's cached DB handle reads the post-reset state
   * immediately because SQLite WAL + same file. Preserves the bootstrap
   * web_tokens row so the CLI's bearer keeps working across tests.
   */
  reset(): void
  stop(options?: { keepHome?: boolean; signal?: NodeJS.Signals }): Promise<void>
}

const WIPE_SQL = `
  DELETE FROM web_sessions;
  DELETE FROM web_tokens WHERE kind != 'bootstrap';
  DELETE FROM agent_loop_break_events;
  DELETE FROM agent_lesson_proposals;
  DELETE FROM agent_reviews;
  DELETE FROM team_policy_block_events;
  DELETE FROM source_slot_bindings;
  DELETE FROM template_instantiations;
  DELETE FROM team_policy_edges;
  DELETE FROM team_agent_state;
  DELETE FROM team_template_edges;
  DELETE FROM team_template_slots;
  DELETE FROM team_template_revisions;
  DELETE FROM team_templates;
  DELETE FROM messages;
  DELETE FROM agent_triggers;
  DELETE FROM agent_skills;
  DELETE FROM agents;
  DELETE FROM profile_default_skills;
  DELETE FROM profiles;
  DELETE FROM teams;
  DELETE FROM skill_meta;
  DELETE FROM provider_models;
  DELETE FROM provider_state;
  DELETE FROM secrets;
  DELETE FROM config;
`

function resetHome(home: string): void {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  db.raw.exec(WIPE_SQL)
  // Re-enable lmstudio + ollama the same way initHome does — tests that mount
  // mock providers expect these enabled.
  providerStateRepo.setEnabled(db, 'lmstudio', true)
  providerStateRepo.setEnabled(db, 'ollama', true)
  // Re-curate the placeholder model so the first-run gate stays open.
  providerModelRepo.replace(db, 'lmstudio', ['test-model'])
  providerModelRepo.replace(db, 'ollama', ['test-model'])
  // Wipe + re-create the teams directory so the auto-seeded slot is fresh.
  rmSync(paths.teamsDir, { recursive: true, force: true })
  mkdirSync(paths.teamsDir, { recursive: true })
  registerTeam(db, { id: 'default', name: 'Default' }, paths)
  db.close()
  for (const dir of [paths.profilesDir, paths.agentsDir, paths.skillsDir]) {
    rmSync(dir, { recursive: true, force: true })
    mkdirSync(dir, { recursive: true })
  }
}

/**
 * Spawns the daemon on a free port with BAZILION_HOME pointing at a fresh
 * tempdir. Resolves once the server answers HTTP. Call `stop()` to kill the
 * process and clean up the tempdir.
 *
 * Additional env vars can be passed (e.g. `LMSTUDIO_URL` pointing at a mock
 * provider) — they're merged into the server's env.
 */
export async function startTestServer(
  extraServerEnv: NodeJS.ProcessEnv = {},
  fixtureOptions: TestServerFixtureOptions = {},
): Promise<TestServer> {
  const { home, token } = initHome(fixtureOptions)
  return bootTestServer(home, token, extraServerEnv)
}

/** Restart an already-stopped disposable fixture without reseeding or rewriting its identity. */
export function restartTestServer(
  previous: Pick<TestServer, 'home' | 'token'>,
  extraServerEnv: NodeJS.ProcessEnv = {},
): Promise<TestServer> {
  return bootTestServer(previous.home, previous.token, extraServerEnv, true)
}

async function bootTestServer(
  home: string,
  token: string,
  extraServerEnv: NodeJS.ProcessEnv,
  preserveOnFailure = false,
): Promise<TestServer> {
  // Let the owned listener allocate its port atomically. Closing a parent-side
  // free-port probe before spawn permits another parallel fixture to claim it.
  // Opt-in diagnostics for disposable test daemons only, never the operator daemon.
  // Ephemeral ports can be reused during a serial gate; never overwrite/collide with prior logs.
  const stderrDir = process.env.BAZILION_TEST_DAEMON_STDERR_DIR
  const stderrFd = stderrDir
    ? openSync(join(stderrDir, `fixture-${randomUUID()}.stderr.log`), 'wx', 0o600)
    : undefined
  const proc: ChildProcess = spawn('node', ['--import', 'tsx/esm', daemonEntry], {
    env: {
      ...process.env,
      ...extraServerEnv,
      BAZILION_HOME: home,
      HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', stderrFd ?? 'ignore'],
  })
  if (stderrFd !== undefined) closeSync(stderrFd)

  const closed = new Promise<void>((resolve) => proc.once('close', () => resolve()))
  let url: string
  try {
    url = await waitForFixtureServer(proc, token)
  } catch (err) {
    proc.kill()
    await closed
    if (!preserveOnFailure) rmSync(home, { recursive: true, force: true })
    throw err
  }

  return {
    home,
    url,
    token,
    cli(args, extraEnv = {}) {
      return runCli(args, home, {
        BAZILION_SERVER: url,
        BAZILION_TOKEN: token,
        ...extraEnv,
      })
    },
    reset() {
      resetHome(home)
    },
    async stop(options = {}) {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill(options.signal ?? 'SIGTERM')
      const timer = setTimeout(() => {
        if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
      }, 5_000)
      try {
        await closed
      } finally {
        clearTimeout(timer)
      }
      if (!options.keepHome) await rmWithRetry(home)
    },
  }
}

/** Stop a protected fixture without erasing unresolved writers, bind sources or receipts. */
export async function stopSettledTestServer(server: TestServer): Promise<void> {
  await server.stop({ keepHome: true })
  const db = openDb(resolvePaths(server.home).db)
  let writers: number | undefined
  try {
    writers = db.raw
      .query<{ count: number }, []>('SELECT count(*) AS count FROM workspace_writers')
      .get()?.count
  } finally {
    db.close()
  }
  if (writers !== 0) {
    console.warn(`[protected fixture] retained unconfirmed workspace/receipts: ${server.home}`)
    throw new Error('protected fixture cleanup requires confirmed workspace settlement')
  }
  await rmWithRetry(server.home)
}

/**
 * Windows keeps handles open past process exit (AV scanning, late watchers),
 * so an immediate recursive rm can fail with EPERM/EBUSY/ENOTEMPTY. Retry a
 * few times with backoff before giving up — the fixture owns this temp dir.
 */
async function rmWithRetry(target: string, attempts = 10): Promise<void> {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      rmSync(target, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (attempt === attempts || !['EPERM', 'EBUSY', 'ENOTEMPTY', 'EACCES'].includes(code ?? '')) {
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, attempt * 1_000))
    }
  }
}
