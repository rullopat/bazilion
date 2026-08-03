// Single-route resources: /api/health, /api/backup, /api/tokens.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateTokenRequest,
  CreateTokenResponse,
  HealthReport,
  ListTokensResponse,
} from '@bazilion/api-types'
import { Hono } from 'hono'
import {
  agentRepo,
  discoverSkills,
  mergeSecretsIntoEnv,
  parseSkillFile,
  profileRepo,
  resolvePaths,
  teamRepo,
  webTokenRepo,
} from '../core/index.ts'
import { createBackupArchive, createBackupSnapshot } from '../lib/backup.ts'
import { communicationDecisionMetrics } from '../lib/communication.ts'
import { getCtx } from '../lib/ctx.ts'
import { getDaemonInstanceId } from '../lib/daemon-liveness.ts'
import {
  TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION,
  teamPolicyEnforcementRequested,
} from '../lib/team-policy-contract.ts'
import { loadProviderConfigFromEnv } from '../runtime/index.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'

export const miscRouter = new Hono()

// /api/health — install diagnostics. Public (auth middleware whitelists it)
// so the doctor command and external probes can run without a token.
miscRouter.get('/health', (c) => {
  const instanceId = getDaemonInstanceId()
  if (instanceId) c.header('x-bazilion-daemon-instance', instanceId)
  const paths = resolvePaths()

  const pathChecks = {
    home: existsSync(paths.home),
    db: existsSync(paths.db),
    auth: existsSync(paths.authFile),
    profiles: existsSync(paths.profilesDir),
    agents: existsSync(paths.agentsDir),
    skills: existsSync(paths.skillsDir),
  }

  let database: HealthReport['database'] = null
  const triggersSection: HealthReport['triggers'] = { active: 0, disabled: 0 }
  let tokensSection: HealthReport['tokens'] = { active: 0 }
  if (pathChecks.db) {
    try {
      const { db } = getCtx()
      database = {
        ok: true,
        profiles: profileRepo.list(db).length,
        activeAgents: agentRepo.list(db).length,
        totalAgents: agentRepo.list(db, { includeArchived: true }).length,
        teams: teamRepo.list(db, paths).length,
      }
      const triggerRows = db.raw
        .query<{ enabled: number; n: number }, []>(
          'SELECT enabled, COUNT(*) AS n FROM agent_triggers GROUP BY enabled',
        )
        .all()
      for (const r of triggerRows) {
        if (r.enabled === 1) triggersSection.active = r.n
        else triggersSection.disabled = r.n
      }
      tokensSection = { active: webTokenRepo.list(db).length }
    } catch (err) {
      database = { ok: false, error: (err as Error).message }
    }
  }

  const skills = discoverSkills(paths)
  let parseErrors = 0
  for (const s of skills) {
    try {
      parseSkillFile(s.skillFile)
    } catch {
      parseErrors++
    }
  }

  let effectiveEnv: NodeJS.ProcessEnv = process.env
  let oauth: { db: import('../core/index.ts').BazilionDb; authToken: string } | undefined
  if (pathChecks.auth && pathChecks.db) {
    try {
      const { db, authToken } = getCtx()
      effectiveEnv = mergeSecretsIntoEnv(db, authToken)
      oauth = { db, authToken }
    } catch {
      // first-run / partially-initialized — fall through with bare env
    }
  }
  const providerConfig = loadProviderConfigFromEnv(effectiveEnv, oauth)
  const braveKey = effectiveEnv.BRAVE_API_KEY
  const openclawSkillsDir = join(homedir(), '.openclaw', 'skills')

  const CLOUD_KEYS: Array<[string, keyof typeof providerConfig]> = [
    ['anthropic', 'anthropic'],
    ['openai', 'openai'],
    ['google', 'google'],
    ['azure-openai', 'azureOpenai'],
    ['bedrock', 'bedrock'],
    ['google-vertex', 'googleVertex'],
    ['mistral', 'mistral'],
    ['groq', 'groq'],
    ['cerebras', 'cerebras'],
    ['xai', 'xai'],
    ['zai', 'zai'],
    ['huggingface', 'huggingface'],
    ['openrouter', 'openrouter'],
    ['vercel-ai-gateway', 'vercelAiGateway'],
  ]
  const providerSection: HealthReport['providers'] = {
    configured: CLOUD_KEYS.filter(([, key]) => providerConfig[key]).map(([name]) => name),
    lmstudio: {
      baseURL: providerConfig.lmstudio?.baseURL ?? 'http://localhost:1234/v1',
      hasKey: Boolean(providerConfig.lmstudio?.apiKey),
    },
    ollama: { baseURL: providerConfig.ollama?.baseURL ?? 'http://localhost:11434/v1' },
  }

  let shellSecurity: HealthReport['shellSecurity']
  try {
    const shellConfig = resolveShellSecurityConfig(effectiveEnv)
    shellSecurity = {
      ok: true,
      sandboxMode: shellConfig.sandboxMode,
      approvalMode: shellConfig.approvalMode,
      sandboxImage: shellConfig.sandboxImage,
      hostCodingTools: shellConfig.sandboxMode === 'off',
      network: shellConfig.sandboxMode === 'docker' ? 'none' : 'host',
    }
  } catch (err) {
    shellSecurity = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const report: HealthReport = {
    ok:
      pathChecks.home &&
      pathChecks.db &&
      pathChecks.auth &&
      pathChecks.profiles &&
      pathChecks.agents &&
      pathChecks.skills &&
      (database === null || database.ok) &&
      parseErrors === 0 &&
      shellSecurity.ok,
    home: paths.home,
    paths: pathChecks,
    database,
    skills: { installed: skills.length, parseErrors },
    providers: providerSection,
    webSearch: {
      bravePreview: braveKey ? `${braveKey.slice(0, 6)}…` : null,
      searxngUrl: effectiveEnv.SEARXNG_URL ?? null,
    },
    openclaw: {
      path: openclawSkillsDir,
      exists: existsSync(openclawSkillsDir),
    },
    triggers: triggersSection,
    tokens: tokensSection,
    scheduler: {
      enabled: process.env.BAZILION_SCHEDULER !== 'off',
      tickMs: Number(process.env.BAZILION_SCHEDULER_TICK_MS ?? 5_000),
    },
    shellSecurity,
    teamPolicyManagement: {
      contractVersion: TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION,
      enforcementRequested: teamPolicyEnforcementRequested(),
      enforcementActive:
        teamPolicyEnforcementRequested() && TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION >= 1,
      releaseReady: TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION >= 1,
      degraded: teamPolicyEnforcementRequested() && TEAM_POLICY_MANAGEMENT_CONTRACT_VERSION < 1,
      decisions: { ...communicationDecisionMetrics },
    },
  }
  return c.json(report)
})

// /api/backup — streams a tar.gz containing a consistent live SQLite snapshot
// plus the non-transient contents of $BAZILION_HOME.
miscRouter.get('/backup', async (c) => {
  const { db, paths } = getCtx()
  if (!existsSync(paths.home)) {
    return c.json({ error: `bazilion home not found at ${paths.home}` }, 404)
  }

  let snapshot: Awaited<ReturnType<typeof createBackupSnapshot>>
  try {
    snapshot = await createBackupSnapshot(db)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `could not create database snapshot: ${message}` }, 500)
  }

  let archive: ReturnType<typeof createBackupArchive>
  try {
    archive = createBackupArchive(paths, snapshot)
  } catch (error) {
    snapshot.cleanup()
    const message = error instanceof Error ? error.message : String(error)
    return c.json({ error: `could not start backup archive: ${message}` }, 500)
  }
  const iterator = archive[Symbol.asyncIterator]()

  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next()
        if (!next.done) {
          controller.enqueue(Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value))
          return
        }
        snapshot.cleanup()
        controller.close()
      } catch (error) {
        snapshot.cleanup()
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
      // Destroy without an Error: iterator.return() removes its error listener,
      // so emitting a cancellation error here could become an unhandled event.
      archive.destroy()
      snapshot.cleanup()
    },
  })

  const date = new Date().toISOString().slice(0, 10)
  return new Response(stream, {
    headers: {
      'content-type': 'application/gzip',
      'content-disposition': `attachment; filename="bazilion-backup-${date}.tar.gz"`,
      'cache-control': 'no-store',
    },
  })
})

// /api/tokens
miscRouter.get('/tokens', (c) => {
  const { db } = getCtx()
  const includeRevoked = c.req.query('includeRevoked') === '1'
  const tokens = webTokenRepo.list(db, { includeRevoked })
  return c.json({ tokens } satisfies ListTokensResponse)
})

miscRouter.post('/tokens', async (c) => {
  const body = (await c.req.json().catch(() => null)) as CreateTokenRequest | null
  if (!body || typeof body.label !== 'string' || !body.label.trim()) {
    return c.json({ error: 'label is required' }, 400)
  }
  const { db } = getCtx()
  const created = webTokenRepo.create(db, body.label.trim())
  return c.json({ token: created.token, meta: created.meta } satisfies CreateTokenResponse, 201)
})

miscRouter.delete('/tokens/:id', (c) => {
  const { db, authToken } = getCtx()
  const id = c.req.param('id')
  const existing = webTokenRepo.get(db, id)
  if (!existing) return c.json({ error: `token not found: ${id}` }, 404)
  if (existing.revokedAt) return c.json({ error: 'token already revoked' }, 409)
  // Refuse to revoke the bootstrap token — that's the plaintext in auth.json
  // the local CLI uses for loopback. Revoking it would lock the operator out
  // of their own daemon. Match by hash (label is editable, hash isn't).
  const bootstrap = webTokenRepo.findActiveByToken(db, authToken)
  if (bootstrap && bootstrap.id === id) {
    return c.json(
      {
        error:
          'cannot revoke the bootstrap token — it lives in ~/.bazilion/auth.json and is the local CLI loopback credential',
      },
      409,
    )
  }
  webTokenRepo.revoke(db, id)
  return c.body(null, 204)
})
