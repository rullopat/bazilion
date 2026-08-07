// Adapter from Bazilion's Provider interface → pi-ai's streamSimple.
//
// Pi-ai (`@earendil-works/pi-ai`) is Mario Zechner's unified LLM SDK — 15+
// providers behind one event-stream API. This adapter is the boundary where
// Pi messages become Bazilion's provider contract; everything downstream
// (`runTurnStream`, `persistRun`, the worker entry, CLI, web) sees the same
// `Provider.chat(ProviderRequest): Promise<ProviderResponse>` contract it
// always has. That keeps the wire format, DB schema, and chat UI stable while
// giving us cost/usage, thinking levels, prompt caching, and every provider
// pi supports — for free.
//
// Model/auth/stream resolution is delegated to Bazilion's Pi runtime factory,
// which uses Pi's public ModelRuntime API and preserves arbitrary model ids.

import type { ProviderMessage, ReasoningLevel, ToolCall, ToolDef } from '@bazilion/api-types'
import {
  type AssistantMessage,
  type Message as PiMessage,
  type Tool as PiTool,
  type ToolCall as PiToolCall,
  type TextContent,
  Type,
} from '@earendil-works/pi-ai'
import type { ModelRuntime } from '@earendil-works/pi-coding-agent'
import { createBazilionPiRuntime, resolvePiModel } from './pi-runtime.ts'
import type { Provider, ProviderRequest, ProviderResponse, StopReason } from './types.ts'

export interface PiProviderConfig {
  /** Display name on the returned Provider; also the registry key (e.g. 'bedrock', 'azure-openai'). */
  providerName: string
  /** Override baseUrl for openai-compat endpoints (lmstudio, ollama, custom). */
  baseUrl?: string
  /** Merged daemon environment used for provider-specific ambient configuration. */
  env?: NodeJS.ProcessEnv
  /**
   * Static key or an async supplier. Suppliers are called at the top of each
   * chat() so OAuth-backed providers can refresh expiring tokens without
   * rebuilding the Provider instance (which the registry caches).
   */
  apiKey?: string | (() => string | Promise<string>)
  /** Test seam for a public-API ModelRuntime with a native faux provider. */
  runtimeFactory?: () => Promise<ModelRuntime>
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
      const apiKey = await resolveApiKey(cfg)
      const runtime = cfg.runtimeFactory
        ? await cfg.runtimeFactory()
        : await createBazilionPiRuntime({
            providerName: cfg.providerName,
            env: cfg.env ?? {},
            ...(apiKey ? { apiKey } : {}),
            ...(cfg.baseUrl ? { baseUrl: cfg.baseUrl } : {}),
            modelId: req.model,
          })
      const model = resolvePiModel(runtime, cfg.providerName, req.model, cfg.baseUrl)

      const stream = runtime.streamSimple(
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
