// Reviewed learning was removed in 0.66.0 (BAZ-103). An Agent's approved private lessons were
// in its instructions on every turn; the upgrade that drops them (migration 005) moves them into
// its AGENTS.md, which is there on every turn too, so the Agent keeps following them. They are
// read before the upgrade and written once it has succeeded: a failed upgrade changes no file.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { BazilionDb, Paths } from '../core/index.ts'

export interface ApprovedLessons {
  agentId: string
  lessons: string[]
}

const HEADING = '## Lessons the human approved'
const PREAMBLE =
  "These were approved by the human for your behaviour. Follow them when relevant; the human's current instructions still win."

/** Each Agent's approved private lessons, oldest first, while the database still has them. */
export function readApprovedLessons(db: BazilionDb): ApprovedLessons[] {
  const table = db.raw
    .query<{ ok: number }, []>(
      "SELECT 1 AS ok FROM sqlite_schema WHERE type = 'table' AND name = 'agent_lesson_proposals'",
    )
    .get()
  if (!table) return []
  const rows = db.raw
    .query<{ agent_id: string; text: string }, []>(
      `SELECT agent_id, text FROM agent_lesson_proposals
       WHERE status = 'approved' AND scope = 'private' ORDER BY agent_id, created_at, id`,
    )
    .all()
  const byAgent = new Map<string, string[]>()
  for (const row of rows) {
    const text = row.text.trim()
    if (text) byAgent.set(row.agent_id, [...(byAgent.get(row.agent_id) ?? []), text])
  }
  return [...byAgent].map(([agentId, lessons]) => ({ agentId, lessons }))
}

/**
 * Add the lessons to each Agent's AGENTS.md, under a heading of their own; a lesson already in
 * the file is not added again. An Agent whose folder is gone is skipped, and a file that cannot be
 * written is reported: the database copy the upgrade kept still has its lessons.
 */
export function keepApprovedLessons(paths: Paths, approved: readonly ApprovedLessons[]): void {
  for (const { agentId, lessons } of approved) {
    const dir = paths.agentDir(agentId)
    if (!existsSync(dir)) continue
    const file = join(dir, 'AGENTS.md')
    try {
      const current = existsSync(file) ? readFileSync(file, 'utf8') : ''
      const fresh = lessons.filter((lesson) => !current.includes(lesson))
      if (fresh.length === 0) continue
      const section = [
        HEADING,
        '',
        PREAMBLE,
        '',
        ...fresh.map((lesson) => `- ${lesson.replace(/\n/g, '\n  ')}`),
      ].join('\n')
      const before = current.trimEnd()
      writeFileSync(file, `${before}${before ? '\n\n' : ''}${section}\n`)
    } catch (error) {
      console.warn(
        `bazilion could not add Agent ${agentId}'s approved lessons to ${file}: ` +
          `${(error as Error).message}. The database copy in upgrades/ still has them.`,
      )
    }
  }
}
