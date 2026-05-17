// Adapter from Bazilion's Provider interface → pi-ai's streamSimple.
//
// Pi-ai (`@mariozechner/pi-ai`) is Mario Zechner's unified LLM SDK — 15+
// providers behind one event-stream API. This file is the only place in the
// codebase that touches pi-ai directly; everything else downstream
// (`runTurnStream`, `persistRun`, the worker entry, CLI, web) sees the same
// `Provider.chat(ProviderRequest): Promise<ProviderResponse>` contract it
// always has. That keeps the wire format, DB schema, and chat UI stable while
// giving us cost/usage, thinking levels, prompt caching, and every provider
// pi supports — for free.
//
// Model resolution: we prefer pi's typed catalog via `getModel(provider, id)`
// which carries cost + context-window metadata; for anything outside the
// catalog (local models, newly-released models, custom OpenAI-compat
// endpoints) we construct a `Model<>` literal with sensible defaults. This
// preserves Bazilion's "any model string" flexibility.

import type { ProviderMessage, ReasoningLevel, ToolCall, ToolDef } from '@bazilion/api-types'
import {
  type AssistantMessage,
  getModel,
  type Model,
  type Message as PiMessage,
  type Tool as PiTool,
  type ToolCall as PiToolCall,
  streamSimple,
  type TextContent,
  Type,
} from '@mariozechner/pi-ai'
import type { Provider, ProviderRequest, ProviderResponse, StopReason } from './types.ts'

export interface PiProviderConfig {
  /** Display name on the returned Provider; also the registry key (e.g. 'bedrock', 'azure-openai'). */
  providerName: string
  /** Pi's canonical provider name for catalog lookup (e.g. 'amazon-bedrock', 'azure-openai-responses'). Defaults to providerName. */
  piProviderName?: string
  /** Override baseUrl for openai-compat endpoints (lmstudio, ollama, custom). */
  baseUrl?: string
  /**
   * Static key or an async supplier. Suppliers are called at the top of each
   * chat() so OAuth-backed providers can refresh expiring tokens without
   * rebuilding the Provider instance (which the registry caches).
   */
  apiKey?: string | (() => string | Promise<string>)
  /** Which pi `Api` to use when the model isn't in pi's catalog. */
  fallbackApi: string
}

function defaultBaseUrlFor(providerName: string): string {
  switch (providerName) {
    case 'lmstudio':
      return process.env.LMSTUDIO_URL ?? 'http://127.0.0.1:1234/v1'
    case 'ollama':
      return process.env.OLLAMA_URL ?? 'http://127.0.0.1:11434/v1'
    default:
      return ''
  }
}

function buildModelLiteral(cfg: PiProviderConfig, modelId: string): Model<string> {
  return {
    id: modelId,
    name: modelId,
    api: cfg.fallbackApi,
    provider: cfg.providerName,
    baseUrl: cfg.baseUrl ?? defaultBaseUrlFor(cfg.providerName),
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 32_768,
    maxTokens: 4_096,
  }
}

export function resolveModel(cfg: PiProviderConfig, modelId: string): Model<string> {
  const lookupName = cfg.piProviderName ?? cfg.providerName
  // Try pi's typed catalog first — gets us cost, context window, reasoning flags
  // for free on the known providers' known models.
  try {
    // getModel's type signature is catalog-constrained, but at runtime it just
    // indexes MODELS[provider][id]. Cast through unknown so unknown ids fall
    // through to the literal builder instead of tripping the compiler.
    const known = (getModel as unknown as (p: string, m: string) => Model<string> | undefined)(
      lookupName,
      modelId,
    )
    if (known && typeof known === 'object' && 'api' in known) {
      // Override baseUrl + provider for local / compat endpoints — pi's catalog
      // doesn't know about lmstudio/ollama but if a user types
      // `openai:gpt-4o` with a custom OPENAI_BASE_URL, honor that here.
      if (cfg.baseUrl) return { ...known, baseUrl: cfg.baseUrl }
      return known
    }
  } catch {
    // Fall through.
  }
  return buildModelLiteral(cfg, modelId)
}

function convertMessages(messages: ProviderMessage[]): PiMessage[] {
  const out: PiMessage[] = []
  const now = Date.now()
  for (const m of messages) {
    if (m.role === 'system') continue // pi takes system prompt separately
    if (m.role === 'user') {
      out.push({ role: 'user', content: m.content, timestamp: now })
      continue
    }
    if (m.role === 'assistant') {
      const content: AssistantMessage['content'] = []
      if (m.content) content.push({ type: 'text', text: m.content } satisfies TextContent)
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          let parsed: Record<string, unknown> = {}
          try {
            parsed = JSON.parse(tc.arguments) as Record<string, unknown>
          } catch {
            // leave empty
          }
          content.push({
            type: 'toolCall',
            id: tc.id,
            name: tc.name,
            arguments: parsed,
          } satisfies PiToolCall)
        }
      }
      // Synthesize the AssistantMessage fields pi expects on replays — these
      // are only load-bearing for the LLM that gets the transcript; since we
      // don't persist usage/stopReason in Bazilion's message store, defaults
      // are fine.
      out.push({
        role: 'assistant',
        content,
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'unknown',
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: now,
      })
      continue
    }
    if (m.role === 'tool') {
      out.push({
        role: 'toolResult',
        toolCallId: m.toolCallId ?? '',
        toolName: m.toolName ?? 'tool',
        content: [{ type: 'text', text: m.content }],
        isError: false,
        timestamp: now,
      })
    }
  }
  return out
}

function convertTools(tools: ToolDef[] | undefined): PiTool[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    // Type.Unsafe lets us pass raw JSON Schema through without re-authoring in
    // typebox. Providers validate against the schema, not typebox's TSchema.
    parameters: Type.Unsafe<unknown>(t.parameters as Record<string, unknown>),
  }))
}

function toBazilionStopReason(reason: string): StopReason {
  switch (reason) {
    case 'stop':
      return 'stop'
    case 'length':
      return 'length'
    case 'toolUse':
      return 'tool_use'
    default:
      return 'error'
  }
}

function extractFinalResponse(msg: AssistantMessage): ProviderResponse {
  let text = ''
  const toolCalls: ToolCall[] = []
  for (const block of msg.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'toolCall') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: JSON.stringify(block.arguments ?? {}),
      })
    }
  }
  const res: ProviderResponse = {
    content: text,
    toolCalls,
    stopReason: toBazilionStopReason(msg.stopReason),
  }
  if (msg.usage) {
    res.usage = {
      promptTokens: msg.usage.input,
      completionTokens: msg.usage.output,
    }
  }
  return res
}

function mapReasoning(
  r: ReasoningLevel | undefined,
): 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | undefined {
  if (!r || r === 'off') return undefined
  return r
}

async function resolveApiKey(cfg: PiProviderConfig): Promise<string | undefined> {
  if (typeof cfg.apiKey === 'function') return await cfg.apiKey()
  return cfg.apiKey
}

export function piProvider(cfg: PiProviderConfig): Provider {
  return {
    name: cfg.providerName,
    async chat(req: ProviderRequest): Promise<ProviderResponse> {
      const model = resolveModel(cfg, req.model)
      const apiKey = await resolveApiKey(cfg)

      const stream = streamSimple(
        model,
        {
          systemPrompt: req.system ?? '',
          messages: convertMessages(req.messages),
          tools: convertTools(req.tools),
        },
        {
          signal: req.signal,
          apiKey,
          reasoning: mapReasoning(req.reasoning),
          maxTokens: req.maxTokens,
          temperature: req.temperature,
        },
      )

      let finalMessage: AssistantMessage | null = null
      for await (const event of stream) {
        if (event.type === 'text_delta' && req.onDelta) {
          req.onDelta(event.delta)
        } else if (event.type === 'done') {
          finalMessage = event.message
        } else if (event.type === 'error') {
          finalMessage = event.error
        }
      }
      if (!finalMessage) {
        throw new Error(`pi provider ${cfg.providerName} returned no terminal event`)
      }
      if (finalMessage.stopReason === 'aborted' || finalMessage.stopReason === 'error') {
        const msg = finalMessage.errorMessage ?? 'provider error'
        throw new Error(msg)
      }
      return extractFinalResponse(finalMessage)
    },
  }
}
