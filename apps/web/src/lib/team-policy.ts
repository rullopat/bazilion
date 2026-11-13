import {
  type AgentStatus,
  OUTSIDE_TEAM,
  type Profile,
  type ReasoningLevel,
  type TeamPolicy,
  type TeamPolicyEdge,
  type TeamPolicyMode,
  type TeamTemplate,
  type TeamTemplateEndpoint,
  type TeamTemplateInput,
} from '@bazilion/api-types'

export const OUTSIDE = OUTSIDE_TEAM

export interface PolicyPosition {
  x: number
  y: number
}

/** A node of the editor. `key` is the Agent id in a live Team and a local slot key in a template. */
export interface PolicyMember {
  key: string
  name: string
  profileId: string
  status?: AgentStatus
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel | null
  position: PolicyPosition
}

/** Directed allow edge between member keys or `outside`. */
export interface PolicyEdge {
  from: string
  to: string
}

export interface PolicyDocument {
  kind: 'live' | 'template'
  name: string
  userMd: string | null
  mode: TeamPolicyMode
  members: PolicyMember[]
  edges: PolicyEdge[]
}

export function edgeKey(from: string, to: string): string {
  return `${from}>${to}`
}

export function hasEdge(document: PolicyDocument, from: string, to: string): boolean {
  return document.edges.some((edge) => edge.from === from && edge.to === to)
}

/** Add or remove one allow edge; an endpoint never connects to itself. */
export function setEdge(
  document: PolicyDocument,
  from: string,
  to: string,
  allowed: boolean,
): PolicyDocument {
  if (from === to || hasEdge(document, from, to) === allowed) return document
  const edges = allowed
    ? [...document.edges, { from, to }]
    : document.edges.filter((edge) => edge.from !== from || edge.to !== to)
  return { ...document, edges }
}

export function endpointLabel(document: PolicyDocument, key: string): string {
  if (key === OUTSIDE) return 'Other teams'
  return document.members.find((member) => member.key === key)?.name || key
}

export function defaultPosition(index: number): PolicyPosition {
  return { x: 40 + (index % 3) * 250, y: 40 + Math.floor(index / 3) * 130 }
}

export function liveDocument(policy: TeamPolicy): PolicyDocument {
  return {
    kind: 'live',
    name: policy.teamId,
    userMd: null,
    mode: policy.mode,
    members: policy.members.map((agent, index) => ({
      key: agent.id,
      name: agent.name,
      profileId: agent.profileId,
      status: agent.status,
      position: defaultPosition(index),
    })),
    edges: policy.edges.map((edge) => ({ from: edge.from, to: edge.to })),
  }
}

export function liveEdges(document: PolicyDocument): TeamPolicyEdge[] {
  return document.edges.map((edge) => ({ from: edge.from, to: edge.to }))
}

export function templateDocument(template: TeamTemplate): PolicyDocument {
  const key = (end: TeamTemplateEndpoint) => (end === OUTSIDE ? OUTSIDE : `slot:${end}`)
  return {
    kind: 'template',
    name: template.name,
    userMd: template.userMd,
    mode: template.policyMode,
    members: template.slots.map((slot, index) => ({
      key: `slot:${index}`,
      name: slot.agentName,
      profileId: slot.profileId,
      modelOverride: slot.modelOverride,
      reasoningLevel: slot.reasoningLevel,
      position: slot.layoutPosition ?? defaultPosition(index),
    })),
    edges: template.edges.map((edge) => ({ from: key(edge.from), to: key(edge.to) })),
  }
}

/** The PUT body for a template draft; slots are numbered by their order in the draft. */
export function templateInput(document: PolicyDocument, profiles: Profile[]): TeamTemplateInput {
  const profileIds = new Set(profiles.map((profile) => profile.id))
  const position = new Map(document.members.map((member, index) => [member.key, index]))
  const endpoint = (key: string): TeamTemplateEndpoint => {
    if (key === OUTSIDE) return OUTSIDE
    const index = position.get(key)
    if (index === undefined) throw new Error(`Edge names a removed slot: ${key}`)
    return index
  }
  return {
    name: document.name,
    userMd: document.userMd,
    policyMode: document.mode,
    slots: document.members.map((member) => {
      if (!profileIds.has(member.profileId)) {
        throw new Error(`Missing Agent template: ${member.profileId || '(none)'}`)
      }
      return {
        profileId: member.profileId,
        agentName: member.name,
        modelOverride: member.modelOverride ?? null,
        reasoningLevel: member.reasoningLevel ?? null,
        layoutPosition: member.position,
      }
    }),
    edges: document.edges.map((edge) => ({ from: endpoint(edge.from), to: endpoint(edge.to) })),
  }
}

/** A live Team stores no layout, so dragging its nodes never makes the draft dirty. */
export function sameDocument(left: PolicyDocument, right: PolicyDocument): boolean {
  const edges = (document: PolicyDocument) =>
    document.edges
      .map((edge) => edgeKey(edge.from, edge.to))
      .sort()
      .join('|')
  if (left.mode !== right.mode || edges(left) !== edges(right)) return false
  if (left.kind === 'live') return true
  return (
    left.name === right.name &&
    left.userMd === right.userMd &&
    JSON.stringify(left.members) === JSON.stringify(right.members)
  )
}
