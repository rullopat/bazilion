// Canonical entity shapes. The daemon's DB schema (apps/daemon/src/core/db)
// produces these, the daemon serialises them onto the wire, every client
// (web, mobile, cli, future SDKs) consumes them. Owned here so clients never
// have to reach into daemon source (which carries node:sqlite) just to know
// what an Agent is.

export type Timestamp = number

/**
 * A team is a collaboration context: one filesystem root, one USER.md
 * (read-only to agents, edited by the human), one roster of member agents.
 * Every agent belongs to exactly one team.
 */
export interface Team {
  id: string
  name: string
  path: string
  /** Read-only context about the human for all agents in this team.
   * Injected into the system prompt; never exposed as a file on disk. */
  userMd: string
  /**
   * Optional Telegram forum-topic name template for this team's agents.
   * `null` = built-in naming (bare name for `default`, `<slug> › <name>`
   * otherwise). When set, rendered with {agent.name}, {team.name},
   * {team.slug}. Must contain {agent.name} so topics stay distinct.
   */
  telegramTopicNameFormat: string | null
  createdAt: Timestamp
}

export type SkillsMode = 'all' | 'selected'

export interface Profile {
  id: string
  name: string
  dir: string
  defaultModel: string
  skillsMode: SkillsMode
  createdAt: Timestamp
  updatedAt: Timestamp
  /** Creation-time policy defaults. Missing/null is neutral; runtime never inherits it. */
  communicationDefaults?: ProfileCommunicationDefaults | null
}

export type ProfilePeerDefault = 'inherit_team_policy' | 'allow_all' | 'deny_all'

export interface ProfileCommunicationDefaults {
  userInput: boolean
  userOutput: boolean
  outsideTeamInput: boolean
  outsideTeamOutput: boolean
  peerDefault: ProfilePeerDefault
}

export type TeamPolicyPlacement = 'isolated' | 'profile_defaults' | 'template_snapshot'
export type TemplateEndpointKind = 'user' | 'outside_team' | 'slot'
export type LiveEndpointKind = 'user' | 'outside_team' | 'agent'

export type CommunicationEndpoint =
  | { kind: 'agent'; id: string }
  | { kind: 'user'; teamId: string }
  | { kind: 'outside_team'; teamId: string }
export type CommunicationChannel = 'same_team' | 'cross_team' | 'user' | 'outside_team'
export type CommunicationEdgePosture = 'allow' | 'approval_required'
export type CommunicationDecision = 'allow' | 'deny' | 'approval_required'
export interface CommunicationPolicyRef {
  teamId: string
  revision: number
}
export interface CommunicationComponentOutcome {
  teamId: string
  edge: string
  matched: boolean
  posture: CommunicationEdgePosture | null
}
export interface CommunicationAuthorizationResult {
  decision: CommunicationDecision
  channel: CommunicationChannel
  reasonCode: string
  reason: string
  policyRefs: CommunicationPolicyRef[]
  componentOutcomes: CommunicationComponentOutcome[]
  matchedEdgeIds: string[]
  requiredEdgeIds: string[]
}

export interface TeamPolicyBlockEvent {
  id: string
  attempt_kind: string
  attempt_id: string
  operation: string
  source_kind: string
  source_id: string
  target_kind: string
  target_id: string
  source_team_id: string
  target_team_id: string
  channel: CommunicationChannel
  origin: string
  reason_code: string
  reason: string
  created_at: Timestamp
  policyRefs: CommunicationPolicyRef[]
  componentOutcomes: CommunicationComponentOutcome[]
  matchedEdgeIds: string[]
  requiredEdgeIds: string[]
}

export interface TeamPolicyBlockPage {
  blocks: TeamPolicyBlockEvent[]
  nextCursor: string | null
}

export interface TeamTemplate {
  id: string
  name: string
  userMd: string | null
  currentRevision: number
  deletedAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface TeamTemplateSlot {
  templateId: string
  slotId: string
  position: number
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
  layoutPosition: { x: number; y: number } | null
  display: Record<string, unknown> | null
  tombstonedAt: Timestamp | null
}

export interface TeamTemplateEdge {
  templateId: string
  sourceKind: TemplateEndpointKind
  sourceId: string | null
  targetKind: TemplateEndpointKind
  targetId: string | null
  posture: CommunicationEdgePosture
}

export interface TeamTemplateRevision {
  templateId: string
  revision: number
  name: string
  userMd: string | null
  slots: TeamTemplateSlot[]
  edges: TeamTemplateEdge[]
  createdAt: Timestamp
}

export interface TeamTemplateDetail {
  template: TeamTemplate
  slots: TeamTemplateSlot[]
  edges: TeamTemplateEdge[]
  currentSnapshot: TeamTemplateRevision
}

export interface TeamTemplateWithCount extends TeamTemplate {
  slotCount: number
}

export interface TeamPolicy {
  teamId: string
  revision: number
  baselineInstantiationId: string | null
  updatedAt: Timestamp
}

export interface TeamPolicyEdge {
  teamId: string
  sourceKind: LiveEndpointKind
  sourceId: string | null
  targetKind: LiveEndpointKind
  targetId: string | null
  posture: CommunicationEdgePosture
}

export type CommunicationApprovalStatus =
  | 'pending'
  | 'approved'
  | 'denied'
  | 'expired'
  | 'cancelled'
  | 'delivering'
  | 'delivered'
  | 'delivery_failed'

export interface CommunicationApproval {
  id: string
  attemptKind: string
  attemptId: string
  operation: string
  source: CommunicationEndpoint
  target: CommunicationEndpoint
  sourceTeamId: string | null
  targetTeamId: string | null
  channel: CommunicationChannel
  origin: string
  requester: string
  policyRefs: CommunicationPolicyRef[]
  requiredEdgeIds: string[]
  payloadKind: string
  status: CommunicationApprovalStatus
  expiresAt: Timestamp
  decidedAt: Timestamp | null
  decidedBy: string | null
  decisionReason: string | null
  deliveryError: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface CommunicationApprovalDetail extends CommunicationApproval {
  payload: unknown
  events: CommunicationApprovalEvent[]
}

export interface CommunicationApprovalEvent {
  id: string
  approvalId: string
  event:
    | 'requested'
    | 'approved'
    | 'denied'
    | 'expired'
    | 'cancelled'
    | 'delivery_started'
    | 'delivered'
    | 'delivery_failed'
  actor: string
  detail: string | null
  createdAt: Timestamp
}

export interface TemplateInstantiation {
  id: string
  teamId: string
  templateId: string
  templateRevision: number
  createdAt: Timestamp
}

export interface SourceSlotBinding {
  agentId: string
  instantiationId: string
  sourceSlotId: string
}

export interface TeamAgentState {
  agentId: string
  teamId: string
  position: { x: number; y: number } | null
  display: Record<string, unknown> | null
}

export interface TeamPolicyDetail {
  teamPolicy: TeamPolicy
  edges: TeamPolicyEdge[]
  instantiations: TemplateInstantiation[]
  bindings: SourceSlotBinding[]
  agentState: TeamAgentState[]
}

export interface ResolvedTeamPolicy extends TeamPolicyDetail {
  baseline: TemplateInstantiation | null
  /** Canonical membership projection; includes archived Agents. */
  members: Agent[]
}

export type AgentStatus = 'idle' | 'running' | 'archived'

export type ReasoningLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export const REASONING_LEVELS: ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]

/**
 * Telegram outbound-mirror verbosity per agent.
 *   'minimal' — final assistant message only (default).
 *   'verbose' — also surfaces concise tool-call summary lines.
 */
export type TelegramMirrorMode = 'minimal' | 'verbose'

export interface Agent {
  id: string
  profileId: string
  name: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel
  status: AgentStatus
  dir: string
  /** The team this agent belongs to. Every agent has exactly one. */
  teamId: string
  /**
   * Forum-topic id this agent is bound to in the configured Telegram
   * supergroup, or `null` when unbound. Web UI shows binding state +
   * deep-link based on this.
   */
  telegramTopicId: number | null
  /** Verbosity of the Telegram outbound mirror for this agent (Step 6). */
  telegramMirrorMode: TelegramMirrorMode
  /**
   * Per-agent override of the forum-topic emoji icon (a single emoji char,
   * e.g. "📚"). `null` falls back to the profile-name default
   * (`BUILTIN_PROFILE_EMOJI`), then to color-only. Resolved to a Telegram
   * custom_emoji_id at topic-creation time.
   */
  telegramIconEmoji: string | null
  createdAt: Timestamp
  archivedAt: Timestamp | null
  /**
   * Structured fields parsed from the agent's own IDENTITY.md (name, emoji,
   * creature, vibe, avatar). File-derived, not a DB column — populated by the
   * agent list + detail routes, omitted (undefined) by the bare repo reads.
   * `null` once parsed means the file has no real values yet (still the
   * placeholder template). Lets the UI show avatar/creature without an extra
   * round-trip.
   */
  identity?: AgentIdentityFile | null
}

export interface AgentSkillAttachment {
  agentId: string
  skillName: string
  attachedAt: Timestamp
}

export type TelegramAclRole = 'owner' | 'member'

/**
 * A Telegram user allowed to use the bot (Phase 7). Flat scope: presence in
 * this list grants commands + chat. `owner` can manage the list and can't be
 * removed; `member` can use the bot but not manage it.
 */
export interface TelegramAllowedUser {
  userId: number
  username: string | null
  label: string | null
  role: TelegramAclRole
  addedAt: Timestamp
}

export interface SkillMeta {
  name: string
  source: string | null
  importedAt: Timestamp | null
}

export interface Message {
  id: string
  fromAgentId: string
  toAgentId: string
  replyTo: string | null
  causalChainId: string
  causalHop: number
  payload: string
  createdAt: Timestamp
  readAt: Timestamp | null
}

export interface AgentLoopBreakEvent {
  id: string
  causalChainId: string
  parentMessageId: string | null
  fromAgentId: string
  toAgentId: string
  sourceTeamId: string
  targetTeamId: string
  attemptedHop: number
  maxHops: number
  reason: string
  origin: string
  createdAt: Timestamp
}

export interface WebToken {
  id: string
  label: string
  createdAt: Timestamp
  lastUsedAt: Timestamp | null
  revokedAt: Timestamp | null
}

export type TriggerKind = 'interval' | 'cron'

export interface AgentTrigger {
  id: string
  agentId: string
  kind: TriggerKind
  intervalSec: number | null
  cronExpr: string | null
  message: string
  enabled: boolean
  lastFiredAt: Timestamp | null
  createdAt: Timestamp
}

export type TriggerDispatchStatus =
  | 'pending'
  | 'running'
  | 'retrying'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

export interface TriggerDispatch {
  id: string
  triggerId: string
  agentId: string
  scheduledAt: Timestamp
  status: TriggerDispatchStatus
  attemptCount: number
  nextAttemptAt: Timestamp
  leaseExpiresAt: Timestamp | null
  startedAt: Timestamp | null
  finishedAt: Timestamp | null
  lastError: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface OpenAICodexStatus {
  connected: boolean
  /** Unix ms expiry of the current access token; null if disconnected. */
  expiresAt: number | null
  /** chatgpt_account_id extracted from the JWT, when available. */
  accountId: string | null
}

export interface AgentIdentityFile {
  name?: string
  emoji?: string
  theme?: string
  creature?: string
  vibe?: string
  avatar?: string
}

export interface ResolvedAgent {
  agent: Agent
  profile: Profile
  model: string
  reasoningLevel: ReasoningLevel
  team: Team
  skills: string[]
}

export type McpTransport = 'stdio' | 'http' | 'sse'

/** A configured MCP server. The bearer token (http/sse) is never returned. */
export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  /** stdio only — executable to spawn. */
  command: string | null
  /** stdio only — arguments. */
  args: string[]
  /** http/sse only — endpoint URL. */
  url: string | null
  /** Whether a bearer token is stored for this server (http/sse). */
  hasAuthToken: boolean
  enabled: boolean
  createdAt: number
  updatedAt: number
}

/** Create/update payload for an MCP server. `authToken` is write-only. */
export interface McpServerInput {
  name: string
  transport: McpTransport
  command?: string | null
  args?: string[]
  url?: string | null
  /** Bearer token for http/sse; stored encrypted. Pass null to clear. */
  authToken?: string | null
  enabled?: boolean
}

/** One tool discovered on an MCP server (returned by the test/connect endpoint). */
export interface McpToolInfo {
  name: string
  description: string
}

export interface LoadedProfile {
  profile: Profile
  defaultSkills: string[]
  files: {
    soul: string
    identity: string
    bootstrap: string | null
    agents: string | null
    tools: string | null
  }
  /** Structured fields parsed from IDENTITY.md — null when no values are set. */
  identity: AgentIdentityFile | null
  communicationDefaults?: ProfileCommunicationDefaults | null
}
