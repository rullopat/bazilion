import { type ChildProcess, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
function initHome(): { home: string; token: string } {
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
  db.close()
  return { home, token: created.token }
}

async function waitForHttp(url: string, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.status >= 200 && res.status < 500) return
    } catch {
      // server not yet listening
    }
    await new Promise((r) => setTimeout(r, 150))
  }
  throw new Error(`timeout waiting for ${url}`)
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
export async function startTestServer(extraServerEnv: NodeJS.ProcessEnv = {}): Promise<TestServer> {
  const { home, token } = initHome()
  const port = await findFreePort()
  const url = `http://127.0.0.1:${port}`

  const proc: ChildProcess = spawn('node', ['--import', 'tsx/esm', daemonEntry], {
    env: {
      ...process.env,
      BAZILION_HOME: home,
      HOST: '127.0.0.1',
      PORT: String(port),
      ...extraServerEnv,
    },
    stdio: 'ignore',
  })

  try {
    // /api/health is unauthenticated — perfect liveness probe. Daemon should
    // come up in well under a second; 20s is paranoia headroom.
    await waitForHttp(`${url}/api/health`, 20_000)
  } catch (err) {
    proc.kill()
    rmSync(home, { recursive: true, force: true })
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
      await new Promise<void>((resolve) => {
        proc.on('close', () => resolve())
        proc.kill(options.signal ?? 'SIGTERM')
        // Failsafe: if the process hasn't exited in 5s, force it.
        setTimeout(() => {
          if (proc.exitCode === null) proc.kill('SIGKILL')
        }, 5_000)
      })
      if (!options.keepHome) rmSync(home, { recursive: true, force: true })
    },
  }
}
