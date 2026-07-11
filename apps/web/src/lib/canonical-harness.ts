import type {
  HarnessTemplateDetail,
  LiveHarnessEdgeInput,
  Profile,
  ResolvedGroupHarness,
} from '@bazilion/api-types'
import {
  endpointKey,
  type HarnessDocument,
  type HarnessEdge,
  type HarnessEndpoint,
} from './harness-prototype'

function position(index: number, saved: { x: number; y: number } | null | undefined) {
  return saved ?? { x: 250 + (index % 3) * 250, y: 40 + Math.floor(index / 3) * 130 }
}

function edge(source: HarnessEndpoint, target: HarnessEndpoint): HarnessEdge {
  return { id: `${endpointKey(source)}>${endpointKey(target)}`, source, target }
}

export function templateDocument(detail: HarnessTemplateDetail): HarnessDocument {
  return {
    id: detail.template.id,
    kind: 'template',
    name: detail.template.name,
    preset: 'blank',
    members: detail.slots.map((slot, index) => ({
      slotId: slot.slotId,
      profileId: slot.profileId,
      name: slot.agentName,
      position: position(index, slot.layoutPosition),
    })),
    policy: {
      version: 1,
      edges: detail.edges.map((item) =>
        edge(
          item.sourceKind === 'slot'
            ? { kind: 'member_slot', slotId: item.sourceId ?? '' }
            : { kind: item.sourceKind },
          item.targetKind === 'slot'
            ? { kind: 'member_slot', slotId: item.targetId ?? '' }
            : { kind: item.targetKind },
        ),
      ),
    },
    createdAt: detail.template.createdAt,
    updatedAt: detail.template.updatedAt,
  }
}

export function liveDocument(groupId: string, detail: ResolvedGroupHarness): HarnessDocument {
  const state = new Map(detail.agentState.map((item) => [item.agentId, item.position]))
  return {
    id: groupId,
    kind: 'live',
    name: groupId,
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
        ),
      ),
    },
    createdAt: detail.harness.updatedAt,
    updatedAt: detail.harness.updatedAt,
  }
}

export function templateDefinition(document: HarnessDocument, profiles: Profile[]) {
  const profileIds = new Set(profiles.map((profile) => profile.id))
  return {
    slots: document.members.map((member) => {
      if (!profileIds.has(member.profileId)) throw new Error(`Missing Agent template: ${member.profileId}`)
      return {
        slotId: member.slotId,
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
    })),
  }
}

export function liveEdges(document: HarnessDocument): LiveHarnessEdgeInput[] {
  return document.policy.edges.map((item) => ({
    sourceKind: item.source.kind === 'member_slot' ? 'agent' : item.source.kind,
    sourceId: item.source.kind === 'agent' ? item.source.agentId : null,
    targetKind: item.target.kind === 'member_slot' ? 'agent' : item.target.kind,
    targetId: item.target.kind === 'agent' ? item.target.agentId : null,
  }))
}

export function sameDocument(left: HarnessDocument, right: HarnessDocument): boolean {
  return JSON.stringify(left.members) === JSON.stringify(right.members) &&
    JSON.stringify(left.policy.edges) === JSON.stringify(right.policy.edges)
}
