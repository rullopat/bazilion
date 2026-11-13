import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  initSchema,
  openDb,
  providerModelRepo,
  providerStateRepo,
  registerTeam,
  resolvePaths,
  webTokenRepo,
} from '../../daemon/src/core/index.ts'
import { type CliResult, runCli } from './helpers.ts'

// Tests boot the standalone daemon (apps/daemon/src/index.ts) — the
// authority for /api/* — not the web app, which only renders pages and
// proxies to the daemon. tsx loader keeps the source-mode invocation matching
// `bazilion serve`.
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
  ]) {
    mkdirSync(d, { recursive: true })
  }
  const db = openDb(paths.db)
  initSchema(db)
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

/** Resolve with the URL the daemon prints once it is listening on its own port. */
function waitForListening(proc: ChildProcess, timeoutMs = 20_000): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (!proc.stdout) return reject(new Error('fixture stdout pipe is unavailable'))
    let output = ''
    const finish = (error?: Error, url?: string) => {
      clearTimeout(timer)
      proc.stdout?.removeListener('data', onData)
      proc.removeListener('close', onClose)
      proc.stdout?.resume()
      if (error) reject(error)
      else resolve(url as string)
    }
    const onData = (chunk: Buffer) => {
      output += chunk.toString()
      const match = /bazilion daemon listening at (http:\/\/127\.0\.0\.1:\d+)\r?\n/.exec(output)
      if (match) finish(undefined, match[1])
    }
    const onClose = () => finish(new Error(`fixture daemon exited before listening: ${output}`))
    const timer = setTimeout(
      () => finish(new Error(`fixture daemon did not start listening: ${output}`)),
      timeoutMs,
    )
    proc.stdout.on('data', onData)
    proc.once('close', onClose)
  })
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

function resetHome(home: string): void {
  const paths = resolvePaths(home)
  const db = openDb(paths.db)
  // Empty every table except the bootstrap token row the CLI authenticates with.
  const tables = db.raw
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
  db.raw.exec('PRAGMA foreign_keys = OFF')
  for (const { name } of tables) {
    db.raw.exec(
      name === 'web_tokens'
        ? "DELETE FROM web_tokens WHERE kind != 'bootstrap'"
        : `DELETE FROM "${name}"`,
    )
  }
  db.raw.exec('PRAGMA foreign_keys = ON')
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
 * tempdir. Resolves once the daemon reports it is listening. Call `stop()` to
 * kill the process and clean up the tempdir.
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
  // PORT=0 lets the daemon pick its own port, so parallel fixtures never race for one.
  const proc: ChildProcess = spawn('node', ['--import', 'tsx/esm', daemonEntry], {
    env: {
      ...process.env,
      ...extraServerEnv,
      BAZILION_HOME: home,
      HOST: '127.0.0.1',
      PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'ignore'],
  })

  const closed = new Promise<void>((resolve) => proc.once('close', () => resolve()))
  let url: string
  try {
    url = await waitForListening(proc)
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
      if (!options.keepHome) rmSync(home, { recursive: true, force: true })
    },
  }
}
