export const HARNESS_STORAGE_KEY = 'bazilion:harness-prototype:v1'
export const HARNESS_STATE_VERSION = 1 as const

export type HarnessKind = 'template' | 'live'
export type HarnessPreset = 'open_team' | 'coordinator' | 'review_pipeline' | 'blank'
export type HarnessView = 'flow' | 'matrix'
export type ProfilePeerDefault = 'inherit_harness' | 'allow_all' | 'deny_all'
export type HarnessOrigin = 'web' | 'cli' | 'telegram' | 'agent_tool' | 'api'
export type HarnessChannel =
  | 'user_input'
  | 'user_output'
  | 'agent_message'
  | 'outside_group_input'
  | 'outside_group_output'

export type HarnessEndpoint =
  | { kind: 'user' }
  | { kind: 'outside_group' }
  | { kind: 'member_slot'; slotId: string }
  | { kind: 'agent'; agentId: string }

export interface HarnessEdge {
  id: string
  source: HarnessEndpoint
  target: HarnessEndpoint
}

export interface HarnessPolicy {
  version: 1
  edges: HarnessEdge[]
}

export interface HarnessDecision {
  decision: 'allow' | 'deny'
  reason: string
  edgeId?: string
}

export interface ProfileCommunicationDefaults {
  userInput: boolean
  userOutput: boolean
  outsideGroupInput: boolean
  outsideGroupOutput: boolean
  peerDefault: ProfilePeerDefault
}

export interface HarnessPosition {
  x: number
  y: number
}

export interface HarnessMember {
  slotId: string
  agentId?: string
  profileId: string
  name: string
  role?: 'coordinator' | 'planner' | 'worker' | 'reviewer' | 'reporter'
  status?: 'idle' | 'running' | 'archived'
  position: HarnessPosition
}

export interface HarnessDocument {
  id: string
  kind: HarnessKind
  name: string
  preset: HarnessPreset
  members: HarnessMember[]
  policy: HarnessPolicy
  sourceTemplateId?: string
  boundGroupId?: string
  createdAt: number
  updatedAt: number
}

export interface HarnessUiState {
  view: HarnessView
  selectedId: string | null
  viewport: { x: number; y: number; zoom: number }
}

export interface HarnessBlockedAttempt {
  id: string
  harnessId: string
  source: HarnessEndpoint
  target: HarnessEndpoint
  channel: HarnessChannel
  origin: HarnessOrigin
  reason: string
  createdAt: number
}

export interface HarnessPrototypeState {
  version: 1
  templates: HarnessDocument[]
  liveHarnesses: HarnessDocument[]
  profileDefaults: Record<string, ProfileCommunicationDefaults>
  blockedAttempts: HarnessBlockedAttempt[]
  ui: Record<string, HarnessUiState>
}

export interface HarnessProfileInput {
  id: string
  name: string
}

export interface LiveGroupInput {
  id: string
  name: string
}

export interface LiveAgentInput {
  id: string
  profileId: string
  name: string
  status: 'idle' | 'running' | 'archived'
}

export interface HarnessDiff {
  modified: boolean
  addedMembers: HarnessMember[]
  removedMembers: HarnessMember[]
  changedMembers: Array<{ source: HarnessMember; live: HarnessMember }>
  addedEdges: HarnessEdge[]
  removedEdges: HarnessEdge[]
}

export const DEFAULT_PROFILE_COMMUNICATION: ProfileCommunicationDefaults = {
  userInput: true,
  userOutput: true,
  outsideGroupInput: true,
  outsideGroupOutput: true,
  peerDefault: 'inherit_harness',
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

export const USER_ENDPOINT: HarnessEndpoint = { kind: 'user' }
export const OUTSIDE_GROUP_ENDPOINT: HarnessEndpoint = { kind: 'outside_group' }

const FIXTURE_TIME = Date.UTC(2026, 6, 10, 10, 0, 0)

export function endpointKey(endpoint: HarnessEndpoint): string {
  switch (endpoint.kind) {
    case 'user':
      return 'user'
    case 'outside_group':
      return 'outside_group'
    case 'member_slot':
      return `slot:${endpoint.slotId}`
    case 'agent':
      return `agent:${endpoint.agentId}`
  }
}

export function endpointFromKey(key: string): HarnessEndpoint | null {
  if (key === 'user') return USER_ENDPOINT
  if (key === 'outside_group') return OUTSIDE_GROUP_ENDPOINT
  if (key.startsWith('slot:') && key.length > 5) {
    return { kind: 'member_slot', slotId: key.slice(5) }
  }
  if (key.startsWith('agent:') && key.length > 6) {
    return { kind: 'agent', agentId: key.slice(6) }
  }
  return null
}

export function endpointsEqual(left: HarnessEndpoint, right: HarnessEndpoint): boolean {
  return endpointKey(left) === endpointKey(right)
}

export function edgeKey(source: HarnessEndpoint, target: HarnessEndpoint): string {
  return `${endpointKey(source)}>${endpointKey(target)}`
}

function edgeId(source: HarnessEndpoint, target: HarnessEndpoint): string {
  return `edge:${edgeKey(source, target)}`
}

export function isMemberEndpoint(endpoint: HarnessEndpoint): boolean {
  return endpoint.kind === 'member_slot' || endpoint.kind === 'agent'
}

export function isValidHarnessConnection(
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): boolean {
  if (endpointsEqual(source, target)) return false
  if (!isMemberEndpoint(source) && !isMemberEndpoint(target)) return false
  if (source.kind === 'member_slot' && target.kind === 'agent') return false
  if (source.kind === 'agent' && target.kind === 'member_slot') return false
  return true
}

export function deriveHarnessChannel(
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): HarnessChannel {
  if (source.kind === 'user' && isMemberEndpoint(target)) return 'user_input'
  if (isMemberEndpoint(source) && target.kind === 'user') return 'user_output'
  if (source.kind === 'outside_group' && isMemberEndpoint(target)) {
    return 'outside_group_input'
  }
  if (isMemberEndpoint(source) && target.kind === 'outside_group') {
    return 'outside_group_output'
  }
  return 'agent_message'
}

export function hasHarnessEdge(
  policy: HarnessPolicy,
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): boolean {
  const wanted = edgeKey(source, target)
  return policy.edges.some((edge) => edgeKey(edge.source, edge.target) === wanted)
}

export function addHarnessEdge(
  policy: HarnessPolicy,
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): HarnessPolicy {
  if (!isValidHarnessConnection(source, target) || hasHarnessEdge(policy, source, target)) {
    return policy
  }
  return {
    ...policy,
    edges: [...policy.edges, { id: edgeId(source, target), source, target }],
  }
}

export function removeHarnessEdge(
  policy: HarnessPolicy,
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): HarnessPolicy {
  const unwanted = edgeKey(source, target)
  const edges = policy.edges.filter((edge) => edgeKey(edge.source, edge.target) !== unwanted)
  return edges.length === policy.edges.length ? policy : { ...policy, edges }
}

export function evaluateHarnessPolicy(
  policy: HarnessPolicy,
  source: HarnessEndpoint,
  target: HarnessEndpoint,
): HarnessDecision {
  if (!isValidHarnessConnection(source, target)) {
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
  harness: Pick<HarnessDocument, 'kind'>,
  member: HarnessMember,
): HarnessEndpoint {
  if (harness.kind === 'live') {
    return { kind: 'agent', agentId: member.agentId ?? `prototype:${member.slotId}` }
  }
  return { kind: 'member_slot', slotId: member.slotId }
}

export function findHarnessMember(
  harness: HarnessDocument,
  endpoint: HarnessEndpoint,
): HarnessMember | undefined {
  if (endpoint.kind === 'member_slot') {
    return harness.members.find((member) => member.slotId === endpoint.slotId)
  }
  if (endpoint.kind === 'agent') {
    return harness.members.find(
      (member) => (member.agentId ?? `prototype:${member.slotId}`) === endpoint.agentId,
    )
  }
  return undefined
}

function emptyPolicy(): HarnessPolicy {
  return { version: 1, edges: [] }
}

function addBothDirections(
  policy: HarnessPolicy,
  left: HarnessEndpoint,
  right: HarnessEndpoint,
): HarnessPolicy {
  return addHarnessEdge(addHarnessEdge(policy, left, right), right, left)
}

export function createPresetPolicy(
  kind: HarnessKind,
  members: HarnessMember[],
  preset: HarnessPreset,
): HarnessPolicy {
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

  const roleOrder: Array<HarnessMember['role']> = [
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
    .filter((endpoint): endpoint is HarnessEndpoint => Boolean(endpoint))
  const sequence = [USER_ENDPOINT, ...ordered, USER_ENDPOINT]
  for (let index = 0; index < sequence.length - 1; index++) {
    const source = sequence[index]
    const target = sequence[index + 1]
    if (source && target && !endpointsEqual(source, target)) {
      policy = addHarnessEdge(policy, source, target)
    }
  }
  return policy
}

export function applyProfileDefaults(
  policy: HarnessPolicy,
  harness: Pick<HarnessDocument, 'kind' | 'members'>,
  member: HarnessMember,
  defaults: ProfileCommunicationDefaults,
): HarnessPolicy {
  const endpoint = endpointForMember(harness, member)
  let next = policy
  const boundaryRules: Array<[boolean, HarnessEndpoint, HarnessEndpoint]> = [
    [defaults.userInput, USER_ENDPOINT, endpoint],
    [defaults.userOutput, endpoint, USER_ENDPOINT],
    [defaults.outsideGroupInput, OUTSIDE_GROUP_ENDPOINT, endpoint],
    [defaults.outsideGroupOutput, endpoint, OUTSIDE_GROUP_ENDPOINT],
  ]
  for (const [allowed, source, target] of boundaryRules) {
    next = allowed
      ? addHarnessEdge(next, source, target)
      : removeHarnessEdge(next, source, target)
  }

  if (defaults.peerDefault === 'inherit_harness') return next
  for (const peer of harness.members) {
    if (peer.slotId === member.slotId) continue
    const peerEndpoint = endpointForMember(harness, peer)
    if (defaults.peerDefault === 'allow_all') {
      next = addBothDirections(next, endpoint, peerEndpoint)
    } else {
      next = removeHarnessEdge(next, endpoint, peerEndpoint)
      next = removeHarnessEdge(next, peerEndpoint, endpoint)
    }
  }
  return next
}

export function resolvePresetWithProfileDefaults(
  kind: HarnessKind,
  members: HarnessMember[],
  preset: HarnessPreset,
  defaultsByProfile: Record<string, ProfileCommunicationDefaults>,
): HarnessPolicy {
  const harness = { kind, members }
  let policy = createPresetPolicy(kind, members, preset)
  for (const member of members) {
    const defaults = effectiveProfileDefaults(defaultsByProfile, member.profileId)
    if (defaults) policy = applyProfileDefaults(policy, harness, member, defaults)
  }
  return policy
}

function defaultPosition(index: number): HarnessPosition {
  const column = index % 3
  const row = Math.floor(index / 3)
  return { x: 260 + column * 250, y: 100 + row * 180 }
}

function roleForPreset(
  preset: HarnessPreset,
  index: number,
): HarnessMember['role'] | undefined {
  if (preset === 'coordinator') return index === 0 ? 'coordinator' : 'worker'
  if (preset === 'review_pipeline') {
    return (['planner', 'worker', 'reviewer', 'reporter'] as const)[index]
  }
  return undefined
}

function slug(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  return normalized || 'harness'
}

function uniqueId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function createHarnessTemplate(options: {
  id?: string
  name: string
  preset: HarnessPreset
  profiles: HarnessProfileInput[]
  profileDefaults?: Record<string, ProfileCommunicationDefaults>
  now?: number
}): HarnessDocument {
  const now = options.now ?? Date.now()
  const id = options.id ?? `template-${slug(options.name)}-${now}`
  const members = options.profiles.map<HarnessMember>((profile, index) => ({
    slotId: `${id}-slot-${index + 1}`,
    profileId: profile.id,
    name: profile.name,
    role: roleForPreset(options.preset, index),
    position: defaultPosition(index),
  }))
  return {
    id,
    kind: 'template',
    name: options.name,
    preset: options.preset,
    members,
    policy: resolvePresetWithProfileDefaults(
      'template',
      members,
      options.preset,
      options.profileDefaults ?? {},
    ),
    createdAt: now,
    updatedAt: now,
  }
}

function translateEndpointToLive(
  endpoint: HarnessEndpoint,
  agentBySlot: Map<string, string>,
): HarnessEndpoint | null {
  if (endpoint.kind !== 'member_slot') return endpoint
  const agentId = agentBySlot.get(endpoint.slotId)
  return agentId ? { kind: 'agent', agentId } : null
}

function translateTemplatePolicyToLive(
  policy: HarnessPolicy,
  members: HarnessMember[],
): HarnessPolicy {
  const agentBySlot = new Map(
    members.map((member) => [member.slotId, member.agentId ?? `prototype:${member.slotId}`]),
  )
  let translated = emptyPolicy()
  for (const edge of policy.edges) {
    const source = translateEndpointToLive(edge.source, agentBySlot)
    const target = translateEndpointToLive(edge.target, agentBySlot)
    if (source && target) translated = addHarnessEdge(translated, source, target)
  }
  return translated
}

export function bindLiveGroup(options: {
  group: LiveGroupInput
  agents: LiveAgentInput[]
  sourceTemplate: HarnessDocument
  now?: number
}): HarnessDocument {
  const now = options.now ?? Date.now()
  const members = options.agents.map<HarnessMember>((agent, index) => ({
    slotId:
      options.sourceTemplate.members[index]?.slotId ??
      `live-${options.group.id}-slot-${agent.id}`,
    agentId: agent.id,
    profileId: agent.profileId,
    name: agent.name,
    role: options.sourceTemplate.members[index]?.role,
    status: agent.status,
    position: options.sourceTemplate.members[index]?.position ?? defaultPosition(index),
  }))
  return {
    id: `live-${options.group.id}`,
    kind: 'live',
    name: options.group.name,
    preset: options.sourceTemplate.preset,
    members,
    policy: isCanonicalOpenTeamPolicy(options.sourceTemplate)
      ? createPresetPolicy('live', members, 'open_team')
      : translateTemplatePolicyToLive(options.sourceTemplate.policy, members),
    sourceTemplateId: options.sourceTemplate.id,
    boundGroupId: options.group.id,
    createdAt: now,
    updatedAt: now,
  }
}

function sortedEdgeKeys(policy: HarnessPolicy): string[] {
  return policy.edges.map((edge) => edgeKey(edge.source, edge.target)).sort()
}

function isCanonicalOpenTeamPolicy(sourceTemplate: HarnessDocument): boolean {
  if (sourceTemplate.preset !== 'open_team') return false
  const canonical = createPresetPolicy('template', sourceTemplate.members, 'open_team')
  return JSON.stringify(sortedEdgeKeys(sourceTemplate.policy)) === JSON.stringify(sortedEdgeKeys(canonical))
}

function expectedLivePolicy(
  sourceTemplate: HarnessDocument,
  liveHarness: HarnessDocument,
): HarnessPolicy {
  return translateTemplatePolicyToLive(sourceTemplate.policy, liveHarness.members)
}

export function diffLiveHarness(
  sourceTemplate: HarnessDocument | undefined,
  liveHarness: HarnessDocument,
): HarnessDiff {
  if (!sourceTemplate) {
    return {
      modified: true,
      addedMembers: liveHarness.members,
      removedMembers: [],
      changedMembers: [],
      addedEdges: liveHarness.policy.edges,
      removedEdges: [],
    }
  }
  const expected = expectedLivePolicy(sourceTemplate, liveHarness)
  const sourceSlots = new Set(sourceTemplate.members.map((member) => member.slotId))
  const liveSlots = new Set(liveHarness.members.map((member) => member.slotId))
  const addedMembers = liveHarness.members.filter((member) => !sourceSlots.has(member.slotId))
  const removedMembers = sourceTemplate.members.filter((member) => !liveSlots.has(member.slotId))
  const changedMembers = liveHarness.members.flatMap((live) => {
    const source = sourceTemplate.members.find((member) => member.slotId === live.slotId)
    if (
      !source ||
      (source.name === live.name &&
        source.profileId === live.profileId &&
        source.role === live.role)
    ) {
      return []
    }
    return [{ source, live }]
  })
  const expectedKeys = new Set(sortedEdgeKeys(expected))
  const liveKeys = new Set(sortedEdgeKeys(liveHarness.policy))
  const addedEdges = liveHarness.policy.edges.filter(
    (edge) => !expectedKeys.has(edgeKey(edge.source, edge.target)),
  )
  const removedEdges = expected.edges.filter(
    (edge) => !liveKeys.has(edgeKey(edge.source, edge.target)),
  )
  return {
    modified:
      addedMembers.length > 0 ||
      removedMembers.length > 0 ||
      changedMembers.length > 0 ||
      addedEdges.length > 0 ||
      removedEdges.length > 0,
    addedMembers,
    removedMembers,
    changedMembers,
    addedEdges,
    removedEdges,
  }
}

function translateLiveEndpointToSlot(
  endpoint: HarnessEndpoint,
  slotByAgent: Map<string, string>,
): HarnessEndpoint | null {
  if (endpoint.kind !== 'agent') return endpoint
  const slotId = slotByAgent.get(endpoint.agentId)
  return slotId ? { kind: 'member_slot', slotId } : null
}

function templatePolicyFromLive(
  liveHarness: HarnessDocument,
  includedMembers: HarnessMember[],
): HarnessPolicy {
  const slotByAgent = new Map(
    includedMembers.map((member) => [
      member.agentId ?? `prototype:${member.slotId}`,
      member.slotId,
    ]),
  )
  let policy = emptyPolicy()
  for (const edge of liveHarness.policy.edges) {
    const source = translateLiveEndpointToSlot(edge.source, slotByAgent)
    const target = translateLiveEndpointToSlot(edge.target, slotByAgent)
    if (source && target) policy = addHarnessEdge(policy, source, target)
  }
  return policy
}

export function updateTemplateFromLive(options: {
  sourceTemplate: HarnessDocument
  liveHarness: HarnessDocument
  includeLiveOnlySlots: Set<string>
  now?: number
}): HarnessDocument {
  const sourceSlots = new Set(options.sourceTemplate.members.map((member) => member.slotId))
  const includedLiveMembers = options.liveHarness.members.filter(
    (member) => sourceSlots.has(member.slotId) || options.includeLiveOnlySlots.has(member.slotId),
  )
  const liveBySlot = new Map(includedLiveMembers.map((member) => [member.slotId, member]))
  const retained = options.sourceTemplate.members
    .filter((member) => liveBySlot.has(member.slotId))
    .map((member) => {
      const live = liveBySlot.get(member.slotId)
      return live
        ? {
            ...member,
            name: live.name,
            profileId: live.profileId,
            role: live.role,
            position: live.position,
          }
        : member
    })
  const additions = includedLiveMembers
    .filter((member) => !sourceSlots.has(member.slotId))
    .map((member) => ({ ...member, agentId: undefined }))
  const members = [...retained, ...additions]
  return {
    ...options.sourceTemplate,
    members,
    policy: templatePolicyFromLive(options.liveHarness, includedLiveMembers),
    updatedAt: options.now ?? Date.now(),
  }
}

export function saveLiveAsTemplate(options: {
  liveHarness: HarnessDocument
  name: string
  id?: string
  now?: number
}): HarnessDocument {
  const now = options.now ?? Date.now()
  const id = options.id ?? `template-${slug(options.name)}-${now}`
  const members = options.liveHarness.members.map((member, index) => ({
    ...member,
    slotId: `${id}-slot-${index + 1}`,
    agentId: undefined,
  }))
  const oldToNewSlot = new Map(
    options.liveHarness.members.map((member, index) => [
      member.agentId ?? `prototype:${member.slotId}`,
      members[index]?.slotId ?? '',
    ]),
  )
  let policy = emptyPolicy()
  for (const edge of options.liveHarness.policy.edges) {
    const translate = (endpoint: HarnessEndpoint): HarnessEndpoint | null => {
      if (endpoint.kind === 'agent') {
        const slotId = oldToNewSlot.get(endpoint.agentId)
        return slotId ? { kind: 'member_slot', slotId } : null
      }
      if (endpoint.kind === 'member_slot') {
        const slotId = oldToNewSlot.get(endpoint.slotId)
        return slotId ? { kind: 'member_slot', slotId } : null
      }
      return endpoint
    }
    const source = translate(edge.source)
    const target = translate(edge.target)
    if (source && target) policy = addHarnessEdge(policy, source, target)
  }
  return {
    id,
    kind: 'template',
    name: options.name,
    preset: options.liveHarness.preset,
    members,
    policy,
    createdAt: now,
    updatedAt: now,
  }
}

export function createBlockedAttempt(options: {
  harnessId: string
  source: HarnessEndpoint
  target: HarnessEndpoint
  origin: HarnessOrigin
  reason: string
  now?: number
  id?: string
}): HarnessBlockedAttempt {
  return {
    id: options.id ?? uniqueId('block'),
    harnessId: options.harnessId,
    source: options.source,
    target: options.target,
    channel: deriveHarnessChannel(options.source, options.target),
    origin: options.origin,
    reason: options.reason,
    createdAt: options.now ?? Date.now(),
  }
}

export function addHarnessMember(
  harness: HarnessDocument,
  member: HarnessMember,
  defaults?: ProfileCommunicationDefaults,
): HarnessDocument {
  const members = [...harness.members, member]
  const next = { ...harness, members }
  return {
    ...next,
    policy: defaults
      ? applyProfileDefaults(harness.policy, next, member, defaults)
      : harness.policy,
  }
}

export function removeHarnessMember(
  harness: HarnessDocument,
  slotId: string,
): HarnessDocument {
  const member = harness.members.find((candidate) => candidate.slotId === slotId)
  if (!member) return harness
  const endpoint = endpointForMember(harness, member)
  return {
    ...harness,
    members: harness.members.filter((candidate) => candidate.slotId !== slotId),
    policy: {
      ...harness.policy,
      edges: harness.policy.edges.filter(
        (edge) =>
          endpointKey(edge.source) !== endpointKey(endpoint) &&
          endpointKey(edge.target) !== endpointKey(endpoint),
      ),
    },
  }
}

export function addDirectSpawnToPrototype(options: {
  state: HarnessPrototypeState
  agent: LiveAgentInput & { groupId: string }
  groupName?: string
  now?: number
}): HarnessPrototypeState {
  const now = options.now ?? Date.now()
  const defaults = effectiveProfileDefaults(
    options.state.profileDefaults,
    options.agent.profileId,
    DEFAULT_PROFILE_COMMUNICATION,
  )
  const member: HarnessMember = {
    slotId: `live-${options.agent.groupId}-slot-${options.agent.id}`,
    agentId: options.agent.id,
    profileId: options.agent.profileId,
    name: options.agent.name,
    status: options.agent.status,
    position: { x: 280, y: 120 },
  }
  const existing = options.state.liveHarnesses.find(
    (harness) => harness.boundGroupId === options.agent.groupId,
  )
  if (existing) {
    if (existing.members.some((candidate) => candidate.agentId === options.agent.id)) {
      return options.state
    }
    const updated = {
      ...addHarnessMember(existing, member, defaults),
      updatedAt: now,
    }
    return upsertHarness(options.state, updated)
  }

  const harness: HarnessDocument = {
    id: `live-${options.agent.groupId}`,
    kind: 'live',
    name: options.groupName ?? options.agent.groupId,
    preset: 'blank',
    members: [member],
    policy: emptyPolicy(),
    boundGroupId: options.agent.groupId,
    createdAt: now,
    updatedAt: now,
  }
  return upsertHarness(options.state, addHarnessMember({ ...harness, members: [] }, member, defaults))
}

function fixtureProfile(id: string, name: string): HarnessProfileInput {
  return { id, name }
}

export function createHarnessFixtureState(): HarnessPrototypeState {
  const profiles = {
    coordinator: fixtureProfile('fixture-coordinator', 'Coordinator'),
    researcher: fixtureProfile('fixture-researcher', 'Researcher'),
    writer: fixtureProfile('fixture-writer', 'Writer'),
    planner: fixtureProfile('fixture-planner', 'Planner'),
    reviewer: fixtureProfile('fixture-reviewer', 'Reviewer'),
    reporter: fixtureProfile('fixture-reporter', 'Reporter'),
  }
  const open = createHarnessTemplate({
    id: 'template-open-team',
    name: 'Open team',
    preset: 'open_team',
    profiles: [profiles.researcher, profiles.writer, profiles.reviewer],
    now: FIXTURE_TIME,
  })
  const coordinator = createHarnessTemplate({
    id: 'template-coordinator',
    name: 'Coordinator team',
    preset: 'coordinator',
    profiles: [profiles.coordinator, profiles.researcher, profiles.writer],
    now: FIXTURE_TIME,
  })
  const review = createHarnessTemplate({
    id: 'template-review-pipeline',
    name: 'Review pipeline',
    preset: 'review_pipeline',
    profiles: [profiles.planner, profiles.writer, profiles.reviewer, profiles.reporter],
    now: FIXTURE_TIME,
  })
  const blank = createHarnessTemplate({
    id: 'template-blank',
    name: 'Blank harness',
    preset: 'blank',
    profiles: [profiles.researcher, profiles.writer],
    now: FIXTURE_TIME,
  })
  return {
    version: HARNESS_STATE_VERSION,
    templates: [open, coordinator, review, blank],
    liveHarnesses: [],
    profileDefaults: {},
    blockedAttempts: [],
    ui: {},
  }
}

function isHarnessState(value: unknown): value is HarnessPrototypeState {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<HarnessPrototypeState>
  return (
    candidate.version === HARNESS_STATE_VERSION &&
    Array.isArray(candidate.templates) &&
    Array.isArray(candidate.liveHarnesses) &&
    Array.isArray(candidate.blockedAttempts) &&
    Boolean(candidate.profileDefaults && typeof candidate.profileDefaults === 'object') &&
    Boolean(candidate.ui && typeof candidate.ui === 'object')
  )
}

export function loadHarnessPrototypeState(
  storage?: Pick<Storage, 'getItem'>,
): HarnessPrototypeState {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
  if (!target) return createHarnessFixtureState()
  try {
    const raw = target.getItem(HARNESS_STORAGE_KEY)
    if (!raw) return createHarnessFixtureState()
    const parsed: unknown = JSON.parse(raw)
    return isHarnessState(parsed) ? parsed : createHarnessFixtureState()
  } catch {
    return createHarnessFixtureState()
  }
}

export function persistHarnessPrototypeState(
  state: HarnessPrototypeState,
  storage?: Pick<Storage, 'setItem'>,
): void {
  const target = storage ?? (typeof window === 'undefined' ? undefined : window.localStorage)
  if (!target) return
  try {
    target.setItem(HARNESS_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // The prototype stays usable in memory when browser storage is unavailable.
  }
}

export function getHarnessById(
  state: HarnessPrototypeState,
  harnessId: string,
): HarnessDocument | undefined {
  return [...state.templates, ...state.liveHarnesses].find((harness) => harness.id === harnessId)
}

export function upsertHarness(
  state: HarnessPrototypeState,
  harness: HarnessDocument,
): HarnessPrototypeState {
  const key = harness.kind === 'template' ? 'templates' : 'liveHarnesses'
  const collection = state[key]
  const exists = collection.some((candidate) => candidate.id === harness.id)
  return {
    ...state,
    [key]: exists
      ? collection.map((candidate) => (candidate.id === harness.id ? harness : candidate))
      : [...collection, harness],
  }
}

export function defaultHarnessUiState(): HarnessUiState {
  return { view: 'flow', selectedId: null, viewport: { x: 0, y: 0, zoom: 1 } }
}
