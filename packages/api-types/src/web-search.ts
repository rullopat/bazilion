export interface WebFetchEvidence {
  requestedUrl: string
  /** Effective source identity observed locally; unknown for third-party rendering. */
  finalUrl: string | null
  status: number | null
  directFetch?: { finalUrl: string; status: number }
  rendererReported?: { url: string | null; status: number | null }
  fetchedAt: number
  cacheHit: boolean
  truncated: boolean
  renderer: 'direct' | 'firecrawl'
}

/** Public search evidence is not a receipt that the Agent read the cited source. */
export interface SearchResults {
  results: Array<{ title: string; url: string; snippet: string }>
  backend: string
}

export type NativeSearchProvider = 'openai' | 'openai-codex'
export type SearchRoute = 'auto' | 'brave' | 'searxng' | NativeSearchProvider
export type SearchMode = 'cached' | 'live'

export interface NativeSearchAnswer {
  kind: 'grounded_answer'
  backend: NativeSearchProvider
  model: string
  answer: string
  citations: Array<{ title: string; url: string }>
  evidence: {
    responseId: string
    searchCallIds: string[]
    /** Actual evidence origin; completed_stream does not imply terminal output contained items. */
    outputSource: 'terminal' | 'completed_stream'
    requestedMode: SearchMode
    /** Provider output does not currently attest cache/network execution mode. */
    observedMode: 'unknown'
    usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null }
  }
}

export type WebSearchOutput = SearchResults | NativeSearchAnswer
export interface WebSearchArgs {
  query: string
  count?: number
  /** Native hosted search only; managed backends refuse rather than ignore this restriction. */
  allowedDomains?: string[]
}

export interface OrdinarySearchStatus {
  state: 'configured' | 'disabled' | 'unavailable'
  route: SearchRoute | null
  model: string | null
  account: 'api' | 'subscription' | 'managed' | null
  mode: SearchMode
  qualification: 'unqualified' | 'not_applicable'
  message: string
}
