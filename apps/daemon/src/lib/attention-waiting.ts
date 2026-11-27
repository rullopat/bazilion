// What Agents are waiting on the operator for right now: their questions and the dangerous
// commands they want to run. Both live only in this daemon process, so Attention asks here instead
// of the database. Each lasts until it is answered, expires, or its turn ends.

import type { AttentionItem } from '@bazilion/api-types'
import { questionTitle } from '@bazilion/api-types'
import { bounded } from '../core/attention.ts'
import type { BazilionDb } from '../core/db/client.ts'
import * as agentRepo from '../core/repos/agents.ts'
import { commandApprovalRegistry } from './bash-approval.ts'
import { questionRegistry } from './questions.ts'

interface Who {
  agentId: string
  agentName?: string
  teamId?: string
  teamName?: string
}

function teamNames(db: BazilionDb): Map<string, string> {
  const rows = db.raw.query<{ id: string; name: string }, []>('SELECT id, name FROM teams').all()
  return new Map(rows.map((row) => [row.id, row.name]))
}

export function waitingAttention(db: BazilionDb): AttentionItem[] {
  const questions = questionRegistry.list()
  const approvals = commandApprovalRegistry.list()
  if (questions.length === 0 && approvals.length === 0) return []
  const agents = new Map(agentRepo.list(db).map((agent) => [agent.id, agent]))
  const teams = teamNames(db)
  const who = (agentId: string): Who => {
    const agent = agents.get(agentId)
    if (!agent) return { agentId }
    return {
      agentId,
      agentName: agent.name,
      teamId: agent.teamId,
      teamName: teams.get(agent.teamId),
    }
  }
  // The question card and the approval prompt are both in the Agent's conversation.
  const href = (agentId: string) => `/?${new URLSearchParams({ agent: agentId })}`
  const name = (entry: Who) => entry.agentName ?? 'An Agent'

  return [
    ...questions.map((question): AttentionItem => {
      const entry = who(question.agentId)
      return {
        ...entry,
        key: `agent_question:${question.id}`,
        kind: 'agent_question',
        severity: 'action_required',
        sourceId: question.id,
        occurredAt: question.createdAt,
        updatedAt: question.createdAt,
        // An action waits until it is answered.
        ...(question.expiresAt !== null ? { expiresAt: question.expiresAt } : {}),
        title: question.question.action
          ? `${name(entry)} needs you to do something`
          : `${name(entry)} is waiting for your answer`,
        diagnostic: bounded(questionTitle(question.question), 'A question'),
        href: href(question.agentId),
        acknowledgeable: false,
        acknowledgedAt: null,
      }
    }),
    ...approvals.map((approval): AttentionItem => {
      const entry = who(approval.agentId)
      const command = (approval.command.split('\n')[0] ?? '').trim()
      const risks = [...new Set(approval.risks.map((risk) => risk.message))].join(' ')
      return {
        ...entry,
        key: `command_approval:${approval.id}`,
        kind: 'command_approval',
        severity: 'action_required',
        sourceId: approval.id,
        occurredAt: approval.createdAt,
        updatedAt: approval.createdAt,
        expiresAt: approval.expiresAt,
        title: approval.tool
          ? `${name(entry)} wants to use ${approval.tool}, which needs your approval`
          : `${name(entry)} wants to run a command that needs your approval`,
        diagnostic: bounded(`${command.slice(0, 200)}${risks ? `: ${risks}` : ''}`, 'A command'),
        href: href(approval.agentId),
        acknowledgeable: false,
        acknowledgedAt: null,
      }
    }),
  ]
}
