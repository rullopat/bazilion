import type {
  TeamTemplateDetail,
  TeamPolicyEdgeInput,
  Profile,
  ResolvedTeamPolicy,
} from '@bazilion/api-types'
import {
  createPresetPolicy,
  endpointKey,
  type TeamPolicyDocument,
  type TeamPolicyEdge,
  type TeamPolicyEndpoint,
} from './team-policy'

function position(index: number, saved: { x: number; y: number } | null | undefined) {
  return saved ?? { x: 250 + (index % 3) * 250, y: 40 + Math.floor(index / 3) * 130 }
}

function edge(
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
  posture: TeamPolicyEdge['posture'] = 'allow',
): TeamPolicyEdge {
  return { id: `${endpointKey(source)}>${endpointKey(target)}`, source, target, posture }
}

export function templateDocument(detail: TeamTemplateDetail): TeamPolicyDocument {
  const members: TeamPolicyDocument['members'] = detail.slots.map((slot, index) => ({
    slotId: slot.slotId,
    profileId: slot.profileId,
    name: slot.agentName,
    position: position(index, slot.layoutPosition),
  }))
  const policy: TeamPolicyDocument['policy'] = {
    version: 1,
    edges: detail.edges.map((item) =>
      edge(
        item.sourceKind === 'slot'
          ? { kind: 'member_slot', slotId: item.sourceId ?? '' }
          : { kind: item.sourceKind },
        item.targetKind === 'slot'
          ? { kind: 'member_slot', slotId: item.targetId ?? '' }
          : { kind: item.targetKind },
        item.posture,
      ),
    ),
  }
  return {
    id: detail.template.id,
    kind: 'template',
    name: detail.template.name,
    preset: inferPreset(members, policy),
    members,
    policy,
    createdAt: detail.template.createdAt,
    updatedAt: detail.template.updatedAt,
  }
}

function inferPreset(
  members: TeamPolicyDocument['members'],
  policy: TeamPolicyDocument['policy'],
): TeamPolicyDocument['preset'] {
  const signature = (value: TeamPolicyDocument['policy']) =>
    value.edges
      .map((item) => `${endpointKey(item.source)}>${endpointKey(item.target)}:${item.posture ?? 'allow'}`)
      .sort()
      .join('|')
  const actual = signature(policy)
  for (const preset of ['open_team', 'coordinator', 'review_pipeline', 'blank'] as const) {
    if (signature(createPresetPolicy('template', members, preset)) === actual) return preset
  }
  return 'blank'
}

export function liveDocument(teamId: string, detail: ResolvedTeamPolicy): TeamPolicyDocument {
  const state = new Map(detail.agentState.map((item) => [item.agentId, item.position]))
  return {
    id: teamId,
    kind: 'live',
    name: teamId,
    preset: 'blank',
    members: detail.members.map((agent, index) => ({
      slotId: `agent:${agent.id}`,
      agentId: agent.id,
      profileId: agent.profileId,
      name: agent.name,
      status: agent.status,
      position: position(index, state.get(agent.id)),
    })),
    policy: {
      version: 1,
      edges: detail.edges.map((item) =>
        edge(
          item.sourceKind === 'agent'
            ? { kind: 'agent', agentId: item.sourceId ?? '' }
            : { kind: item.sourceKind },
          item.targetKind === 'agent'
            ? { kind: 'agent', agentId: item.targetId ?? '' }
            : { kind: item.targetKind },
          item.posture,
        ),
      ),
    },
    createdAt: detail.teamPolicy.updatedAt,
    updatedAt: detail.teamPolicy.updatedAt,
  }
}

export function templateDefinition(document: TeamPolicyDocument, profiles: Profile[]) {
  const profileIds = new Set(profiles.map((profile) => profile.id))
  return {
    slots: document.members.map((member) => {
      if (!profileIds.has(member.profileId)) throw new Error(`Missing Agent template: ${member.profileId}`)
      return {
        ...(member.slotId.startsWith('draft:')
          ? { clientKey: member.slotId }
          : { slotId: member.slotId }),
        profileId: member.profileId,
        agentName: member.name,
        modelOverride: null,
        reasoningLevel: null,
        layoutPosition: member.position,
        display: null,
      }
    }),
    edges: document.policy.edges.map((item) => ({
      sourceKind: item.source.kind === 'member_slot' ? 'slot' : item.source.kind,
      sourceId: item.source.kind === 'member_slot' ? item.source.slotId : null,
      targetKind: item.target.kind === 'member_slot' ? 'slot' : item.target.kind,
      targetId: item.target.kind === 'member_slot' ? item.target.slotId : null,
      posture: item.posture ?? 'allow',
    })),
  }
}

export function liveEdges(document: TeamPolicyDocument): TeamPolicyEdgeInput[] {
  return document.policy.edges.map((item) => ({
    sourceKind: item.source.kind === 'member_slot' ? 'agent' : item.source.kind,
    sourceId: item.source.kind === 'agent' ? item.source.agentId : null,
    targetKind: item.target.kind === 'member_slot' ? 'agent' : item.target.kind,
    targetId: item.target.kind === 'agent' ? item.target.agentId : null,
    posture: item.posture ?? 'allow',
  }))
}

export function sameDocument(left: TeamPolicyDocument, right: TeamPolicyDocument): boolean {
  return JSON.stringify(left.members) === JSON.stringify(right.members) &&
    JSON.stringify(left.policy.edges) === JSON.stringify(right.policy.edges)
}
