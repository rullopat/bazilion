import { readFileSync } from 'node:fs'
import { parse as parseYaml } from 'yaml'

/**
 * Standard agent-skill frontmatter. Required fields are typed; the rest is open
 * (skill formats may add fields like `allowed-tools`, `homepage`, etc.).
 */
export interface SkillFrontmatter {
  name: string
  description: string
  [key: string]: unknown
}

export interface ParsedSkill {
  frontmatter: SkillFrontmatter
  body: string
  raw: string
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

export function parseSkillContent(raw: string): ParsedSkill {
  const m = raw.match(FRONTMATTER_RE)
  if (!m) {
    throw new Error('SKILL.md missing YAML frontmatter (expected leading "---")')
  }
  const yamlBlock = m[1] ?? ''
  const body = m[2] ?? ''

  let fm: unknown
  try {
    fm = parseYaml(yamlBlock)
  } catch (err) {
    throw new Error(`SKILL.md frontmatter is not valid YAML: ${(err as Error).message}`)
  }
  if (!fm || typeof fm !== 'object' || Array.isArray(fm)) {
    throw new Error('SKILL.md frontmatter must be a YAML object')
  }
  const fmObj = fm as Record<string, unknown>
  if (typeof fmObj.name !== 'string' || fmObj.name.length === 0) {
    throw new Error('SKILL.md frontmatter missing required "name"')
  }
  if (typeof fmObj.description !== 'string' || fmObj.description.length === 0) {
    throw new Error('SKILL.md frontmatter missing required "description"')
  }
  return { frontmatter: fmObj as SkillFrontmatter, body, raw }
}

export function parseSkillFile(path: string): ParsedSkill {
  const raw = readFileSync(path, 'utf8')
  return parseSkillContent(raw)
}
