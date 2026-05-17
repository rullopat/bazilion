// /api/skills/* — skill discovery, removal, and import (file-path or zip upload).

import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ImportSkillsRequest, ImportSkillsResponse, SkillInfo } from '@bazilion/api-types'
import { Hono } from 'hono'
import { discoverSkills, importSkills, parseSkillFile, skillMetaRepo } from '../core/index.ts'
import { getCtx } from '../lib/ctx.ts'

// 50 MiB cap — generous headroom for a bundle of skills, tight enough to
// reject obviously-malicious payloads without needing a streaming upload.
const MAX_ZIP_BYTES = 50 * 1024 * 1024

export const skillsRouter = new Hono()

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
  const dir = paths.skillDir(name)
  if (!existsSync(dir)) return c.json({ error: `skill not found: ${name}` }, 404)
  rmSync(dir, { recursive: true, force: true })
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
    const result = importSkills(paths, { source: input.source, force: input.force })
    const now = Date.now()
    for (const name of result.imported) {
      skillMetaRepo.upsert(db, { name, source: input.sourceLabel, importedAt: now })
    }
    const res: ImportSkillsResponse = { imported: result.imported, skipped: result.skipped }
    return c.json(res)
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400)
  } finally {
    if (input.tempZipPath) rmSync(input.tempZipPath, { recursive: true, force: true })
  }
})

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

  const body = (await request.json().catch(() => null)) as
    | (Partial<ImportSkillsRequest> & { from?: string })
    | null
  if (!body) throw new Error('invalid JSON body')
  const from = body.source ?? body.from
  if (typeof from !== 'string' || !from) throw new Error('source is required')
  const source = from === 'openclaw' ? join(homedir(), '.openclaw', 'skills') : from
  return {
    source,
    force: Boolean(body.force),
    tempZipPath: null,
    sourceLabel: from,
  }
}
