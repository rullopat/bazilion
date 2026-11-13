// /api/skills: installed skills (list, remove, import from a path or a zip upload), and
// /api/agents/:id/skills: the skills attached to an agent.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  AttachSkillRequest,
  ImportSkillsRequest,
  ImportSkillsResponse,
  ResolvedSkillsResponse,
  SkillInfo,
  SkillScanFinding,
} from '@bazilion/api-types'
import {
  agentRepo,
  discoverSkills,
  importSkills,
  parseSkillFile,
  resolveAgentSkills,
  SkillScanBlockedError,
  scanSkillContent,
  skillMetaRepo,
} from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'
import { jsonBody, newRouter, routeAgent } from './http.ts'

// 50 MiB cap — generous headroom for a bundle of skills, tight enough to
// reject obviously-malicious payloads without needing a streaming upload.
const MAX_ZIP_BYTES = 50 * 1024 * 1024

export const skillsRouter = newRouter()

skillsRouter.get('/', (c) => {
  const { db, paths } = getCtx()
  const out: SkillInfo[] = []
  for (const s of discoverSkills(paths)) {
    const meta = skillMetaRepo.get(db, s.name)
    const entry: SkillInfo = {
      name: s.name,
      description: '',
      source: meta?.source ?? null,
      importedAt: meta?.importedAt ?? null,
    }
    try {
      const parsed = parseSkillFile(s.skillFile)
      entry.description = parsed.frontmatter.description
      entry.scanFindings = scanSkillContent(parsed.raw)
    } catch (err) {
      entry.parseError = (err as Error).message
    }
    out.push(entry)
  }
  return c.json(out)
})

skillsRouter.delete('/:name', (c) => {
  const { db, paths } = getCtx()
  const name = c.req.param('name')
  // Only an installed skill directory may be removed: the name comes from the URL
  // (decoded, so it can hold "../"), never straight into a filesystem path.
  const skill = discoverSkills(paths).find((s) => s.name === name)
  if (!skill) return c.json({ error: `skill not found: ${name}` }, 404)
  rmSync(skill.dir, { recursive: true, force: true })
  skillMetaRepo.remove(db, name)
  return c.body(null, 204)
})

skillsRouter.post('/import', async (c) => {
  let input: ParsedImportInput
  try {
    input = await parseImportInput(c.req.raw)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  }

  const { db, paths } = getCtx()
  try {
    // A path or archive the operator named: its problems are bad input.
    const result = importSkills(paths, { source: input.source, force: input.force })
    const now = Date.now()
    for (const name of result.imported) {
      skillMetaRepo.upsert(db, { name, source: input.sourceLabel, importedAt: now })
    }
    const res: ImportSkillsResponse = {
      imported: result.imported,
      skipped: result.skipped,
      findings: result.findings,
    }
    return c.json(res)
  } catch (err) {
    if (err instanceof SkillScanBlockedError) {
      return c.json(
        {
          error: err.message,
          code: 'skill_scan_blocked',
          findings: flattenFindings(err.findings),
        },
        400,
      )
    }
    return c.json({ error: (err as Error).message }, 400)
  } finally {
    if (input.tempZipPath) rmSync(input.tempZipPath, { recursive: true, force: true })
  }
})

function flattenFindings(findings: Record<string, SkillScanFinding[]>): SkillScanFinding[] {
  return Object.entries(findings).flatMap(([name, items]) =>
    items.map((item) => ({
      ...item,
      message: `${name}: ${item.message}`,
    })),
  )
}

interface ParsedImportInput {
  source: string
  force: boolean
  /** when set, a temp zip was written and should be rm'd after import */
  tempZipPath: string | null
  /** label stored in skill_meta.source (e.g. "uploaded:foo.zip" for uploads) */
  sourceLabel: string
}

async function parseImportInput(request: Request): Promise<ParsedImportInput> {
  const contentType = request.headers.get('content-type') ?? ''
  if (contentType.startsWith('multipart/form-data')) {
    const form = await request.formData()
    const file = form.get('file')
    if (!(file instanceof File) || file.size === 0) {
      throw new Error('multipart upload missing "file" field')
    }
    if (file.size > MAX_ZIP_BYTES) {
      throw new Error(`zip too large: ${file.size} bytes (max ${MAX_ZIP_BYTES})`)
    }
    const filename = file.name || 'upload.zip'
    if (!filename.toLowerCase().endsWith('.zip')) {
      throw new Error('uploaded file must be a .zip archive')
    }
    const tmpDir = mkdtempSync(join(tmpdir(), 'bazilion-skill-upload-'))
    const zipPath = join(tmpDir, filename.replace(/[^\w.-]+/g, '_'))
    const buf = Buffer.from(await file.arrayBuffer())
    writeFileSync(zipPath, buf)
    const forceField = form.get('force')
    return {
      source: zipPath,
      force: forceField === 'true' || forceField === 'on' || forceField === '1',
      tempZipPath: tmpDir,
      sourceLabel: `uploaded:${filename}`,
    }
  }

  const body = (await request.json().catch(() => null)) as Partial<ImportSkillsRequest> | null
  if (!body) throw new Error('invalid JSON body')
  const { source } = body
  if (typeof source !== 'string' || !source) throw new Error('source is required')
  return {
    source: source === 'openclaw' ? join(homedir(), '.openclaw', 'skills') : source,
    force: Boolean(body.force),
    tempZipPath: null,
    sourceLabel: source,
  }
}

export const agentSkillsRouter = newRouter()

agentSkillsRouter.get('/:id/skills', (c) => {
  const { db, paths } = getCtx()
  const set = resolveAgentSkills(db, paths, routeAgent(c).id)
  return c.json({
    resolved: set.resolved.map((s) => {
      const meta = skillMetaRepo.get(db, s.name)
      return {
        name: s.name,
        description: s.parsed.frontmatter.description,
        source: meta?.source ?? null,
        importedAt: meta?.importedAt ?? null,
        scanFindings: scanSkillContent(s.parsed.raw),
      }
    }),
    missing: set.missing,
  } satisfies ResolvedSkillsResponse)
})

agentSkillsRouter.post('/:id/skills', async (c) => {
  const body = await jsonBody<AttachSkillRequest>(c)
  const skill = body?.skill
  if (typeof skill !== 'string' || !skill) return c.json({ error: 'skill is required' }, 400)
  const { db, paths } = getCtx()
  const agent = routeAgent(c)
  const discovered = discoverSkills(paths).find((s) => s.name === skill)
  if (discovered) {
    // A skill whose SKILL.md does not parse is attached anyway; it reports the parse error
    // wherever it is used.
    let findings: SkillScanFinding[] = []
    try {
      findings = scanSkillContent(parseSkillFile(discovered.skillFile).raw)
    } catch {}
    if (findings.length > 0 && !body?.allowFindings) {
      return c.json(
        {
          error: `skill scan blocked attach: ${skill} has findings`,
          code: 'skill_scan_blocked',
          findings,
        },
        400,
      )
    }
  }
  agentRepo.attachSkill(db, agent.id, skill)
  return c.body(null, 204)
})

agentSkillsRouter.delete('/:id/skills/:name', (c) => {
  agentRepo.detachSkill(getCtx().db, routeAgent(c).id, c.req.param('name'))
  return c.body(null, 204)
})
