import type { ProviderMessage, ReasoningLevel, ToolCall, ToolDef } from '@bazilion/api-types'

export interface ProviderRequest {
  model: string
  system?: string
  messages: ProviderMessage[]
  tools?: ToolDef[]
  temperature?: number
  maxTokens?: number
  /** Reasoning/thinking level — only honored by providers/models that support it. */
  reasoning?: ReasoningLevel
  /** Cancels the in-flight provider call. Providers forward it to fetch(). */
  signal?: AbortSignal
  /** Optional token-delta callback. Fires once per streamed text chunk as the response assembles. */
  onDelta?: (delta: string) => void
}

export type StopReason = 'stop' | 'tool_use' | 'length' | 'error'

export interface ProviderResponse {
  content: string
  toolCalls: ToolCall[]
  stopReason: StopReason
  usage?: {
    promptTokens: number
    completionTokens: number
  }
}

export interface Provider {
  name: string
  chat(request: ProviderRequest): Promise<ProviderResponse>
}
