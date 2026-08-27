// Adapter: Bazilion ToolHandler → pi-coding-agent ToolDefinition.
//
// Pi expects tools to return `AgentToolResult<TDetails>` =
// `{ content: (TextContent | ImageContent)[]; details: TDetails; terminate?: boolean }`.
// Our handlers return plain strings. The adapter wraps the string into a single
// text content block with empty details — the same fidelity we had before.
//
// Pi's tool execute contract: throw on failure. The agent loop wraps thrown
// errors as tool-result messages with `isError: true`. We preserve this shape
// directly because our handlers already throw on bad args / runtime failures.
//
// What's in this module:
//   - `ourToolToPiTool` — single-handler wrapper.
//   - `createBazilionCustomTools` — composed suite of the Bazilion-specific
//     tools (memory_*, messaging, bootstrap_done, web_search/fetch). File I/O
//     tools are *not* here — pi's createCodingTools(cwd, …) replaces them.

import type { ResolvedAgent } from '@bazilion/api-types'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { MemoryBackend } from '../memory/types.ts'
import { bootstrapTool } from '../tools/bootstrap.ts'
import { browserTools } from '../tools/browser.ts'
import { deliverFileTool, type FileSink } from '../tools/deliver-file.ts'
import { homeTools } from '../tools/home.ts'
import { mcpProxyTools } from '../tools/mcp.ts'
import { memoryTools } from '../tools/memory.ts'
import { messagingTools } from '../tools/messaging.ts'
import type { ToolHandler, ToolOutput } from '../tools/types.ts'
import { userMdTools } from '../tools/user-md.ts'
import { protectedWebFetchTool, webTools } from '../tools/web.ts'
import type {
  BrowserHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdHost,
} from '../worker/ipc-protocol.ts'

/**
 * Wrap a Bazilion `ToolHandler` as a pi `ToolDefinition` so it can be passed
 * through `customTools` to `createAgentSession`.
 *
 * Design note: we keep the same tool name + description + parameter JSON schema
 * that the handler already declares. Pi wants a `TypeBox` schema; we pass the
 * JSONSchema through `Type.Unsafe` so the LLM validation happens on pi's side
 * without us having to re-author schemas in typebox syntax.
 */
export function ourToolToPiTool(h: ToolHandler): ToolDefinition {
  return {
    name: h.def.name,
    label: h.def.name,
    description: h.def.description,
    parameters: Type.Unsafe<Record<string, unknown>>(h.def.parameters as Record<string, unknown>),
    async execute(_toolCallId, params) {
      const out = await h.invoke(params as Record<string, unknown>)
      return {
        content: toPiContent(out),
        details: {},
      }
    },
  }
}

/**
 * Map a Bazilion `ToolOutput` to pi's `(TextContent | ImageContent)[]`. A bare
 * string becomes a single text block (the legacy shape); a part array maps
 * 1:1 — pi's content blocks have the same field names.
 */
function toPiContent(
  out: ToolOutput,
): Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }> {
  if (typeof out === 'string') return [{ type: 'text', text: out }]
  return out.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', data: p.data, mimeType: p.mimeType },
  )
}

export interface BazilionCustomToolsOpts {
  agent: ResolvedAgent
  memory: MemoryBackend
  /** If provided, enables inter-agent messaging tools. */
  messagingHost?: MessagingHost
  /** If provided, enables the `user_md_append` tool. */
  userMdHost?: UserMdHost
  /** If provided, enables the `browser_*` tools (proxied to the daemon pool). */
  browserHost?: BrowserHost
  /** If provided alongside `mcpTools`, enables the discovered MCP proxy tools. */
  mcpHost?: McpHost
  /** MCP tools discovered daemon-side, exposed as proxy tools. */
  mcpTools?: InjectedMcpTool[]
  /** If provided, enables the `deliver_file` tool (emits a `file` event). */
  fileSink?: FileSink
  /** Merged env (process.env + secrets). */
  env?: NodeJS.ProcessEnv
}

export interface ProtectedBazilionCustomToolsOpts {
  agent: ResolvedAgent
  memory: MemoryBackend
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  fileSink: FileSink
}

/**
 * Build the list of Bazilion-specific custom tools in the shape pi expects.
 *
 * Excludes file-I/O tools (`read`/`bash`/`edit`/`write`/`grep`/`find`/`ls`) —
 * those come from pi's `createCodingTools(cwd, …)` now that we've adopted the
 * richer toolset. Also excludes the legacy `workspace_list/read/write`
 * triumvirate: pi's tools work against a single cwd (the agent's default
 * workspace), and mounted non-default workspaces are reachable via absolute
 * paths through pi's `bash`/`read`/`edit`.
 */
export function createBazilionCustomTools(opts: BazilionCustomToolsOpts): ToolDefinition[] {
  const handlers: ToolHandler[] = [
    ...memoryTools(opts.memory),
    ...homeTools(opts.agent.agent.dir),
    bootstrapTool(opts.agent.agent.dir),
    ...webTools({ env: opts.env }),
  ]
  if (opts.messagingHost) {
    handlers.push(...messagingTools(opts.messagingHost, opts.agent.agent.id))
  }
  if (opts.userMdHost) {
    handlers.push(...userMdTools(opts.userMdHost, opts.agent.team.id))
  }
  if (opts.browserHost) {
    handlers.push(...browserTools(opts.browserHost, opts.agent.agent.id))
  }
  if (opts.mcpHost && opts.mcpTools && opts.mcpTools.length > 0) {
    handlers.push(...mcpProxyTools(opts.mcpHost, opts.mcpTools))
  }
  if (opts.fileSink) {
    handlers.push(deliverFileTool(opts.agent.team.path, opts.fileSink))
  }
  return handlers.map(ourToolToPiTool)
}

/**
 * Closed normal-turn capability set. No environment is accepted, so search,
 * Firecrawl, browser, MCP, and provider/tool credentials cannot be restored by
 * configuration inside a protected worker.
 */
export function createProtectedBazilionCustomTools(
  opts: ProtectedBazilionCustomToolsOpts,
): ToolDefinition[] {
  const handlers: ToolHandler[] = [
    ...memoryTools(opts.memory),
    ...homeTools(opts.agent.agent.dir),
    bootstrapTool(opts.agent.agent.dir),
    protectedWebFetchTool(),
    ...messagingTools(opts.messagingHost, opts.agent.agent.id),
    ...userMdTools(opts.userMdHost, opts.agent.team.id),
    deliverFileTool(opts.agent.team.path, opts.fileSink),
  ]
  return handlers.map(ourToolToPiTool)
}
