// Wire-shape package. Hermetic: depends on nothing from the daemon, so every
// client (web, mobile, cli, future SDKs) can pull in API shapes without
// dragging Node-only code (node:sqlite, undici, pi-ai, the worker spawner)
// into its TS check graph or runtime bundle. The daemon imports its entity
// and wire types FROM here.

export type {
  Agent,
  AgentIdentityFile,
  AgentSkillAttachment,
  AgentStatus,
  AgentTrigger,
  Group,
  LoadedProfile,
  Message,
  OpenAICodexStatus,
  Profile,
  ProfileGroup,
  ProfileGroupDetail,
  ProfileGroupMember,
  ProfileGroupWithCount,
  ReasoningLevel,
  ResolvedAgent,
  SkillMeta,
  SkillsMode,
  TelegramMirrorMode,
  Timestamp,
  TriggerKind,
  WebToken,
} from './entities.ts'
export { REASONING_LEVELS } from './entities.ts'
export type {
  ChatFrame,
  ProviderMessage,
  Role,
  SessionEvent,
  ToolCall,
  ToolDef,
} from './events.ts'
export type { MemoryEntry, MemoryHit } from './memory.ts'

import type {
  Agent,
  AgentTrigger,
  Message,
  ReasoningLevel,
  TelegramMirrorMode,
  WebToken,
} from './entities.ts'

export interface ApiError {
  error: string
  code?: string
}

// --- agents ---

export interface ListAgentsQuery {
  includeArchived?: boolean
}

export interface SpawnAgentRequest {
  profileId: string
  name?: string
  model?: string
  reasoningLevel?: ReasoningLevel
  /** Group the new agent joins. Falls back to the seeded 'default' group when omitted. */
  groupId?: string
}

export interface UpdateAgentRequest {
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel
  /** Step 6: per-agent Telegram outbound-mirror verbosity. */
  telegramMirrorMode?: TelegramMirrorMode
  /** Step 6: rename (mirrors the `name` field the daemon accepts on PATCH). */
  name?: string
}

export interface AttachSkillRequest {
  skill: string
}

/** Body for `PATCH /api/agents/:id/group`: move the agent to a new group. */
export interface MoveAgentRequest {
  groupId: string
}

export interface SendMessageRequest {
  from: string
  payload: { text: string }
  replyTo?: string
}

export interface ListInboxQuery {
  unread?: boolean
}

export interface ListInboxResponse {
  messages: Message[]
}

export interface UpdateMessageRequest {
  read: true
}

// --- profiles ---

export interface UpdateProfileRequest {
  name?: string
  defaultModel?: string
  skillsMode?: 'all' | 'selected'
  defaultSkills?: string[]
}

export interface CreateProfileRequest {
  id: string
  name?: string
  defaultModel: string
  skillsMode?: 'all' | 'selected'
  defaultSkills?: string[]
  /** Initial SOUL.md content. Falls back to the built-in template when omitted. */
  soul?: string
  /** Initial IDENTITY.md content. Falls back to the built-in template when omitted. */
  identity?: string
  /** Initial BOOTSTRAP.md content. Omit for default; pass null to skip bootstrap entirely. */
  bootstrap?: string | null
  /** Initial AGENTS.md content. Omit to skip; pass a string to seed the file. */
  agents?: string
  /** Initial TOOLS.md content. Omit to skip; pass a string to seed the file. */
  tools?: string
  /** Initial HEARTBEAT.md content. Omit to skip; pass a string to seed the file. */
  heartbeat?: string
}

// --- profile groups ---

export interface CreateProfileGroupRequest {
  /** Slug (lowercase, digits, hyphens). Becomes the row id. */
  id: string
  /** Optional display name. Defaults to `id`. */
  name?: string
  /** Optional starter USER.md content. */
  userMd?: string
}

export interface UpdateProfileGroupRequest {
  name?: string
  /** Pass `null` to clear; omit to leave unchanged. */
  userMd?: string | null
}

/**
 * PUT-replace semantics: the entire member array is replaced atomically.
 * `position` is implicit from array order (0-based).
 * Duplicate `agentName` values across members are accepted at PUT time —
 * the spawn op auto-suffixes collisions with `-2`, `-3`, ... at spawn time.
 */
export interface PutProfileGroupMembersRequest {
  members: Array<{
    profileId: string
    agentName: string
    modelOverride?: string | null
    reasoningLevel?: ReasoningLevel | null
  }>
}

export interface SpawnProfileGroupRequest {
  /** Target group slug. Falls back to the default group when omitted. */
  groupSlug?: string
  /** Override the template's `userMd` for this spawn only. */
  userMd?: string
}

export interface SpawnProfileGroupResponse {
  groupSlug: string
  /** Created agents in spawn order, with their final (post-suffix) names. */
  agents: { id: string; name: string }[]
  /** Populated only when cleanup retries were exhausted during a rollback. */
  orphanAgentIds?: string[]
}

// --- groups ---

export interface RegisterGroupRequest {
  /** Slug (lowercase, digits, hyphens). Becomes the row id AND the directory
   * name under `~/.bazilion/groups/<slug>/`. */
  id: string
  /** Optional human-readable label. Defaults to `id`. */
  name?: string
  /**
   * Optional symlink target. When set, the daemon materializes the group
   * slot as a symlink to this absolute path instead of as a real directory
   * — useful for "agents working on my existing project tree." Target must
   * exist and be a directory.
   */
  link?: string
}

/** Body for `PUT /api/groups/:id/user-md`. */
export interface SetGroupUserMdRequest {
  userMd: string
}

// --- skills (write) ---

export interface ImportSkillsRequest {
  source: string
  force?: boolean
}

export interface ImportSkillsResponse {
  imported: string[]
  skipped: { name: string; reason: string }[]
}

// --- providers (write) ---

export interface ProviderTestRequest {
  model: string
  message?: string
}

export interface ProviderTestResponse {
  content: string
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

// --- chat streaming ---

export interface ChatRequest {
  message: string
}

// --- profile files ---

export type ProfileFileName =
  | 'profile.json'
  | 'SOUL.md'
  | 'IDENTITY.md'
  | 'BOOTSTRAP.md'
  | 'AGENTS.md'
  | 'TOOLS.md'
  | 'HEARTBEAT.md'

export const PROFILE_FILES: ProfileFileName[] = [
  'profile.json',
  'SOUL.md',
  'IDENTITY.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'TOOLS.md',
  'HEARTBEAT.md',
]

export interface FileContentResponse {
  content: string
}

export interface PutFileRequest {
  content: string
}

// --- skills ---

export interface SkillInfo {
  name: string
  description: string
  source: string | null
  importedAt: number | null
  parseError?: string
}

export interface ResolvedSkillsResponse {
  resolved: SkillInfo[]
  missing: { name: string; reason: string }[]
}

export interface TruncateChatRequest {
  /** Number of leading messages to preserve; everything after is dropped. */
  keepCount: number
}

export interface TruncateChatResponse {
  before: number
  after: number
}

/**
 * Lightweight "has anything new happened on this agent's session?" probe.
 * Polled by the web chat UI to detect out-of-band activity (inbox-wakes,
 * scheduled triggers, turns run from another tab) so it can prompt the user
 * to refresh — the session JSONL is append-only, so either a new filename or
 * a bigger byte-count means new entries landed.
 */
export interface SessionHeadResponse {
  /** Basename of the most-recent `.jsonl` session file, or `null` if none. */
  file: string | null
  /** Byte size of that file (monotonically increasing while in use). */
  size: number
}

export interface ContextFileEntry {
  /** Basename of the injected profile file (e.g. SOUL.md). */
  name: string
  /** Full character count of the file's contribution to the system prompt. */
  chars: number
  /** Rough token estimate (chars / 4). */
  tokens: number
}

export interface ContextToolEntry {
  name: string
  /** JSON schema char size (what the provider sees as tool definitions). */
  schemaChars: number
  /** Description char size. */
  descriptionChars: number
  /** Count of top-level properties on the input schema, when shaped like JSONSchema. */
  paramCount: number | null
}

export interface ContextSkillEntry {
  name: string
  /** Char count of the skill block injected into the system prompt (currently just the name). */
  blockChars: number
}

export interface ContextGroupEntry {
  id: string
  name: string
  path: string
  userMdChars: number
}

export interface ContextHistoryBreakdown {
  /** Count of `message` entries. */
  messageEntries: number
  /** Count of `compaction` entries (summarization boundaries). */
  compactionEntries: number
  /** Char sum of message `content` fields (LLM input surface). */
  chars: number
  /** Raw wire size of the serialized log on disk. */
  bytes: number
  /** Rough token estimate (chars / 4) for history alone. */
  tokensEstimate: number
}

export interface ChatContextResponse {
  /** Agent being reported on. */
  agentId: string
  /** provider:model string the agent currently resolves to. */
  model: string
  systemPrompt: {
    chars: number
    tokens: number
    /** Per-file breakdown of profile markdown sources (AGENTS.md, SOUL.md, TOOLS.md, IDENTITY.md, HEARTBEAT.md, BOOTSTRAP.md). */
    files: ContextFileEntry[]
    /** Char count of the skill-list text rendered into the system prompt. */
    skillsListChars: number
    /** Char count of the group block rendered into the system prompt. */
    groupListChars: number
    /** Char count of the USER.md block (0 when the group's userMd is empty). */
    userMdChars: number
    /** Fixed memory-hint block the runtime always appends. */
    memoryHintChars: number
  }
  tools: {
    count: number
    listChars: number
    schemaChars: number
    entries: ContextToolEntry[]
  }
  skills: {
    count: number
    entries: ContextSkillEntry[]
  }
  group: ContextGroupEntry
  history: ContextHistoryBreakdown
  /** Sum of system prompt + tool schemas + history, in chars + tokens. */
  totals: { chars: number; tokens: number }
}

export interface ChatCompactRequest {
  /** Number of trailing message entries to keep verbatim. Default 10. */
  keepTail?: number
  /** Optional freeform guidance prepended to the summarizer system prompt. */
  customInstructions?: string
}

export interface ChatCompactResponse {
  /** Entry count before compaction. */
  before: number
  /** Entry count after compaction (1 compaction + `keptTail` messages). */
  after: number
  /** Message entries summarized into the compaction (the head that was dropped). */
  summarized: number
  /** Message entries preserved verbatim after the compaction boundary. */
  keptTail: number
  /** Rough token estimate of the log before compaction. */
  tokensBefore: number
  /** Rough token estimate of the log after compaction. */
  tokensAfter: number
  /** The summary text produced by the model. */
  summary: string
}

// --- triggers (heartbeats / cron) ---

export interface CreateTriggerRequest {
  kind: 'interval' | 'cron'
  /** required when kind='interval' */
  intervalSec?: number
  /** required when kind='cron' — 5-field expression ("m h dom mon dow") */
  cronExpr?: string
  /** injected as the user message when the trigger fires */
  message: string
  enabled?: boolean
}

export interface UpdateTriggerRequest {
  enabled?: boolean
}

export interface CreateTriggerResponse {
  trigger: AgentTrigger
}

export interface UpdateTriggerResponse {
  trigger: AgentTrigger
}

export interface ListTriggersResponse {
  triggers: AgentTrigger[]
}

// --- config page (providers + services + fields) ---

/** Per-field UI + storage descriptor — source-of-truth is SERVICES in apps/daemon/src/core/services.ts. */
export interface ServiceFieldState {
  envVar: string
  kind: 'secret' | 'config'
  label: string
  placeholder?: string
  description?: string
  /** True when the field has a non-empty value in its storage backend. */
  set: boolean
  /** For `kind: 'config'` (plaintext): the actual value. Omitted for secrets. */
  value?: string
  /** For `kind: 'secret'`: a truncated preview like "sk-abc…" so the UI can confirm something is stored. Omitted when unset. */
  preview?: string
}

export interface ServiceCard {
  id: string
  displayName: string
  /** Present for category==='provider' cards — tracks whether the pi-adapter sees it as configured. */
  enabled?: boolean
  envHint?: string
  hint?: string
  /** Display grouping label (e.g. "Web tools"). Cards without a group are bucketed under "Other". */
  group?: string
  fields: ServiceFieldState[]
}

export interface ProviderConfigEntry extends ServiceCard {
  enabled: boolean
  envHint: string
  /** Static catalog from pi-ai's typed model list — empty for providers not in the catalog. */
  catalog: string[]
  /** Live `/v1/models` query — omitted when the provider doesn't expose one. */
  live?: { models: string[]; error?: string }
  /** Curated models the admin has selected — drives the dropdowns in profile/agent forms. */
  curated: string[]
}

export interface ProviderConfigResponse {
  providers: ProviderConfigEntry[]
}

export interface ServiceConfigResponse {
  services: ServiceCard[]
}

export interface SetFieldRequest {
  value: string
}

export interface SetProviderModelsRequest {
  models: string[]
}

export interface SetProviderModelsResponse {
  models: string[]
}

export interface SetProviderEnabledRequest {
  enabled: boolean
}

export interface SetProviderEnabledResponse {
  name: string
  enabled: boolean
}

// --- web tokens ---

export interface CreateTokenRequest {
  label: string
}

export interface CreateTokenResponse {
  /** Plaintext token — returned exactly once. */
  token: string
  meta: WebToken
}

export interface ListTokensResponse {
  tokens: WebToken[]
}

// --- health (doctor) ---

export interface HealthReport {
  ok: boolean
  home: string
  paths: {
    home: boolean
    db: boolean
    auth: boolean
    profiles: boolean
    agents: boolean
    skills: boolean
  }
  database:
    | { ok: true; profiles: number; activeAgents: number; totalAgents: number; groups: number }
    | { ok: false; error: string }
    | null
  skills: { installed: number; parseErrors: number }
  providers: {
    /** Names of cloud providers with credentials configured (e.g. ['anthropic', 'groq']). */
    configured: string[]
    lmstudio: { baseURL: string; hasKey: boolean }
    ollama: { baseURL: string }
  }
  webSearch: { bravePreview: string | null; searxngUrl: string | null }
  openclaw: { path: string; exists: boolean }
  triggers: { active: number; disabled: number }
  tokens: { active: number }
  scheduler: { enabled: boolean; tickMs: number }
}

// --- telegram integration ---

/** Body for `PUT /api/config/telegram` — both fields required; daemon stores each in its proper table. */
export interface TelegramConfigInput {
  /** Bot token from BotFather. Goes to the encrypted `secrets` table as TELEGRAM_BOT_TOKEN. */
  botToken: string
  /** Supergroup numeric chat id. Goes to the plaintext `config` table as TELEGRAM_CHAT_ID. */
  chatId: string
}

/**
 * The four preflight checks that must all pass before the integration is
 * considered usable. Each call is one-shot — no polling, no bot running.
 */
export interface TelegramPreflight {
  /** Bot identity from getMe. Username has no leading `@`. */
  botUsername: string
  /** Display name of the supergroup, from getChat. */
  chatTitle: string
  /** True iff the chat has forum topics enabled (the irreversible owner-only toggle). */
  isForum: boolean
  /** True iff the bot is admin in the supergroup with the can_manage_topics right. */
  hasManageTopics: boolean
  /** True iff Privacy Mode is OFF (getMe.can_read_all_group_messages). */
  privacyModeOff: boolean
}

/**
 * Live state of the polling singleton on the daemon side. `null` when no bot
 * is running (creds absent, or daemon hasn't activated yet); populated once
 * the bot has been started.
 *
 * `lastSuccessfulPollAt` is the epoch-ms timestamp of the most recent
 * `getUpdates` call that completed without throwing — drives the stall
 * watchdog (BAZILION_TELEGRAM_POLLING_STALL_MS, default 120000).
 *
 * `error` is the most recent failure surfaced by the bot or its runner — set
 * when polling crashed, cleared when polling resumes.
 *
 * `activated` flips to true after the one-time first-activation completes
 * (service chat created, directory message pinned, General hidden, commands
 * registered).
 */
export interface TelegramPollingState {
  running: boolean
  activated: boolean
  lastUpdateId: number | null
  lastSuccessfulPollAt: number | null
  startedAt: number | null
  error: string | null
}

/**
 * Response from `GET /api/config/telegram/health`. When credentials aren't
 * configured, `configured: false` and `preflight` is `null`. When credentials
 * are configured but a preflight call errored, `preflight` is `null` and
 * `error` carries the failing step + message.
 *
 * `polling` is `null` until Step 2 starts a bot; once activated, it carries
 * the live state of the polling singleton (running, watermark, last-poll
 * timestamp, any error). Drives the live "is the bot working?" indicator in
 * the web setup card.
 */
export interface TelegramHealth {
  configured: boolean
  preflight: TelegramPreflight | null
  error: {
    step: 'getMe' | 'getChat' | 'getChatMember'
    message: string
  } | null
  polling: TelegramPollingState | null
}

/**
 * Response from `GET /api/config/telegram` — what's stored, without exposing
 * the bot token plaintext. Used by the setup form to render "configured"
 * state on first load.
 */
export interface TelegramConfigState {
  /** True iff both botToken and chatId are present in storage. */
  configured: boolean
  /** Plaintext chat id (empty string when unset). */
  chatId: string
  /** Masked preview of the bot token like `1234567:AAHi…`. Empty when unset. */
  botTokenPreview: string
}

/**
 * Response from `POST /api/agents/:id/telegram/bind`. The full agent is
 * returned with telegramTopicId populated, plus a deep-link the client can
 * surface as a button. `created` distinguishes "we made a new topic" from
 * "agent was already bound".
 */
export interface TelegramBindResponse {
  agent: Agent
  topicId: number
  deepLink: string
  created: boolean
}
