import { createHash, randomUUID } from 'node:crypto'
import type {
  CommunicationAuthorizationResult,
  CommunicationChannel,
  CommunicationComponentOutcome,
  CommunicationDecision,
  CommunicationEndpoint,
  CommunicationPolicyRef,
} from '@bazilion/api-types'
import type { BazilionDb } from '../db/client.ts'

export type { CommunicationChannel, CommunicationDecision, CommunicationEndpoint }

export interface AuthorizationInput {
  source: CommunicationEndpoint
  target: CommunicationEndpoint
  origin: string
  attemptKind: string
  attemptId: string
  // Boundary-only metadata ignored by policy evaluation.
  approvalPayloadKind?: string
  approvalPayload?: unknown
  requester?: string
}

export type PolicyRef = CommunicationPolicyRef
export type ComponentOutcome = CommunicationComponentOutcome
export type AuthorizationResult = CommunicationAuthorizationResult

interface AgentRow {
  id: string
  group_id: string
  status: string
}
interface HarnessRow {
  group_id: string
  revision: number
  membership_mode: string
}
interface EdgeRow {
  source_kind: string
  source_id: string
  target_kind: string
  target_id: string
  posture: 'allow' | 'approval_required'
}

function denied(channel: CommunicationChannel, code: string, reason: string): AuthorizationResult {
  return {
    decision: 'deny',
    channel,
    reasonCode: code,
    reason,
    policyRefs: [],
    componentOutcomes: [],
    matchedEdgeIds: [],
    requiredEdgeIds: [],
  }
}

function edgeId(groupId: string, sk: string, sid: string, tk: string, tid: string): string {
  return `${groupId}:${sk}:${sid || '-'}->${tk}:${tid || '-'}`
}

export function authorizeCommunication(
  db: BazilionDb,
  input: AuthorizationInput,
): AuthorizationResult {
  return db.raw.transaction(() => authorizeInSnapshot(db, input))()
}

export function authorizeInSnapshot(
  db: BazilionDb,
  input: AuthorizationInput,
): AuthorizationResult {
  const channel: CommunicationChannel =
    input.source.kind === 'user' || input.target.kind === 'user'
      ? 'user'
      : input.source.kind === 'outside_group' || input.target.kind === 'outside_group'
        ? 'outside_group'
        : 'same_group'
  if (!input.origin || !input.attemptKind || !input.attemptId)
    return denied(
      channel,
      'invalid_communication_path',
      'origin and typed attempt identity are required',
    )
  if (input.source.kind !== 'agent' && input.target.kind !== 'agent')
    return denied(
      channel,
      'invalid_communication_path',
      'a communication path must include an Agent',
    )
  if (
    input.source.kind === 'agent' &&
    input.target.kind === 'agent' &&
    input.source.id === input.target.id
  )
    return denied(
      channel,
      'invalid_communication_path',
      'self communication is not a valid policy path',
    )

  const resolveAgent = (endpoint: CommunicationEndpoint): AgentRow | null =>
    endpoint.kind === 'agent'
      ? db.raw
          .query<AgentRow, [string]>('SELECT id, group_id, status FROM agents WHERE id = ?')
          .get(endpoint.id)
      : null
  const sourceAgent = resolveAgent(input.source)
  const targetAgent = resolveAgent(input.target)
  if (input.source.kind === 'agent' && !sourceAgent)
    return denied(channel, 'agent_not_found', 'source Agent was not found')
  if (input.target.kind === 'agent' && !targetAgent)
    return denied(channel, 'agent_not_found', 'target Agent was not found')
  if (sourceAgent?.status === 'archived' || targetAgent?.status === 'archived')
    return denied(channel, 'agent_archived', 'archived Agents cannot communicate')

  const sourceGroup =
    sourceAgent?.group_id ??
    targetAgent?.group_id ??
    ('groupId' in input.source ? input.source.groupId : '')
  const targetGroup =
    targetAgent?.group_id ??
    sourceAgent?.group_id ??
    ('groupId' in input.target ? input.target.groupId : '')
  const actualChannel: CommunicationChannel =
    sourceGroup && targetGroup && sourceGroup !== targetGroup ? 'cross_group' : channel
  if (!sourceGroup || !targetGroup)
    return denied(actualChannel, 'member_not_in_group', 'endpoint is not a Group member')

  const groups = [...new Set([sourceGroup, targetGroup])]
  const harnesses = new Map<string, HarnessRow>()
  for (const group of groups) {
    const harness = db.raw
      .query<HarnessRow, [string]>(
        'SELECT group_id, revision, membership_mode FROM live_harnesses WHERE group_id = ?',
      )
      .get(group)
    if (!harness)
      return denied(actualChannel, 'group_policy_missing', `Group policy is missing for ${group}`)
    if (!['compatibility_open', 'explicit'].includes(harness.membership_mode))
      return denied(actualChannel, 'group_policy_invalid', `Group policy is invalid for ${group}`)
    harnesses.set(group, harness)
  }

  const requirements: Array<{
    groupId: string
    sk: string
    sid: string
    tk: string
    tid: string
    failure: string
  }> = []
  if (
    input.source.kind === 'agent' &&
    input.target.kind === 'agent' &&
    sourceGroup !== targetGroup
  ) {
    requirements.push(
      {
        groupId: sourceGroup,
        sk: 'agent',
        sid: input.source.id,
        tk: 'outside_group',
        tid: '',
        failure: 'source_outside_output_denied',
      },
      {
        groupId: targetGroup,
        sk: 'outside_group',
        sid: '',
        tk: 'agent',
        tid: input.target.id,
        failure: 'target_outside_input_denied',
      },
    )
  } else {
    const groupId = sourceGroup
    const mapEndpoint = (endpoint: CommunicationEndpoint): [string, string] =>
      endpoint.kind === 'agent' ? ['agent', endpoint.id] : [endpoint.kind, '']
    const [sk, sid] = mapEndpoint(input.source)
    const [tk, tid] = mapEndpoint(input.target)
    requirements.push({ groupId, sk, sid, tk, tid, failure: 'no_allow_edge' })
  }

  const outcomes = requirements.map((requirement) => {
    const edge = db.raw
      .query<EdgeRow, [string, string, string, string, string]>(
        'SELECT source_kind, source_id, target_kind, target_id, posture FROM live_harness_edges WHERE group_id = ? AND source_kind = ? AND source_id = ? AND target_kind = ? AND target_id = ?',
      )
      .get(requirement.groupId, requirement.sk, requirement.sid, requirement.tk, requirement.tid)
    return {
      groupId: requirement.groupId,
      edge: edgeId(
        requirement.groupId,
        requirement.sk,
        requirement.sid,
        requirement.tk,
        requirement.tid,
      ),
      matched: edge !== null,
      posture: edge?.posture ?? null,
    }
  })
  const policyRefs = groups.map((groupId) => ({
    groupId,
    revision: harnesses.get(groupId)?.revision ?? 0,
  }))
  const requiredEdgeIds = outcomes.map((outcome) => outcome.edge)
  const matchedEdgeIds = outcomes
    .filter((outcome) => outcome.matched)
    .map((outcome) => outcome.edge)
  const failed = requirements.find((_, index) => !outcomes[index]?.matched)
  if (failed) {
    return {
      decision: 'deny',
      channel: actualChannel,
      reasonCode: failed.failure,
      reason: `required allow edge is absent: ${outcomes[requirements.indexOf(failed)]?.edge}`,
      policyRefs,
      componentOutcomes: outcomes,
      matchedEdgeIds,
      requiredEdgeIds,
    }
  }
  const approvalEdges = outcomes.filter((outcome) => outcome.posture === 'approval_required')
  return approvalEdges.length
    ? {
        decision: 'approval_required',
        channel: actualChannel,
        reasonCode: 'approval_required',
        reason: `approval is required by ${approvalEdges.length} policy edge${approvalEdges.length === 1 ? '' : 's'}`,
        policyRefs,
        componentOutcomes: outcomes,
        matchedEdgeIds,
        requiredEdgeIds,
      }
    : {
        decision: 'allow',
        channel: actualChannel,
        reasonCode: 'allowed',
        reason: 'all required policy edges allow communication',
        policyRefs,
        componentOutcomes: outcomes,
        matchedEdgeIds,
        requiredEdgeIds,
      }
}

export function authorizationFingerprint(input: AuthorizationInput, operation: string): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation, source: input.source, target: input.target }))
    .digest('hex')
}

export function recordDenial(
  db: BazilionDb,
  input: AuthorizationInput,
  operation: string,
  result: AuthorizationResult,
): AuthorizationResult {
  const fingerprint = authorizationFingerprint(input, operation)
  const loadExisting = () =>
    db.raw
      .query<
        {
          fingerprint: string
          reason_code: string
          reason: string
          channel: CommunicationChannel
          policy_refs_json: string
          component_outcomes_json: string
          matched_edge_ids_json: string
          required_edge_ids_json: string
        },
        [string, string]
      >(
        'SELECT fingerprint, reason_code, reason, channel, policy_refs_json, component_outcomes_json, matched_edge_ids_json, required_edge_ids_json FROM harness_block_events WHERE attempt_kind = ? AND attempt_id = ?',
      )
      .get(input.attemptKind, input.attemptId)
  const existing = loadExisting()
  if (existing) {
    if (existing.fingerprint !== fingerprint)
      return denied(
        result.channel,
        'attempt_key_conflict',
        'typed attempt identity was already used for different semantics',
      )
    return {
      decision: 'deny',
      channel: existing.channel,
      reasonCode: existing.reason_code,
      reason: existing.reason,
      policyRefs: JSON.parse(existing.policy_refs_json),
      componentOutcomes: JSON.parse(existing.component_outcomes_json),
      matchedEdgeIds: JSON.parse(existing.matched_edge_ids_json),
      requiredEdgeIds: JSON.parse(existing.required_edge_ids_json),
    }
  }
  const agentGroup = (endpoint: CommunicationEndpoint) =>
    endpoint.kind === 'agent'
      ? (db.raw
          .query<{ group_id: string }, [string]>('SELECT group_id FROM agents WHERE id = ?')
          .get(endpoint.id)?.group_id ?? null)
      : null
  const sourceGroup =
    agentGroup(input.source) ??
    agentGroup(input.target) ??
    ('groupId' in input.source ? input.source.groupId : null)
  const targetGroup =
    agentGroup(input.target) ??
    agentGroup(input.source) ??
    ('groupId' in input.target ? input.target.groupId : null)
  const values = [
    randomUUID(),
    input.attemptKind,
    input.attemptId,
    operation,
    input.source.kind,
    input.source.kind === 'agent' ? input.source.id : '',
    input.target.kind,
    input.target.kind === 'agent' ? input.target.id : '',
    sourceGroup,
    targetGroup,
    result.channel,
    input.origin,
    result.reasonCode,
    result.reason,
    JSON.stringify(result.policyRefs),
    JSON.stringify(result.componentOutcomes),
    JSON.stringify(result.matchedEdgeIds),
    JSON.stringify(result.requiredEdgeIds),
    fingerprint,
    Date.now(),
  ]
  try {
    db.raw.run(
      `INSERT INTO harness_block_events (id, attempt_kind, attempt_id, operation, source_kind, source_id, target_kind, target_id, source_group_id, target_group_id, channel, origin, reason_code, reason, policy_refs_json, component_outcomes_json, matched_edge_ids_json, required_edge_ids_json, fingerprint, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      values,
    )
  } catch (error) {
    // Another connection may have won the typed-attempt unique race after our lookup.
    // Reloading applies the same immutable fingerprint contract; unrelated DB failures remain errors.
    const raced = loadExisting()
    if (!raced) throw error
    if (raced.fingerprint !== fingerprint)
      return denied(
        result.channel,
        'attempt_key_conflict',
        'typed attempt identity was already used for different semantics',
      )
    return {
      decision: 'deny',
      channel: raced.channel,
      reasonCode: raced.reason_code,
      reason: raced.reason,
      policyRefs: JSON.parse(raced.policy_refs_json),
      componentOutcomes: JSON.parse(raced.component_outcomes_json),
      matchedEdgeIds: JSON.parse(raced.matched_edge_ids_json),
      requiredEdgeIds: JSON.parse(raced.required_edge_ids_json),
    }
  }
  return result
}
