// A Team's day: its Agents' hand-offs and replies, delivered files, the conversations they worked
// in and what waits for the operator, since a moment (the start of the day the caller lives in).
// Read from what is already kept: messages, results, conversation files and the waiting registries.

import { statSync } from 'node:fs'
import { join } from 'node:path'
import {
  messageText,
  questionTitle,
  type TeamDayEvent,
  type TeamDayResponse,
} from '@bazilion/api-types'
import type { BazilionDb } from '../core/db/client.ts'
import type { Paths } from '../core/paths.ts'
import * as agentRepo from '../core/repos/agents.ts'
import * as conversations from '../core/repos/conversations.ts'
import * as messageRepo from '../core/repos/messages.ts'
import * as results from '../core/repos/results.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { questionRegistry } from './questions.ts'

/** The list a day shows at most; the rest is counted as `truncated`. */
export const TEAM_DAY_MAX = 200
// How much of each source is read: a busier day says it is incomplete (`truncated`).
const MESSAGES_READ = 500
const RESULTS_READ = 100
const CONVERSATION_PAGES = 10
const LINE = 240

const line = (text: string) => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > LINE ? `${flat.slice(0, LINE - 1)}…` : flat
}

export function teamDay(
  db: BazilionDb,
  paths: Paths,
  teamId: string,
  since: number,
): TeamDayResponse {
  const everyone = agentRepo.list(db, { includeArchived: true })
  const name = new Map(everyone.map((agent) => [agent.id, agent.name]))
  const members = everyone.filter((agent) => agent.teamId === teamId && agent.status !== 'archived')
  const member = new Set(members.map((agent) => agent.id))
  const events: TeamDayEvent[] = []
  // A source read up to its limit while still inside the day may have left some of it out.
  let missed = false
  const fullDay = (items: Array<{ createdAt: number }>, limit: number) =>
    items.length >= limit && items.every((item) => item.createdAt >= since)

  const messages = messageRepo.listForTeam(db, teamId, MESSAGES_READ)
  if (fullDay(messages, MESSAGES_READ)) missed = true
  for (const message of messages) {
    if (message.createdAt < since) continue
    events.push({
      at: message.createdAt,
      kind: message.replyTo ? 'reply' : 'handoff',
      agentId: message.fromAgentId,
      agentName: name.get(message.fromAgentId) ?? message.fromAgentId,
      otherAgentId: message.toAgentId,
      otherAgentName: name.get(message.toAgentId) ?? message.toAgentId,
      text: line(messageText(message.payload)),
    })
  }

  const delivered = results.list(db, { teamId, limit: RESULTS_READ }).results
  if (fullDay(delivered, RESULTS_READ)) missed = true
  for (const result of delivered) {
    if (result.createdAt < since) continue
    events.push({
      at: result.createdAt,
      kind: 'file',
      agentId: result.agentId,
      agentName: name.get(result.agentId) ?? result.agentId,
      text: result.name,
      resultId: result.id,
      conversationId: result.sessionId,
    })
  }

  // A conversation counts once, at the last time its history was written today. They are listed by
  // when they began, so one begun long ago and continued today can be on any page.
  for (const agent of members) {
    const all: Array<{ id: string; title: string }> = []
    for (let page = 0; page < CONVERSATION_PAGES; page++) {
      const { conversations: batch, total } = conversations.list(db, agent.id, 100, page * 100)
      all.push(...batch)
      if (all.length >= total || batch.length === 0) break
      if (page === CONVERSATION_PAGES - 1) missed = true
    }
    for (const conversation of all) {
      let at: number
      try {
        at = Math.floor(
          statSync(join(paths.agentDir(agent.id), 'sessions', `${conversation.id}.jsonl`)).mtimeMs,
        )
      } catch {
        continue
      }
      if (at < since) continue
      events.push({
        at,
        kind: 'worked',
        agentId: agent.id,
        agentName: agent.name,
        text: conversation.title,
        conversationId: conversation.id,
      })
    }
  }

  for (const question of questionRegistry.list()) {
    if (!member.has(question.agentId)) continue
    events.push({
      at: question.createdAt,
      kind: 'question',
      agentId: question.agentId,
      agentName: name.get(question.agentId) ?? question.agentId,
      text: line(questionTitle(question.question)),
      conversationId: question.conversationId,
    })
  }
  for (const approval of commandApprovalRegistry.list()) {
    if (!member.has(approval.agentId)) continue
    events.push({
      at: approval.createdAt,
      kind: 'approval',
      agentId: approval.agentId,
      agentName: name.get(approval.agentId) ?? approval.agentId,
      text: line(approval.command),
    })
  }

  events.sort((a, b) => b.at - a.at)
  return {
    teamId,
    since,
    events: events.slice(0, TEAM_DAY_MAX),
    truncated: missed || events.length > TEAM_DAY_MAX,
  }
}

/** The start of today on this machine, the default for a caller that does not say. */
export function startOfToday(now = new Date()): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
}
