// The activity feed: for every Agent, whether a turn runs and what its latest tool call is, what
// waits for the operator, and what it has produced. The workspace polls it instead of asking each
// Agent's queue. A running turn's step lives in memory only.

import { createHash } from 'node:crypto'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import type { ActivityStep, AgentActivity, ChatFrame } from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import * as agentRepo from '../core/repos/agents.ts'
import * as conversations from '../core/repos/conversations.ts'
import * as results from '../core/repos/results.ts'
import * as queue from '../core/repos/user-queue.ts'
import { isActiveAgent } from './agent-cancel.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { signalLiveChange } from './live-signal.ts'
import { questionRegistry } from './questions.ts'

const TARGET_CHARS = 160
/** The argument that says what a tool call works on, first match wins. */
const TARGET_KEYS = ['path', 'command', 'url', 'query', 'to', 'key', 'file'] as const

// Pinned to globalThis like the turn registry, so a split bundle still has one map.
const STEPS_KEY = Symbol.for('bazilion.activity.steps')

function steps(): Map<string, ActivityStep> {
  const holder = globalThis as unknown as Record<symbol, Map<string, ActivityStep> | undefined>
  let map = holder[STEPS_KEY]
  if (!map) {
    map = new Map()
    holder[STEPS_KEY] = map
  }
  return map
}

/** What a tool call works on, from its JSON arguments. */
export function stepTarget(rawArguments: string): string | null {
  let args: unknown
  try {
    args = JSON.parse(rawArguments)
  } catch {
    return null
  }
  if (!args || typeof args !== 'object') return null
  for (const key of TARGET_KEYS) {
    const value = (args as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) {
      const line = value.trim().split('\n')[0] ?? ''
      return line.length > TARGET_CHARS ? `${line.slice(0, TARGET_CHARS - 1)}…` : line
    }
  }
  return null
}

/** Follow a running turn's frames: its latest tool call is the Agent's current step. */
export function noteTurnFrame(agentId: string, frame: ChatFrame): void {
  if (frame.kind !== 'event' || frame.event.type !== 'tool_call') return
  steps().set(agentId, { tool: frame.event.name, target: stepTarget(frame.event.arguments) })
  signalLiveChange()
}

export function noteTurnEnd(agentId: string): void {
  steps().delete(agentId)
  signalLiveChange()
}

/** When the Agent's selected conversation last changed; null before its first turn. */
function lastActivityAt(db: BazilionDb, paths: Paths, agentId: string): number | null {
  const conversationId = conversations.selectedId(db, agentId)
  if (!conversationId) return null
  try {
    const file = join(paths.agentDir(agentId), 'sessions', `${conversationId}.jsonl`)
    return Math.floor(statSync(file).mtimeMs)
  } catch {
    return null
  }
}

// What the roster digest covers: the rows behind the workspace's lists of Teams, Agents and
// templates, from the web, the CLI or an Agent. Not what changes on its own as turns run (an
// Agent's turns since its last review, its Telegram topic, the USER.md Agents keep up to date,
// which the Team panel loads again when a turn ends).
const ROSTER_QUERIES = [
  'SELECT id, name, policy_mode, telegram_icon_color, telegram_topic_name_format FROM teams ORDER BY id',
  `SELECT id, profile_id, name, model_override, status, reasoning_level, review_enabled,
     review_every_n_turns, review_model, review_reasoning_level, team_id, telegram_icon_emoji,
     telegram_mirror_mode FROM agents ORDER BY id`,
  'SELECT id, name, updated_at FROM profiles ORDER BY id',
  'SELECT id, name, updated_at FROM team_templates ORDER BY id',
] as const

/** A short digest of the Teams, Agents and templates as they are now. */
export function rosterRevision(db: BazilionDb): string {
  const hash = createHash('sha256')
  for (const sql of ROSTER_QUERIES) {
    hash.update(JSON.stringify(db.raw.query<Record<string, unknown>, []>(sql).all()))
    hash.update('\n')
  }
  return hash.digest('hex').slice(0, 16)
}

/** One entry per Agent that is not archived. */
export function readActivity(db: BazilionDb, paths: Paths): AgentActivity[] {
  const saved = results.summaryByAgent(db)
  const questions = questionRegistry.list()
  const approvals = commandApprovalRegistry.list()
  return agentRepo.list(db).map((agent) => {
    const working = isActiveAgent(agent.id)
    const pending = queue.pendingCount(db, agent.id)
    const produced = saved.get(agent.id)
    return {
      agentId: agent.id,
      teamId: agent.teamId,
      working,
      step: working ? (steps().get(agent.id) ?? null) : null,
      questions: questions.filter((question) => question.agentId === agent.id).length,
      approvals: approvals.filter((approval) => approval.agentId === agent.id).length,
      queuePaused: queue.isPaused(db, agent.id) && pending > 0,
      followUps: pending,
      lastActivityAt: lastActivityAt(db, paths, agent.id),
      results: produced?.count ?? 0,
      lastResultAt: produced?.lastAt ?? null,
    }
  })
}
