import type {
  CommunicationEdgePosture,
  HarnessTemplateDetail,
  HarnessTemplateEdgeInput,
  HarnessTemplateSlotInput,
  LiveHarnessEdge,
  LiveHarnessEdgeInput,
  ReasoningLevel,
  TemplateEndpointKind,
} from '@bazilion/api-types'

export const HARNESS_INTERCHANGE_VERSION = 1 as const
export const TEAM_DOCUMENT_KIND = 'bazilion.team-template' as const
export const GROUP_POLICY_DOCUMENT_KIND = 'bazilion.group-policy' as const

export interface TeamTemplateDocument {
  version: 1
  kind: typeof TEAM_DOCUMENT_KIND
  template: { id: string; name: string; userMd: string | null }
  slots: Array<{
    key: string
    profileId: string
    agentName: string
    modelOverride: string | null
    reasoningLevel: ReasoningLevel | null
    layoutPosition: { x: number; y: number } | null
    display: Record<string, unknown> | null
  }>
  edges: Array<{
    sourceKind: TemplateEndpointKind
    sourceKey: string | null
    targetKind: TemplateEndpointKind
    targetKey: string | null
    posture: CommunicationEdgePosture
  }>
}

export interface GroupPolicyDocument {
  version: 1
  kind: typeof GROUP_POLICY_DOCUMENT_KIND
  groupId: string
  expectedRevision: number
  edges: LiveHarnessEdgeInput[]
}

const reasoning = new Set<ReasoningLevel>(['off', 'minimal', 'low', 'medium', 'high', 'xhigh'])
const templateKinds = new Set(['user', 'outside_group', 'slot'])
const liveKinds = new Set(['user', 'outside_group', 'agent'])

function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(`${label} must be an object`)
  return value as Record<string, unknown>
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required`)
  return value.trim()
}

function nullableText(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new Error(`${label} must be a string or null`)
  return value
}

function endpointKey(kind: string, key: string | null): string {
  return `${kind}:${key ?? '-'}`
}

export function exportTeamDocument(detail: HarnessTemplateDetail): TeamTemplateDocument {
  const keyById = new Map(detail.slots.map((slot, index) => [slot.slotId, `slot-${index + 1}`]))
  return {
    version: HARNESS_INTERCHANGE_VERSION,
    kind: TEAM_DOCUMENT_KIND,
    template: {
      id: detail.template.id,
      name: detail.template.name,
      userMd: detail.template.userMd,
    },
    slots: detail.slots.map((slot) => ({
      key: keyById.get(slot.slotId) as string,
      profileId: slot.profileId,
      agentName: slot.agentName,
      modelOverride: slot.modelOverride,
      reasoningLevel: slot.reasoningLevel,
      layoutPosition: slot.layoutPosition,
      display: slot.display,
    })),
    edges: detail.edges.map((edge) => ({
      sourceKind: edge.sourceKind,
      sourceKey: edge.sourceKind === 'slot' ? (keyById.get(edge.sourceId ?? '') ?? null) : null,
      targetKind: edge.targetKind,
      targetKey: edge.targetKind === 'slot' ? (keyById.get(edge.targetId ?? '') ?? null) : null,
      posture: edge.posture,
    })),
  }
}

export function parseTeamDocument(value: unknown): TeamTemplateDocument {
  const root = object(value, 'document')
  if (root.version !== HARNESS_INTERCHANGE_VERSION)
    throw new Error(`unsupported harness document version: ${String(root.version)}`)
  if (root.kind !== TEAM_DOCUMENT_KIND)
    throw new Error(`invalid document kind: expected ${TEAM_DOCUMENT_KIND}`)
  const meta = object(root.template, 'template')
  const rawSlots = Array.isArray(root.slots) ? root.slots : null
  const rawEdges = Array.isArray(root.edges) ? root.edges : null
  if (!rawSlots || !rawEdges) throw new Error('slots and edges must be arrays')
  const keys = new Set<string>()
  const slots = rawSlots.map((raw, index) => {
    const slot = object(raw, `slot ${index}`)
    const key = text(slot.key, `slot ${index} key`)
    if (keys.has(key)) throw new Error(`duplicate slot key: ${key}`)
    keys.add(key)
    const level = slot.reasoningLevel
    if (level !== null && level !== undefined && !reasoning.has(level as ReasoningLevel))
      throw new Error(`slot ${index} has invalid reasoningLevel`)
    const position = slot.layoutPosition
    if (
      position !== null &&
      position !== undefined &&
      (!position ||
        typeof position !== 'object' ||
        Array.isArray(position) ||
        !Number.isFinite((position as { x?: number }).x) ||
        !Number.isFinite((position as { y?: number }).y))
    )
      throw new Error(`slot ${index} has invalid layoutPosition`)
    const display = slot.display
    if (
      display !== null &&
      display !== undefined &&
      (!display || typeof display !== 'object' || Array.isArray(display))
    )
      throw new Error(`slot ${index} has invalid display`)
    return {
      key,
      profileId: text(slot.profileId, `slot ${index} profileId`),
      agentName: text(slot.agentName, `slot ${index} agentName`),
      modelOverride: nullableText(slot.modelOverride, `slot ${index} modelOverride`),
      reasoningLevel: (level as ReasoningLevel | null | undefined) ?? null,
      layoutPosition: (position as { x: number; y: number } | null | undefined) ?? null,
      display: (display as Record<string, unknown> | null | undefined) ?? null,
    }
  })
  const seen = new Set<string>()
  const edges = rawEdges.map((raw, index) => {
    const edge = object(raw, `edge ${index}`)
    if (!templateKinds.has(String(edge.sourceKind)) || !templateKinds.has(String(edge.targetKind)))
      throw new Error(`edge ${index} has invalid endpoint kind`)
    const sourceKind = edge.sourceKind as TemplateEndpointKind
    const targetKind = edge.targetKind as TemplateEndpointKind
    const sourceKey = nullableText(edge.sourceKey, `edge ${index} sourceKey`)
    const targetKey = nullableText(edge.targetKey, `edge ${index} targetKey`)
    const posture: CommunicationEdgePosture | null =
      edge.posture === undefined || edge.posture === 'allow'
        ? 'allow'
        : edge.posture === 'approval_required'
          ? 'approval_required'
          : null
    if (!posture) throw new Error(`edge ${index} has invalid posture`)
    if ((sourceKind === 'slot') !== Boolean(sourceKey))
      throw new Error(`edge ${index} source slot key is missing or invalid`)
    if ((targetKind === 'slot') !== Boolean(targetKey))
      throw new Error(`edge ${index} target slot key is missing or invalid`)
    if (sourceKey && !keys.has(sourceKey))
      throw new Error(`edge ${index} references missing slot ${sourceKey}`)
    if (targetKey && !keys.has(targetKey))
      throw new Error(`edge ${index} references missing slot ${targetKey}`)
    const signature = `${endpointKey(sourceKind, sourceKey)}->${endpointKey(targetKind, targetKey)}`
    if (endpointKey(sourceKind, sourceKey) === endpointKey(targetKind, targetKey))
      throw new Error(`edge ${index} is a self edge`)
    if (seen.has(signature)) throw new Error(`duplicate edge: ${signature}`)
    seen.add(signature)
    return { sourceKind, sourceKey, targetKind, targetKey, posture }
  })
  return {
    version: 1,
    kind: TEAM_DOCUMENT_KIND,
    template: {
      id: text(meta.id, 'template id'),
      name: text(meta.name, 'template name'),
      userMd: nullableText(meta.userMd, 'template userMd'),
    },
    slots,
    edges,
  }
}

export function teamImportBody(document: TeamTemplateDocument, existing?: HarnessTemplateDetail) {
  const currentByKey = existing
    ? new Map(existing.slots.map((slot, index) => [`slot-${index + 1}`, slot.slotId]))
    : new Map<string, string>()
  const slots: HarnessTemplateSlotInput[] = document.slots.map((slot) => ({
    ...(currentByKey.has(slot.key)
      ? { slotId: currentByKey.get(slot.key) }
      : { clientKey: slot.key }),
    profileId: slot.profileId,
    agentName: slot.agentName,
    modelOverride: slot.modelOverride,
    reasoningLevel: slot.reasoningLevel,
    layoutPosition: slot.layoutPosition,
    display: slot.display,
  }))
  const idByKey = new Map(
    slots.map((slot, index) => [
      document.slots[index]?.key as string,
      slot.slotId ?? slot.clientKey ?? null,
    ]),
  )
  const edges: HarnessTemplateEdgeInput[] = document.edges.map((edge) => ({
    sourceKind: edge.sourceKind,
    sourceId: edge.sourceKind === 'slot' ? idByKey.get(edge.sourceKey ?? '') : null,
    targetKind: edge.targetKind,
    targetId: edge.targetKind === 'slot' ? idByKey.get(edge.targetKey ?? '') : null,
    posture: edge.posture,
  }))
  return { slots, edges }
}

export function parseGroupPolicyDocument(value: unknown): GroupPolicyDocument {
  const root = object(value, 'document')
  if (root.version !== 1)
    throw new Error(`unsupported harness document version: ${String(root.version)}`)
  if (root.kind !== GROUP_POLICY_DOCUMENT_KIND)
    throw new Error(`invalid document kind: expected ${GROUP_POLICY_DOCUMENT_KIND}`)
  if (!Number.isInteger(root.expectedRevision) || Number(root.expectedRevision) < 1)
    throw new Error('expectedRevision must be a positive integer')
  if (!Array.isArray(root.edges)) throw new Error('edges must be an array')
  const seen = new Set<string>()
  const edges = root.edges.map((raw, index) => {
    const edge = object(raw, `edge ${index}`)
    if (!liveKinds.has(String(edge.sourceKind)) || !liveKinds.has(String(edge.targetKind)))
      throw new Error(`edge ${index} has invalid endpoint kind`)
    const sourceKind = edge.sourceKind as LiveHarnessEdgeInput['sourceKind']
    const targetKind = edge.targetKind as LiveHarnessEdgeInput['targetKind']
    const sourceId = nullableText(edge.sourceId, `edge ${index} sourceId`)
    const targetId = nullableText(edge.targetId, `edge ${index} targetId`)
    if (
      (sourceKind === 'agent') !== Boolean(sourceId) ||
      (targetKind === 'agent') !== Boolean(targetId)
    )
      throw new Error(`edge ${index} Agent id is missing or invalid`)
    const signature = `${endpointKey(sourceKind, sourceId)}->${endpointKey(targetKind, targetId)}`
    if (endpointKey(sourceKind, sourceId) === endpointKey(targetKind, targetId))
      throw new Error(`edge ${index} is a self edge`)
    if (seen.has(signature)) throw new Error(`duplicate edge: ${signature}`)
    seen.add(signature)
    return { sourceKind, sourceId, targetKind, targetId }
  })
  return {
    version: 1,
    kind: GROUP_POLICY_DOCUMENT_KIND,
    groupId: text(root.groupId, 'groupId'),
    expectedRevision: Number(root.expectedRevision),
    edges,
  }
}

export function exportGroupPolicy(
  groupId: string,
  revision: number,
  edges: LiveHarnessEdge[],
): GroupPolicyDocument {
  return {
    version: 1,
    kind: GROUP_POLICY_DOCUMENT_KIND,
    groupId,
    expectedRevision: revision,
    edges: edges.map(({ sourceKind, sourceId, targetKind, targetId, posture }) => ({
      sourceKind,
      sourceId,
      targetKind,
      targetId,
      posture,
    })),
  }
}

export function edgeDiff(
  before: Array<{
    sourceKind: string
    sourceId?: string | null
    targetKind: string
    targetId?: string | null
    posture?: CommunicationEdgePosture
  }>,
  after: Array<{
    sourceKind: string
    sourceId?: string | null
    targetKind: string
    targetId?: string | null
    posture?: CommunicationEdgePosture
  }>,
) {
  const signature = (edge: (typeof before)[number]) =>
    `${endpointKey(edge.sourceKind, edge.sourceId ?? null)} -> ${endpointKey(edge.targetKind, edge.targetId ?? null)} [${edge.posture ?? 'allow'}]`
  const left = new Set(before.map(signature))
  const right = new Set(after.map(signature))
  return {
    added: [...right].filter((value) => !left.has(value)).sort(),
    removed: [...left].filter((value) => !right.has(value)).sort(),
  }
}
