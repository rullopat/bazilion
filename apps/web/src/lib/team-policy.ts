export type TeamPolicyKind = 'template' | 'live'
export type TeamPolicyPreset = 'open_team' | 'coordinator' | 'review_pipeline' | 'blank'
export type ProfilePeerDefault = 'inherit_team_policy' | 'allow_all' | 'deny_all'
export type TeamPolicyChannel =
  | 'user_input'
  | 'user_output'
  | 'agent_message'
  | 'outside_team_input'
  | 'outside_team_output'

export type TeamPolicyEndpoint =
  | { kind: 'user' }
  | { kind: 'outside_team' }
  | { kind: 'member_slot'; slotId: string }
  | { kind: 'agent'; agentId: string }

export interface TeamPolicyEdge {
  id: string
  source: TeamPolicyEndpoint
  target: TeamPolicyEndpoint
  posture?: 'allow' | 'approval_required'
}

export interface TeamPolicyPolicy {
  version: 1
  edges: TeamPolicyEdge[]
}

export interface TeamPolicyDecision {
  decision: 'allow' | 'deny'
  reason: string
  edgeId?: string
}

export interface ProfileCommunicationDefaults {
  userInput: boolean
  userOutput: boolean
  outsideTeamInput: boolean
  outsideTeamOutput: boolean
  peerDefault: ProfilePeerDefault
}

export interface TeamPolicyPosition {
  x: number
  y: number
}

export interface TeamPolicyMember {
  slotId: string
  agentId?: string
  profileId: string
  name: string
  role?: 'coordinator' | 'planner' | 'worker' | 'reviewer' | 'reporter'
  status?: 'idle' | 'running' | 'archived'
  position: TeamPolicyPosition
}

export interface TeamPolicyDocument {
  id: string
  kind: TeamPolicyKind
  name: string
  preset: TeamPolicyPreset
  members: TeamPolicyMember[]
  policy: TeamPolicyPolicy
  sourceTemplateId?: string
  boundTeamId?: string
  createdAt: number
  updatedAt: number
}

export const DEFAULT_PROFILE_COMMUNICATION: ProfileCommunicationDefaults = {
  userInput: true,
  userOutput: true,
  outsideTeamInput: false,
  outsideTeamOutput: false,
  peerDefault: 'allow_all',
}

/**
 * Resolve a profile's explicitly persisted prototype defaults.
 *
 * A missing entry is neutral unless the caller deliberately supplies a workflow-specific
 * fallback. Preset resolution omits that fallback so the four documented topologies stay exact;
 * direct profile spawn supplies the open default because it snapshots a profile directly.
 */
export function effectiveProfileDefaults(
  defaultsByProfile: Readonly<Record<string, ProfileCommunicationDefaults>>,
  profileId: string,
): ProfileCommunicationDefaults | undefined
export function effectiveProfileDefaults(
  defaultsByProfile: Readonly<Record<string, ProfileCommunicationDefaults>>,
  profileId: string,
  fallback: ProfileCommunicationDefaults,
): ProfileCommunicationDefaults
export function effectiveProfileDefaults(
  defaultsByProfile: Readonly<Record<string, ProfileCommunicationDefaults>>,
  profileId: string,
  fallback?: ProfileCommunicationDefaults,
): ProfileCommunicationDefaults | undefined {
  return defaultsByProfile[profileId] ?? fallback
}

export const USER_ENDPOINT: TeamPolicyEndpoint = { kind: 'user' }
export const OUTSIDE_GROUP_ENDPOINT: TeamPolicyEndpoint = { kind: 'outside_team' }

const FIXTURE_TIME = Date.UTC(2026, 6, 10, 10, 0, 0)

export function endpointKey(endpoint: TeamPolicyEndpoint): string {
  switch (endpoint.kind) {
    case 'user':
      return 'user'
    case 'outside_team':
      return 'outside_team'
    case 'member_slot':
      return `slot:${endpoint.slotId}`
    case 'agent':
      return `agent:${endpoint.agentId}`
  }
}

export function endpointFromKey(key: string): TeamPolicyEndpoint | null {
  if (key === 'user') return USER_ENDPOINT
  if (key === 'outside_team') return OUTSIDE_GROUP_ENDPOINT
  if (key.startsWith('slot:') && key.length > 5) {
    return { kind: 'member_slot', slotId: key.slice(5) }
  }
  if (key.startsWith('agent:') && key.length > 6) {
    return { kind: 'agent', agentId: key.slice(6) }
  }
  return null
}

export function endpointsEqual(left: TeamPolicyEndpoint, right: TeamPolicyEndpoint): boolean {
  return endpointKey(left) === endpointKey(right)
}

export function edgeKey(source: TeamPolicyEndpoint, target: TeamPolicyEndpoint): string {
  return `${endpointKey(source)}>${endpointKey(target)}`
}

function edgeId(source: TeamPolicyEndpoint, target: TeamPolicyEndpoint): string {
  return `edge:${edgeKey(source, target)}`
}

export function isMemberEndpoint(endpoint: TeamPolicyEndpoint): boolean {
  return endpoint.kind === 'member_slot' || endpoint.kind === 'agent'
}

export function isValidTeamPolicyConnection(
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): boolean {
  if (endpointsEqual(source, target)) return false
  if (!isMemberEndpoint(source) && !isMemberEndpoint(target)) return false
  if (source.kind === 'member_slot' && target.kind === 'agent') return false
  if (source.kind === 'agent' && target.kind === 'member_slot') return false
  return true
}

export function deriveTeamPolicyChannel(
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): TeamPolicyChannel {
  if (source.kind === 'user' && isMemberEndpoint(target)) return 'user_input'
  if (isMemberEndpoint(source) && target.kind === 'user') return 'user_output'
  if (source.kind === 'outside_team' && isMemberEndpoint(target)) {
    return 'outside_team_input'
  }
  if (isMemberEndpoint(source) && target.kind === 'outside_team') {
    return 'outside_team_output'
  }
  return 'agent_message'
}

export function hasTeamPolicyEdge(
  policy: TeamPolicyPolicy,
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): boolean {
  const wanted = edgeKey(source, target)
  return policy.edges.some((edge) => edgeKey(edge.source, edge.target) === wanted)
}

export function addTeamPolicyEdge(
  policy: TeamPolicyPolicy,
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): TeamPolicyPolicy {
  if (!isValidTeamPolicyConnection(source, target) || hasTeamPolicyEdge(policy, source, target)) {
    return policy
  }
  return {
    ...policy,
    edges: [...policy.edges, { id: edgeId(source, target), source, target }],
  }
}

export function removeTeamPolicyEdge(
  policy: TeamPolicyPolicy,
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): TeamPolicyPolicy {
  const unwanted = edgeKey(source, target)
  const edges = policy.edges.filter((edge) => edgeKey(edge.source, edge.target) !== unwanted)
  return edges.length === policy.edges.length ? policy : { ...policy, edges }
}

export function evaluateTeamPolicyPolicy(
  policy: TeamPolicyPolicy,
  source: TeamPolicyEndpoint,
  target: TeamPolicyEndpoint,
): TeamPolicyDecision {
  if (!isValidTeamPolicyConnection(source, target)) {
    return { decision: 'deny', reason: 'This source and target cannot communicate.' }
  }
  const match = policy.edges.find(
    (edge) => edgeKey(edge.source, edge.target) === edgeKey(source, target),
  )
  if (match) {
    return {
      decision: 'allow',
      reason: 'A directed allow edge matches this communication path.',
      edgeId: match.id,
    }
  }
  return {
    decision: 'deny',
    reason: 'No directed allow edge exists for this communication path.',
  }
}

export function endpointForMember(
  teamPolicy: Pick<TeamPolicyDocument, 'kind'>,
  member: TeamPolicyMember,
): TeamPolicyEndpoint {
  if (teamPolicy.kind === 'live') {
    return { kind: 'agent', agentId: member.agentId ?? `prototype:${member.slotId}` }
  }
  return { kind: 'member_slot', slotId: member.slotId }
}

export function findTeamPolicyMember(
  teamPolicy: TeamPolicyDocument,
  endpoint: TeamPolicyEndpoint,
): TeamPolicyMember | undefined {
  if (endpoint.kind === 'member_slot') {
    return teamPolicy.members.find((member) => member.slotId === endpoint.slotId)
  }
  if (endpoint.kind === 'agent') {
    return teamPolicy.members.find(
      (member) => (member.agentId ?? `prototype:${member.slotId}`) === endpoint.agentId,
    )
  }
  return undefined
}

function emptyPolicy(): TeamPolicyPolicy {
  return { version: 1, edges: [] }
}

function addBothDirections(
  policy: TeamPolicyPolicy,
  left: TeamPolicyEndpoint,
  right: TeamPolicyEndpoint,
): TeamPolicyPolicy {
  return addTeamPolicyEdge(addTeamPolicyEdge(policy, left, right), right, left)
}

export function createPresetPolicy(
  kind: TeamPolicyKind,
  members: TeamPolicyMember[],
  preset: TeamPolicyPreset,
): TeamPolicyPolicy {
  const endpoints = members.map((member) =>
    endpointForMember({ kind }, member),
  )
  let policy = emptyPolicy()

  if (preset === 'blank') return policy

  if (preset === 'open_team') {
    for (let index = 0; index < endpoints.length; index++) {
      const endpoint = endpoints[index]
      if (!endpoint) continue
      policy = addBothDirections(policy, USER_ENDPOINT, endpoint)
      policy = addBothDirections(policy, OUTSIDE_GROUP_ENDPOINT, endpoint)
      for (let peerIndex = index + 1; peerIndex < endpoints.length; peerIndex++) {
        const peer = endpoints[peerIndex]
        if (peer) policy = addBothDirections(policy, endpoint, peer)
      }
    }
    return policy
  }

  if (preset === 'coordinator') {
    const coordinatorIndex = Math.max(
      0,
      members.findIndex((member) => member.role === 'coordinator'),
    )
    const coordinator = endpoints[coordinatorIndex]
    if (!coordinator) return policy
    policy = addBothDirections(policy, USER_ENDPOINT, coordinator)
    for (const endpoint of endpoints) {
      if (endpoint && !endpointsEqual(endpoint, coordinator)) {
        policy = addBothDirections(policy, coordinator, endpoint)
      }
    }
    return policy
  }

  const roleOrder: Array<TeamPolicyMember['role']> = [
    'planner',
    'worker',
    'reviewer',
    'reporter',
  ]
  const ordered = roleOrder
    .map((role) => {
      const member = members.find((candidate) => candidate.role === role)
      return member ? endpointForMember({ kind }, member) : undefined
    })
    .filter((endpoint): endpoint is TeamPolicyEndpoint => Boolean(endpoint))
  const sequence = [USER_ENDPOINT, ...ordered, USER_ENDPOINT]
  for (let index = 0; index < sequence.length - 1; index++) {
    const source = sequence[index]
    const target = sequence[index + 1]
    if (source && target && !endpointsEqual(source, target)) {
      policy = addTeamPolicyEdge(policy, source, target)
    }
  }
  return policy
}

export function applyProfileDefaults(
  policy: TeamPolicyPolicy,
  teamPolicy: Pick<TeamPolicyDocument, 'kind' | 'members'>,
  member: TeamPolicyMember,
  defaults: ProfileCommunicationDefaults,
): TeamPolicyPolicy {
  const endpoint = endpointForMember(teamPolicy, member)
  let next = policy
  const boundaryRules: Array<[boolean, TeamPolicyEndpoint, TeamPolicyEndpoint]> = [
    [defaults.userInput, USER_ENDPOINT, endpoint],
    [defaults.userOutput, endpoint, USER_ENDPOINT],
    [defaults.outsideTeamInput, OUTSIDE_GROUP_ENDPOINT, endpoint],
    [defaults.outsideTeamOutput, endpoint, OUTSIDE_GROUP_ENDPOINT],
  ]
  for (const [allowed, source, target] of boundaryRules) {
    next = allowed
      ? addTeamPolicyEdge(next, source, target)
      : removeTeamPolicyEdge(next, source, target)
  }

  if (defaults.peerDefault === 'inherit_team_policy') return next
  for (const peer of teamPolicy.members) {
    if (peer.slotId === member.slotId) continue
    const peerEndpoint = endpointForMember(teamPolicy, peer)
    if (defaults.peerDefault === 'allow_all') {
      next = addBothDirections(next, endpoint, peerEndpoint)
    } else {
      next = removeTeamPolicyEdge(next, endpoint, peerEndpoint)
      next = removeTeamPolicyEdge(next, peerEndpoint, endpoint)
    }
  }
  return next
}

export function resolvePresetWithProfileDefaults(
  kind: TeamPolicyKind,
  members: TeamPolicyMember[],
  preset: TeamPolicyPreset,
  defaultsByProfile: Record<string, ProfileCommunicationDefaults>,
): TeamPolicyPolicy {
  const teamPolicy = { kind, members }
  let policy = createPresetPolicy(kind, members, preset)
  for (const member of members) {
    const defaults = effectiveProfileDefaults(defaultsByProfile, member.profileId)
    if (defaults) policy = applyProfileDefaults(policy, teamPolicy, member, defaults)
  }
  return policy
}
