/**
 * What models were used for, read from the conversations' saved history: every reply, summary and
 * cache warm-up Pi records there, with its tokens and cost.
 */

/** How a provider charges: per use, through a subscription, or not at all (a server here). */
export type UsageBilling = 'paid' | 'plan' | 'local'

export interface UsageTotals {
  /** Model calls counted: replies, conversation summaries, cache warm-ups. */
  calls: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  /**
   * US dollars spent on providers paid per use: what the provider reported it billed, otherwise
   * Pi's catalog price for the tokens.
   */
  cost: number
  /** Some of `cost` is a catalog estimate rather than a billed amount. */
  estimated: boolean
  /** Tokens used through a subscription (a ChatGPT plan, Copilot, a token plan): no cost per use. */
  planTokens: number
  /** Tokens on a model server on this computer. */
  localTokens: number
  /** Tokens on providers paid per use whose model has no price in Pi's catalog: not in `cost`. */
  unpricedTokens: number
}

export interface UsageDay extends UsageTotals {
  /** `YYYY-MM-DD` in the report's time zone. */
  day: string
}

export interface UsageByAgent extends UsageTotals {
  agentId: string
  agentName: string
  teamId: string
  teamName: string
  archived: boolean
}

export interface UsageByTeam extends UsageTotals {
  teamId: string
  teamName: string
}

export interface UsageByModel extends UsageTotals {
  /** Pi's provider id, as the history records it. */
  provider: string
  /** The provider as Setup names it. */
  providerName: string
  model: string
  billing: UsageBilling
}

export interface UsageReport {
  /** The days counted, today included; null for everything saved. */
  days: number | null
  timeZone: string
  /** The first and last day counted (`YYYY-MM-DD`); `from` is null for everything saved. */
  from: string | null
  to: string
  totals: UsageTotals
  /** Every day of the period, oldest first (only days with use for everything saved). */
  byDay: UsageDay[]
  /** Most spent first, then most tokens. */
  byAgent: UsageByAgent[]
  byTeam: UsageByTeam[]
  byModel: UsageByModel[]
  /** Saved conversations that could not be read, and so are not counted. */
  unreadable: number
  /** The one Agent or Team counted, when the report is limited to it. */
  scope: { kind: 'agent' | 'team'; id: string; name: string } | null
}

/** One conversation's use, shown beside it in the conversation list. */
export interface ConversationUsage {
  calls: number
  totalTokens: number
  cost: number
  estimated: boolean
  planTokens: number
  localTokens: number
}

/** US dollars as Usage shows them: `$0.42`, `<$0.01`, `$1,234`. */
export function formatCost(usd: number): string {
  if (usd <= 0) return '$0.00'
  if (usd < 0.01) return '<$0.01'
  if (usd < 1000) return `$${usd.toFixed(2)}`
  return `$${Math.round(usd).toLocaleString('en-US')}`
}

/** A use in a few words: `$0.42 · 12k tokens`, `15k tokens, on a plan`, `3.1k tokens, local`. */
export function usageSummary(
  usage: Pick<UsageTotals, 'cost' | 'totalTokens' | 'planTokens' | 'localTokens'>,
): string {
  const tokens = `${formatTokens(usage.totalTokens)} tokens`
  if (usage.cost > 0) return `${formatCost(usage.cost)} · ${tokens}`
  if (usage.totalTokens > 0 && usage.planTokens === usage.totalTokens) return `${tokens}, on a plan`
  if (usage.totalTokens > 0 && usage.localTokens === usage.totalTokens) return `${tokens}, local`
  return tokens
}

/** A token count in a few characters: `950`, `12.5k`, `3.4M`. */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(Math.round(tokens))
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(tokens < 10_000 ? 1 : 0)}k`
  return `${(tokens / 1_000_000).toFixed(tokens < 10_000_000 ? 1 : 0)}M`
}
