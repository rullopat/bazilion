// Bazilion's own tools as Pi tool definitions. Pi's file and shell tools (read, bash, edit, …)
// come from Pi itself; see runtime/shell/tooling.ts. A handler throws on failure, which Pi turns
// into an error tool result.

import type { ResolvedAgent } from '@bazilion/api-types'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { MemoryBackend } from '../memory/types.ts'
import { type AskUser, askUserTool } from '../tools/ask-user.ts'
import { bootstrapTool } from '../tools/bootstrap.ts'
import { browserTools } from '../tools/browser.ts'
import { deliverFileTool, type FileSink } from '../tools/deliver-file.ts'
import { homeTools } from '../tools/home.ts'
import { imageGenerateTool } from '../tools/image-generate.ts'
import { mcpProxyTools } from '../tools/mcp.ts'
import { memoryTools } from '../tools/memory.ts'
import { messagingTools } from '../tools/messaging.ts'
import type { ToolHandler, ToolResultPart } from '../tools/types.ts'
import { userMdTools } from '../tools/user-md.ts'
import { webFetchTool, webSearchTool } from '../tools/web.ts'
import type {
  BrowserHost,
  ImageGenerationHost,
  InjectedMcpTool,
  McpHost,
  MessagingHost,
  UserMdHost,
  WebSearchHost,
} from '../worker/ipc-protocol.ts'

/**
 * Wrap a `ToolHandler` as a Pi tool. Its JSON schema passes through `Type.Unsafe`, so Pi
 * validates arguments without the schema being rewritten in TypeBox.
 */
export function ourToolToPiTool(h: ToolHandler): ToolDefinition {
  return {
    name: h.def.name,
    label: h.def.name,
    description: h.def.description,
    parameters: Type.Unsafe<Record<string, unknown>>(h.def.parameters as Record<string, unknown>),
    async execute(toolCallId, params, signal) {
      const out = await h.invoke(params as Record<string, unknown>, { toolCallId, signal })
      if (typeof out === 'string') return { content: [{ type: 'text', text: out }], details: {} }
      if (Array.isArray(out)) return { content: out.map(toPiPart), details: {} }
      return { content: out.content.map(toPiPart), details: out.details }
    },
  }
}

function toPiPart(
  part: ToolResultPart,
): { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } {
  return part.type === 'text'
    ? { type: 'text', text: part.text }
    : { type: 'image', data: part.data, mimeType: part.mimeType }
}

export interface BazilionCustomToolsOpts {
  agent: ResolvedAgent
  memory: MemoryBackend
  // Each optional host enables its tools.
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  browserHost?: BrowserHost
  /** MCP tools discovered daemon-side, proxied through `mcpHost`. */
  mcpHost?: McpHost
  mcpTools?: InjectedMcpTool[]
  fileSink?: FileSink
  imageGenerationHost?: ImageGenerationHost
  /** Daemon-run search; absent means no web_search tool. */
  webSearchHost?: WebSearchHost
  askUser?: AskUser
  /** Merged env (process.env + secrets). */
  env?: NodeJS.ProcessEnv
}

/** Bazilion's tools for one session: memory, home, web, plus those whose host is present. */
export function createBazilionCustomTools(opts: BazilionCustomToolsOpts): ToolDefinition[] {
  const handlers: ToolHandler[] = [
    ...memoryTools(opts.memory),
    ...homeTools(opts.agent.agent.dir),
    bootstrapTool(opts.agent.agent.dir),
    webFetchTool({ env: opts.env }),
    ...(opts.webSearchHost ? [webSearchTool(opts.webSearchHost)] : []),
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
  if (opts.fileSink) handlers.push(deliverFileTool(opts.agent.team.path, opts.fileSink))
  if (opts.imageGenerationHost) handlers.push(imageGenerateTool(opts.imageGenerationHost))
  if (opts.askUser) handlers.push(askUserTool(opts.askUser))
  return handlers.map(ourToolToPiTool)
}
