// Canonical entity shapes. The daemon's DB schema (apps/daemon/src/core/db)
// produces these, the daemon serialises them onto the wire, every client
// (web, mobile, cli, future SDKs) consumes them. Owned here so clients never
// have to reach into daemon source (which carries node:sqlite) just to know
// what an Agent is.

export type Timestamp = number

/**
 * A group is a collaboration context: one filesystem root, one USER.md
 * (read-only to agents, edited by the human), one roster of member agents.
 * Every agent belongs to exactly one group.
 */
export interface Group {
  id: string
  name: string
  path: string
  /** Read-only context about the human for all agents in this group.
   * Injected into the system prompt; never exposed as a file on disk. */
  userMd: string
  /**
   * Optional Telegram forum-topic name template for this group's agents.
   * `null` = built-in naming (bare name for `default`, `<slug> › <name>`
   * otherwise). When set, rendered with {agent.name}, {group.name},
   * {group.slug}. Must contain {agent.name} so topics stay distinct.
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
  /** The group this agent belongs to. Every agent has exactly one. */
  groupId: string
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
}

export interface AgentSkillAttachment {
  agentId: string
  skillName: string
  attachedAt: Timestamp
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
  payload: string
  createdAt: Timestamp
  readAt: Timestamp | null
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
  group: Group
  skills: string[]
}

/**
 * A profile group is a reusable team template: an ordered list of slots,
 * each pointing at an existing Profile with optional per-slot overrides.
 * Spawning a profile group creates N agents in one transactional call.
 * Strictly additive — the single-profile spawn path is untouched.
 */
export interface ProfileGroup {
  id: string
  name: string
  /** Optional starter USER.md content; only seeded into a freshly-created target group. */
  userMd: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface ProfileGroupMember {
  profileGroupId: string
  position: number
  profileId: string
  agentName: string
  modelOverride: string | null
  reasoningLevel: ReasoningLevel | null
}

export interface ProfileGroupDetail {
  group: ProfileGroup
  members: ProfileGroupMember[]
}

export interface ProfileGroupWithCount extends ProfileGroup {
  memberCount: number
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
    heartbeat: string | null
  }
  /** Structured fields parsed from IDENTITY.md — null when no values are set. */
  identity: AgentIdentityFile | null
}
