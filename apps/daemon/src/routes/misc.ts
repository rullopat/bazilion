// Single-route resources: /api/health, /api/backup, /api/tokens.

import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  CreateTokenRequest,
  CreateTokenResponse,
  HealthReport,
  ListTokensResponse,
  PublicHealthResponse,
} from '@bazilion/api-types'
import {
  agentRepo,
  discoverSkills,
  mergeSecretsIntoEnv,
  parseSkillFile,
  profileRepo,
  teamRepo,
  webSessionRepo,
  webTokenRepo,
} from '../core/index.ts'
import { isProviderConfigured, PROVIDERS } from '../core/providers.ts'
import { createBackupArchive, createBackupSnapshot } from '../lib/backup.ts'
import { getCtx } from '../lib/ctx.ts'
import { hasOpenAICodexCredentials } from '../runtime/index.ts'
import { checkDockerImage } from '../runtime/shell/docker.ts'
import { resolveShellSecurityConfig } from '../runtime/shell/security.ts'
import { jsonBody, newRouter } from './http.ts'

export const miscRouter = newRouter()

// Minimal unauthenticated liveness; all operator diagnostics are protected.
miscRouter.get('/health', (c) => {
  return c.json({ ok: true } satisfies PublicHealthResponse)
})

miscRouter.get('/health/details', async (c) => {
  const { paths } = getCtx()

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
    } catch {
      database = { ok: false, error: 'Database diagnostics are unavailable.' }
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
  let codexConnected = false
  if (pathChecks.auth && pathChecks.db) {
    try {
      const { db, authToken } = getCtx()
      effectiveEnv = mergeSecretsIntoEnv(db, authToken)
      codexConnected = hasOpenAICodexCredentials(db, authToken)
    } catch {
      // first-run / partially-initialized — fall through with bare env
    }
  }
  const openclawSkillsDir = join(homedir(), '.openclaw', 'skills')

  const providerSection: HealthReport['providers'] = {
    // Hosted providers with credentials; local servers are reported below.
    configured: PROVIDERS.filter((provider) =>
      provider.id === 'openai-codex'
        ? codexConnected
        : !provider.local && isProviderConfigured(provider.id, effectiveEnv),
    ).map((provider) => provider.id),
    lmstudio: {
      customEndpointConfigured: Boolean(effectiveEnv.LMSTUDIO_URL?.trim()),
      keyConfigured: Boolean(effectiveEnv.LMSTUDIO_API_KEY),
    },
    ollama: { customEndpointConfigured: Boolean(effectiveEnv.OLLAMA_URL?.trim()) },
  }

  let shellSecurity: HealthReport['shellSecurity']
  try {
    const shellConfig = resolveShellSecurityConfig(effectiveEnv)
    // The sandbox applies to every turn, so Docker readiness matters only when it is selected.
    const docker =
      shellConfig.sandboxMode === 'docker' ? await checkDockerImage(shellConfig.sandboxImage) : null
    shellSecurity = {
      ok: true,
      sandboxMode: shellConfig.sandboxMode,
      approvalMode: shellConfig.approvalMode,
      sandboxImage: shellConfig.sandboxImage,
      hostCodingTools: shellConfig.sandboxMode === 'off',
      network: shellConfig.sandboxMode === 'docker' ? 'none' : 'host',
      docker: docker
        ? docker.ok
          ? { ready: true, image: shellConfig.sandboxImage, reason: null, remediation: null }
          : {
              ready: false,
              image: shellConfig.sandboxImage,
              reason: docker.error,
              remediation: `Start Docker and make the image available locally (Bazilion never pulls it), e.g. \`docker pull ${shellConfig.sandboxImage}\`.`,
            }
        : null,
    }
  } catch (err) {
    shellSecurity = {
      ok: false,
      error: publicShellSecurityError(err),
    }
  }

  const report: HealthReport = {
    // Structural install health; Docker readiness is reported separately under shellSecurity.
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
      braveConfigured: Boolean(effectiveEnv.BRAVE_API_KEY?.trim()),
      searxngConfigured: Boolean(effectiveEnv.SEARXNG_URL?.trim()),
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
  }
  return c.json(report)
})

function publicShellSecurityError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (message.includes('BAZILION_BASH_SANDBOX_IMAGE')) {
    return 'Docker image must use a valid local image reference.'
  }
  if (message.includes('BAZILION_BASH_APPROVAL')) {
    return 'Dangerous-command approval must be "off" or "dangerous".'
  }
  if (message.includes('BAZILION_BASH_SANDBOX')) {
    return 'Sandbox mode must be "off" or "docker".'
  }
  return 'Shell-security configuration is invalid.'
}

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
  const body = await jsonBody<CreateTokenRequest>(c)
  if (!body || typeof body.label !== 'string' || !body.label.trim()) {
    return c.json({ error: 'label is required' }, 400)
  }
  // No expiry unless asked for.
  const expiresInDays = body.expiresInDays ?? null
  if (expiresInDays !== null && (!Number.isInteger(expiresInDays) || expiresInDays < 1)) {
    return c.json({ error: 'expiresInDays must be a positive integer' }, 400)
  }
  const { db } = getCtx()
  const created = webTokenRepo.create(db, body.label.trim(), {
    expiresAt: expiresInDays ? Date.now() + expiresInDays * 86_400_000 : null,
  })
  return c.json({ token: created.token, meta: created.meta } satisfies CreateTokenResponse, 201)
})

miscRouter.delete('/tokens/:id', (c) => {
  const { db } = getCtx()
  const id = c.req.param('id')
  const existing = webTokenRepo.get(db, id)
  if (!existing) return c.json({ error: `token not found: ${id}` }, 404)
  if (existing.revokedAt) return c.json({ error: 'token already revoked' }, 409)
  // The bootstrap row (kind=bootstrap) is the token in auth.json; revoking it would lock the
  // owner out.
  if (existing.kind === 'bootstrap') {
    return c.json(
      {
        error:
          'cannot revoke the bootstrap token — it lives in ~/.bazilion/auth.json and is the local CLI loopback credential',
      },
      409,
    )
  }
  webTokenRepo.revoke(db, id)
  webSessionRepo.revokeForToken(db, id)
  return c.body(null, 204)
})
