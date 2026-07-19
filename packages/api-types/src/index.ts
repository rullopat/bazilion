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
  CommunicationApproval,
  CommunicationApprovalDetail,
  CommunicationApprovalEvent,
  CommunicationApprovalStatus,
  CommunicationAuthorizationResult,
  CommunicationChannel,
  CommunicationComponentOutcome,
  CommunicationDecision,
  CommunicationEdgePosture,
  CommunicationEndpoint,
  CommunicationPolicyRef,
  LiveEndpointKind,
  LoadedProfile,
  McpServer,
  McpServerInput,
  McpToolInfo,
  McpTransport,
  Message,
  OpenAICodexStatus,
  Profile,
  ProfileCommunicationDefaults,
  ProfilePeerDefault,
  ReasoningLevel,
  ResolvedAgent,
  ResolvedTeamPolicy,
  SkillMeta,
  SkillsMode,
  SourceSlotBinding,
  Team,
  TeamAgentState,
  TeamPolicy,
  TeamPolicyBlockEvent,
  TeamPolicyBlockPage,
  TeamPolicyDetail,
  TeamPolicyEdge,
  TeamPolicyPlacement,
  TeamTemplate,
  TeamTemplateDetail,
  TeamTemplateEdge,
  TeamTemplateRevision,
  TeamTemplateSlot,
  TeamTemplateWithCount,
  TelegramAclRole,
  TelegramAllowedUser,
  TelegramMirrorMode,
  TemplateEndpointKind,
  TemplateInstantiation,
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
  ToolResultImage,
} from './events.ts'
export type { MemoryEntry, MemoryHit } from './memory.ts'

import type {
  Agent,
  AgentTrigger,
  CommunicationEdgePosture,
  LiveEndpointKind,
  Message,
  ProfileCommunicationDefaults,
  ReasoningLevel,
  TeamPolicyPlacement,
  TelegramAclRole,
  TelegramMirrorMode,
  TemplateEndpointKind,
  WebToken,
} from './entities.ts'

export interface ApiError {
  error: string
  code?: string
  findings?: SkillScanFinding[]
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
  /** Team the new agent joins. */
  teamId: string
  teamExpectedRevision: number
  placement: Exclude<TeamPolicyPlacement, 'template_snapshot'>
}

export interface UpdateAgentRequest {
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel
  /** Step 6: per-agent Telegram outbound-mirror verbosity. */
  telegramMirrorMode?: TelegramMirrorMode
  /** Step 6: rename (mirrors the `name` field the daemon accepts on PATCH). */
  name?: string
  /**
   * Per-agent forum-topic emoji override (single emoji char). `null` or `''`
   * clears it (falls back to the profile default, then color-only).
   */
  telegramIconEmoji?: string | null
}

export interface AttachSkillRequest {
  skill: string
  /** Required when attaching a skill whose static scan has findings. */
  allowFindings?: boolean
}

/** Body for `PATCH /api/agents/:id/team`: move the agent to a new team. */
export interface MoveAgentRequest {
  teamId: string
  /** A move is revision-checked and requires an explicit policy placement. */
  sourceExpectedRevision: number
  destinationExpectedRevision: number
  placement: Exclude<TeamPolicyPlacement, 'template_snapshot'>
}

// --- canonical Team templates and Team policy ---

export interface TeamTemplateSlotInput {
  /** Existing stable slot. Omit for a new server-allocated slot. */
  slotId?: string
  /** Request-local reference used by edges for a new slot. */
  clientKey?: string
  profileId: string
  agentName: string
  modelOverride?: string | null
  reasoningLevel?: ReasoningLevel | null
  layoutPosition?: { x: number; y: number } | null
  display?: Record<string, unknown> | null
}

export interface TeamTemplateEdgeInput {
  sourceKind: TemplateEndpointKind
  sourceId?: string | null
  targetKind: TemplateEndpointKind
  targetId?: string | null
  posture?: CommunicationEdgePosture
}

export interface CreateTeamTemplateRequest {
  id: string
  name: string
  userMd?: string | null
}

export interface UpdateTeamTemplateRequest {
  expectedRevision: number
  name?: string
  userMd?: string | null
}

export interface PutTeamTemplateDefinitionRequest {
  expectedRevision: number
  slots: TeamTemplateSlotInput[]
  edges: TeamTemplateEdgeInput[]
}

export interface CloneTeamTemplateRequest {
  templateExpectedRevision: number
  id: string
  name?: string
}

export interface SpawnTeamTemplateRequest {
  templateExpectedRevision: number
  teamId: string
  teamExpectedRevision?: number
  mode: 'initialize' | 'append'
  userMd?: string
}

export interface TeamPolicyEdgeInput {
  sourceKind: LiveEndpointKind
  sourceId?: string | null
  targetKind: LiveEndpointKind
  targetId?: string | null
  posture?: CommunicationEdgePosture
}

export interface PutGroupTeamPolicyPolicyRequest {
  expectedRevision: number
  edges: TeamPolicyEdgeInput[]
}

export interface AdoptTeamTemplateRequest {
  teamExpectedRevision: number
  templateId: string
  templateExpectedRevision: number
  slotMappings: Array<{ slotId: string; agentId: string }>
  remainingPlacements: Array<{
    agentId: string
    placement: Exclude<TeamPolicyPlacement, 'template_snapshot'>
  }>
  previewEdges: TeamPolicyEdgeInput[]
}

export interface UpdateTeamPolicySourceRequest {
  teamExpectedRevision: number
  templateExpectedRevision: number
  includeAgentIds: string[]
}

export interface SaveTeamPolicyAsTemplateRequest {
  expectedRevision: number
  id: string
  name: string
  userMd?: string | null
}

export interface SendMessageRequest {
  from: string
  payload: { text: string }
  replyTo?: string
}

export interface CommunicationPendingResponse {
  code?: 'communication_pending'
  decision: 'approval_required'
  approvalId: string
  status: 'pending'
  expiresAt: number
  attemptKind: string
  attemptId: string
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
  /** Omit to leave unchanged; null clears the row. */
  communicationDefaults?: ProfileCommunicationDefaults | null
}

export interface CreateProfileRequest {
  id: string
  name?: string
  defaultModel: string
  skillsMode?: 'all' | 'selected'
  defaultSkills?: string[]
  /** Omit to create no defaults row. */
  communicationDefaults?: ProfileCommunicationDefaults
  /** Initial SOUL.md content. Falls back to the built-in template when omitted. */
  soul?: string
  /** Initial IDENTITY.md content. Falls back to the built-in template when omitted. */
  identity?: string
  /** Initial BOOTSTRAP.md content. Omit for default; pass null to skip bootstrap entirely. */
  bootstrap?: string | null
  /** Initial AGENTS.md content. Omit for the default template; pass null to skip the file. */
  agents?: string | null
  /** Initial TOOLS.md content. Omit for the default template; pass null to skip the file. */
  tools?: string | null
}

// --- teams ---

export interface RegisterTeamRequest {
  /** Slug (lowercase, digits, hyphens). Becomes the row id AND the directory
   * name under `~/.bazilion/teams/<slug>/`. */
  id: string
  /** Optional human-readable label. Defaults to `id`. */
  name?: string
  /**
   * Optional symlink target. When set, the daemon materializes the team
   * slot as a symlink to this absolute path instead of as a real directory
   * — useful for "agents working on my existing project tree." Target must
   * exist and be a directory.
   */
  link?: string
}

/** Body for `PUT /api/teams/:id/user-md`. */
export interface SetTeamUserMdRequest {
  userMd: string
}

/**
 * Body for `PUT /api/teams/:id/topic-format`. `null` (or an empty/whitespace
 * string) clears the template and reverts to built-in topic naming.
 */
export interface SetTeamTopicFormatRequest {
  format: string | null
}

/** Body for `POST /api/config/telegram/acl` — add a user to the allowlist. */
export interface AddTelegramAllowedUserRequest {
  userId: number
  username?: string | null
  label?: string | null
  /** Defaults to 'member' when omitted. */
  role?: TelegramAclRole
}

// --- skills (write) ---

export interface ImportSkillsRequest {
  source: string
  /** Overwrite existing skills and confirm static-scan warnings. */
  force?: boolean
}

export interface ImportSkillsResponse {
  imported: string[]
  skipped: { name: string; reason: string; findings?: SkillScanFinding[] }[]
  findings?: Record<string, SkillScanFinding[]>
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

/**
 * A file the user attaches to a chat message. One generic shape for everything;
 * the daemon classifies it at turn assembly: `image/*` goes to the model as
 * vision, anything else is stored on disk and referenced by path so the agent
 * decides how to process it.
 */
export interface Attachment {
  /** Original filename when known (used for stored non-image files). */
  name?: string
  /** e.g. "image/png", "application/pdf", "text/csv". */
  mimeType: string
  /** base64-encoded bytes (no data: prefix). */
  data: string
}

export interface ChatRequest {
  message: string
  /** Files attached to this message (images → vision; others → stored + referenced). */
  attachments?: Attachment[]
}

// --- profile files ---

export type ProfileFileName =
  | 'profile.json'
  | 'SOUL.md'
  | 'IDENTITY.md'
  | 'BOOTSTRAP.md'
  | 'AGENTS.md'
  | 'TOOLS.md'

export const PROFILE_FILES: ProfileFileName[] = [
  'profile.json',
  'SOUL.md',
  'IDENTITY.md',
  'BOOTSTRAP.md',
  'AGENTS.md',
  'TOOLS.md',
]

export interface FileContentResponse {
  content: string
}

export interface PutFileRequest {
  content: string
}

// --- skills ---

export type SkillScanSeverity = 'warning' | 'danger'

export interface SkillScanFinding {
  code: string
  severity: SkillScanSeverity
  message: string
  line?: number
}

export interface SkillInfo {
  name: string
  description: string
  source: string | null
  importedAt: number | null
  parseError?: string
  scanFindings?: SkillScanFinding[]
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
    /** Per-file breakdown of profile markdown sources. */
    files: ContextFileEntry[]
    /** Char count of the skill-list text rendered into the system prompt. */
    skillsListChars: number
    /** Char count of the team block rendered into the system prompt. */
    teamListChars: number
    /** Char count of the USER.md block (0 when the team's userMd is empty). */
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
  team: ContextGroupEntry
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

// --- scheduled triggers (interval / cron) ---

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
  /** Display grouping label (e.g. "Web tools"). Cards without a team are bucketed under "Other". */
  team?: string
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
    | { ok: true; profiles: number; activeAgents: number; totalAgents: number; teams: number }
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
  teamPolicyManagement: {
    contractVersion: number
    enforcementRequested: boolean
    enforcementActive: boolean
    releaseReady: boolean
    degraded: boolean
    decisions: { allowed: number; denied: number }
  }
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
  /**
   * Set when Telegram reported a `migrate_to_chat_id` for the configured
   * supergroup. The UI surfaces a "your chat id changed — reconnect" banner;
   * `POST /api/config/telegram/reconnect` applies it. Null when no migration
   * is pending.
   */
  migratedChatId: string | null
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
