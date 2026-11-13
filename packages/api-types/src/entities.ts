// Entity shapes: the daemon reads them from its database and sends them as they are, and the CLI
// and the web consume them.

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
  /** Who may message whom inside the Team; see TeamPolicy. */
  policyMode: TeamPolicyMode
  createdAt: Timestamp
}

/** The Team and the Profile first-run setup creates. */
export const DEFAULT_TEAM_ID = 'default'
export const DEFAULT_PROFILE_ID = 'default'

export type SkillsMode = 'all' | 'selected'

export interface Profile {
  id: string
  name: string
  dir: string
  defaultModel: string
  skillsMode: SkillsMode
  createdAt: Timestamp
  updatedAt: Timestamp
}

/**
 * open: Team members may message each other freely. restricted: a member may message a
 * teammate only along an allow edge. Messages between Teams always need an edge to
 * `outside` in the sender's Team and one from `outside` in the recipient's Team.
 */
export type TeamPolicyMode = 'open' | 'restricted'

/** Edge endpoint standing for every Agent in other Teams. */
export const OUTSIDE_TEAM = 'outside'

/** Directed allow edge between a member Agent id and another member or `outside`. */
export interface TeamPolicyEdge {
  from: string
  to: string
}

export interface TeamPolicy {
  teamId: string
  mode: TeamPolicyMode
  edges: TeamPolicyEdge[]
  /** The Team's members, archived Agents included. */
  members: Agent[]
}

export interface TeamTemplateSlot {
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
  /** Node position in the template's Flow editor. */
  layoutPosition: { x: number; y: number } | null
}

/** A slot position (index into `slots`) or `outside`. */
export type TeamTemplateEndpoint = number | typeof OUTSIDE_TEAM

export interface TeamTemplateEdge {
  from: TeamTemplateEndpoint
  to: TeamTemplateEndpoint
}

/** A reusable roster: spawning it creates one Agent per slot plus the edges between them. */
export interface TeamTemplate {
  id: string
  name: string
  userMd: string | null
  policyMode: TeamPolicyMode
  slots: TeamTemplateSlot[]
  edges: TeamTemplateEdge[]
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type AgentStatus = 'idle' | 'archived'

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
  reviewEnabled: boolean
  reviewEveryNTurns: number
  reviewModel: string | null
  reviewReasoningLevel: ReasoningLevel
  reviewTurnsSinceLast: number
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
  /** Verbosity of the Telegram outbound mirror for this agent. */
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

export type AgentReviewStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type AgentReviewTrigger = 'cadence' | 'manual'

export interface AgentReview {
  id: string
  agentId: string
  status: AgentReviewStatus
  trigger: AgentReviewTrigger
  sourceSessionId: string | null
  sourceStartOrdinal: number | null
  sourceEndOrdinal: number | null
  inputCharacters: number
  turnsReviewed: number
  proposalCount: number
  startedAt: Timestamp | null
  finishedAt: Timestamp | null
  lastError: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export type AgentLessonScope = 'private' | 'shared'
export type AgentLessonStatus = 'pending' | 'approved' | 'rejected' | 'revoked'

export interface AgentLessonEvidence {
  sessionId: string
  entryOrdinal: number
  /** Redacted canonical-session excerpt, populated on read and never stored with the proposal. */
  excerpt?: string
}

export interface AgentLessonProposal {
  id: string
  reviewId: string
  agentId: string
  scope: AgentLessonScope
  text: string
  evidence: AgentLessonEvidence[]
  status: AgentLessonStatus
  version: number
  decidedAt: Timestamp | null
  revokedAt: Timestamp | null
  appliedKey: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface AgentSkillAttachment {
  agentId: string
  skillName: string
  attachedAt: Timestamp
}

export type TelegramAclRole = 'owner' | 'member'

/**
 * A Telegram user allowed to use the bot. Presence in this list grants
 * commands + chat. `owner` (the paired person) manages the list and can't be
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

/** Every token has full access. `expiresAt` null means it never expires. */
export interface WebToken {
  id: string
  label: string
  kind: 'bootstrap' | 'device'
  createdAt: Timestamp
  lastUsedAt: Timestamp | null
  expiresAt: Timestamp | null
  revokedAt: Timestamp | null
}

export interface WebSession {
  id: string
  /** The token (bootstrap or device) the browser logged in with. */
  tokenId: string
  tokenLabel: string
  createdAt: Timestamp
  lastSeenAt: Timestamp
  /** Moves forward on every use: a session ends once unused for 30 days. */
  expiresAt: Timestamp
  current: boolean
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

/** pending waits for a free Agent; each occurrence runs at most once. */
export type TriggerDispatchStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'

/** One scheduled occurrence of a trigger: the trigger's run history. */
export interface TriggerDispatch {
  conversationId: string
  id: string
  triggerId: string
  agentId: string
  scheduledAt: Timestamp
  status: TriggerDispatchStatus
  startedAt: Timestamp | null
  finishedAt: Timestamp | null
  error: string | null
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
  /** Human-approved, agent-private reviewed lessons injected on every normal turn. */
  privateLessons: string[]
}

export type McpTransport = 'stdio' | 'http'

/** A configured MCP server. The HTTP bearer token is never returned. */
export interface McpServer {
  id: string
  name: string
  transport: McpTransport
  /** stdio only — executable to spawn. */
  command: string | null
  /** stdio only — arguments. */
  args: string[]
  /** Streamable HTTP only — endpoint URL. */
  url: string | null
  /** Whether an HTTP bearer token is stored for this server. */
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
  /** HTTP bearer token; stored encrypted. Pass null to clear. */
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
}
