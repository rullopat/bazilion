import {
  OUTSIDE_TEAM,
  type TeamPolicy,
  type TeamPolicyEdge,
  type TeamPolicyMode,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'
import { DomainError } from '../errors.ts'
import * as agentRepo from './agents.ts'

/** A policy edit naming a non-member, a malformed edge or an unknown mode. */
class InvalidTeamPolicyError extends DomainError {
  constructor(message: string) {
    super(400, message)
  }
}

export function mode(db: BazilionDb, teamId: string): TeamPolicyMode | null {
  return (
    db.raw
      .query<{ policy_mode: TeamPolicyMode }, [string]>(
        'SELECT policy_mode FROM teams WHERE id = ?',
      )
      .get(teamId)?.policy_mode ?? null
  )
}

export function edges(db: BazilionDb, teamId: string): TeamPolicyEdge[] {
  return db.raw
    .query<{ source: string; target: string }, [string]>(
      'SELECT source, target FROM team_policy_edges WHERE team_id = ? ORDER BY source, target',
    )
    .all(teamId)
    .map((row) => ({ from: row.source, to: row.target }))
}

export function hasEdge(db: BazilionDb, teamId: string, from: string, to: string): boolean {
  return (
    db.raw
      .query<{ found: number }, [string, string, string]>(
        'SELECT 1 AS found FROM team_policy_edges WHERE team_id = ? AND source = ? AND target = ?',
      )
      .get(teamId, from, to) !== null
  )
}

export function get(db: BazilionDb, teamId: string): TeamPolicy | null {
  const teamMode = mode(db, teamId)
  if (!teamMode) return null
  return {
    teamId,
    mode: teamMode,
    edges: edges(db, teamId),
    members: agentRepo
      .list(db, { includeArchived: true })
      .filter((agent) => agent.teamId === teamId),
  }
}

/** Last write wins: omitted fields keep their current value. */
export function update(
  db: BazilionDb,
  teamId: string,
  input: { mode?: TeamPolicyMode; edges?: TeamPolicyEdge[] },
): TeamPolicy {
  return db.raw.transaction(() => {
    if (!mode(db, teamId)) throw new DomainError(404, `team not found: ${teamId}`)
    if (input.mode !== undefined) {
      if (input.mode !== 'open' && input.mode !== 'restricted') {
        throw new InvalidTeamPolicyError('mode must be open or restricted')
      }
      db.raw.run('UPDATE teams SET policy_mode = ? WHERE id = ?', [input.mode, teamId])
    }
    if (input.edges !== undefined) {
      const valid = validateEdges(db, teamId, input.edges)
      db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ?', [teamId])
      insertEdges(db, teamId, valid)
    }
    const updated = get(db, teamId)
    if (!updated) throw new Error(`team not found: ${teamId}`)
    return updated
  })()
}

/** Add edges whose endpoints were already checked against the Team's members. */
export function insertEdges(db: BazilionDb, teamId: string, list: TeamPolicyEdge[]): void {
  for (const edge of list) {
    db.raw.run(
      'INSERT OR IGNORE INTO team_policy_edges (team_id, source, target) VALUES (?, ?, ?)',
      [teamId, edge.from, edge.to],
    )
  }
}

/** Drop every edge that names an Agent leaving the Team. */
export function removeAgentEdges(db: BazilionDb, teamId: string, agentId: string): void {
  db.raw.run('DELETE FROM team_policy_edges WHERE team_id = ? AND (source = ? OR target = ?)', [
    teamId,
    agentId,
    agentId,
  ])
}

function validateEdges(db: BazilionDb, teamId: string, list: unknown): TeamPolicyEdge[] {
  if (!Array.isArray(list)) throw new InvalidTeamPolicyError('edges must be an array')
  const members = new Set(
    db.raw
      .query<{ id: string }, [string]>('SELECT id FROM agents WHERE team_id = ?')
      .all(teamId)
      .map((row) => row.id),
  )
  return list.map((value, index) => {
    const edge = value as Partial<TeamPolicyEdge> | null
    if (typeof edge?.from !== 'string' || typeof edge.to !== 'string') {
      throw new InvalidTeamPolicyError(`edge ${index} needs string from and to`)
    }
    for (const end of [edge.from, edge.to]) {
      if (end !== OUTSIDE_TEAM && !members.has(end)) {
        throw new InvalidTeamPolicyError(`edge ${index}: ${end} is not a member of ${teamId}`)
      }
    }
    if (edge.from === edge.to) {
      throw new InvalidTeamPolicyError(`edge ${index} must join two different endpoints`)
    }
    return { from: edge.from, to: edge.to }
  })
}
