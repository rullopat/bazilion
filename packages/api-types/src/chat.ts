import type { BashApprovalMode, CommandApproval, ProviderMessage } from './events.ts'

/**
 * A file the user attaches to a chat message. The daemon sends `image/*` to the model as vision
 * input and stores anything else on disk, telling the agent its path.
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
  /** Whether a human can answer shell approvals; omitted means dangerous commands are denied. */
  bashApprovalMode?: BashApprovalMode
  /** Live clarification support, independent of shell approvals. Omit for piped clients. */
  questionMode?: 'web' | 'tty'
}

export interface CommandApprovalDecisionRequest {
  decision: 'allow' | 'deny'
}

export interface CommandApprovalDecisionResponse {
  approval: CommandApproval
}

export interface ListCommandApprovalsResponse {
  approvals: CommandApproval[]
}

export interface TruncateChatRequest {
  /** Number of leading messages to preserve; everything after is dropped. */
  keepCount: number
  /** The conversation the count refers to; refused when the Agent has switched to another. */
  conversationId?: string
}

export interface TruncateChatResponse {
  before: number
  after: number
}

/**
 * Has anything new happened on this agent's session? The web chat polls it to notice turns run
 * elsewhere (inbox wakes, triggers, other tabs): the session file only grows, so a new name or a
 * bigger size means new entries.
 */
export interface SessionHeadResponse {
  /** The selected conversation's transcript exists in metadata but cannot be read. */
  unavailable?: boolean
  /** The selected conversation; null before the Agent's first turn. */
  conversationId: string | null
  /** Basename of the selected `.jsonl` session file, or `null` if none. */
  file: string | null
  /** Byte size of that file (monotonically increasing while in use). */
  size: number
}

/** `GET /api/agents/:id/sessions/messages`: the selected conversation for the chat's first paint. */
export interface SessionMessagesResponse {
  messages: ProviderMessage[]
  head: SessionHeadResponse
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
  /** Char count of the skill's SKILL.md, which the system prompt carries. */
  blockChars: number
}

export interface ContextTeamEntry {
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
  /** Approximate characters the branch sends the model (`tokensEstimate` × 4). */
  chars: number
  /** Byte size of the conversation's session file on disk. */
  bytes: number
  /** Pi's token estimate (chars / 4) for history alone. */
  tokensEstimate: number
}

/** `GET /api/agents/:id/chat/context`: what a turn of the agent would be given. */
export interface ChatContextResponse {
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
  team: ContextTeamEntry
  history: ContextHistoryBreakdown
  /** Sum of system prompt + tool schemas + history, in chars + tokens. */
  totals: { chars: number; tokens: number }
}

export interface ChatCompactRequest {
  /**
   * Ignored: Pi decides how much recent history stays verbatim. Kept only until
   * `bazilion agent compact --keep-tail` and the web `/compact N` stop sending it.
   */
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
