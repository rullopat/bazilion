import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import AdmZip from 'adm-zip'
import type { Paths } from '../paths.ts'
import { parseSkillFile } from './parse.ts'

export interface ImportSkillsInput {
  /**
   * Absolute path to either:
   *   - a single skill folder (contains SKILL.md),
   *   - a parent directory containing multiple skill folders,
   *   - a `.zip` file whose top level holds one-folder-per-skill (or a single
   *     wrapping folder that holds them).
   */
  source: string
  /** overwrite existing target skills */
  force?: boolean
}

export interface ImportResult {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

/**
 * Extract a zip archive into a fresh temp dir with a zip-slip guard — every
 * entry's resolved path must stay under the extraction root. Returns both the
 * mkdtemp root (for cleanup) and the effective source path to hand to the
 * importer. When the archive is wrapped in a single top-level directory
 * (common with GitHub-style archives), we descend into it so `source` lines
 * up with the "parent-of-skill-dirs" shape the importer already understands.
 */
function extractZipSafely(zipPath: string): { root: string; effectiveSource: string } {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-skill-zip-'))
  try {
    const zip = new AdmZip(zipPath)
    for (const entry of zip.getEntries()) {
      const rawName = entry.entryName
      if (rawName.startsWith('/') || rawName.startsWith('\\')) {
        throw new Error(`zip entry has absolute path: ${rawName}`)
      }
      const resolved = resolve(root, rawName)
      if (resolved !== root && !resolved.startsWith(root + sep)) {
        throw new Error(`zip entry escapes extraction root: ${rawName}`)
      }
    }
    zip.extractAllTo(root, true)
  } catch (err) {
    rmSync(root, { recursive: true, force: true })
    throw err
  }

  // Unwrap a single top-level folder if present — the importer's
  // "source-is-a-directory" cases (single-skill dir vs. parent-of-skills dir)
  // both apply equally well to the unwrapped path.
  let effectiveSource = root
  const topEntries = readdirSync(root, { withFileTypes: true })
  if (topEntries.length === 1 && topEntries[0]?.isDirectory()) {
    effectiveSource = join(root, topEntries[0].name)
  }
  return { root, effectiveSource }
}

export function importSkills(paths: Paths, input: ImportSkillsInput): ImportResult {
  const rawSource = resolve(input.source)
  if (!existsSync(rawSource)) {
    throw new Error(`source does not exist: ${rawSource}`)
  }

  let source = rawSource
  let tempRoot: string | null = null
  const sourceStat = statSync(rawSource)
  if (sourceStat.isFile()) {
    if (!rawSource.toLowerCase().endsWith('.zip')) {
      throw new Error(`source file must be a .zip archive: ${rawSource}`)
    }
    const { root, effectiveSource } = extractZipSafely(rawSource)
    tempRoot = root
    source = effectiveSource
  } else if (!sourceStat.isDirectory()) {
    throw new Error(`source is not a directory: ${rawSource}`)
  }

  try {
    return importSkillsFromDir(paths, source, input)
  } finally {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true })
  }
}

function importSkillsFromDir(paths: Paths, source: string, input: ImportSkillsInput): ImportResult {
  const candidates: { name: string; dir: string }[] = []

  // Two shapes are accepted:
  //   1. source is itself a single skill dir (contains SKILL.md)
  //   2. source is a parent containing multiple skill dirs
  if (existsSync(join(source, 'SKILL.md'))) {
    candidates.push({ name: basename(source), dir: source })
  } else {
    const entries = readdirSync(source, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      const skillDir = join(source, e.name)
      if (!existsSync(join(skillDir, 'SKILL.md'))) continue
      candidates.push({ name: e.name, dir: skillDir })
    }
  }

  if (candidates.length === 0) {
    throw new Error(`no skills found in ${source}`)
  }

  // Validate every SKILL.md before touching the target dir.
  for (const c of candidates) {
    parseSkillFile(join(c.dir, 'SKILL.md'))
  }

  const imported: string[] = []
  const skipped: { name: string; reason: string }[] = []

  for (const c of candidates) {
    const target = join(paths.skillsDir, c.name)
    if (existsSync(target) && !input.force) {
      skipped.push({
        name: c.name,
        reason: 'already exists (use --force to overwrite)',
      })
      continue
    }
    cpSync(c.dir, target, { recursive: true, force: !!input.force })
    imported.push(c.name)
  }

  return { imported, skipped }
}
