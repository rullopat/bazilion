// Bazilion's own tools as Pi tool definitions. Pi's file and shell tools (read, bash, edit, …)
// come from Pi itself; see runtime/shell/tooling.ts. A handler throws on failure, which Pi turns
// into an error tool result.

import { join } from 'node:path'
import type { ResolvedAgent } from '@bazilion/api-types'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import type { MemoryBackend } from '../memory/types.ts'
import { SANDBOX_INPUTS_DIR } from '../shell/tooling.ts'
import { type AskUser, askUserTool } from '../tools/ask-user.ts'
import { bootstrapTool } from '../tools/bootstrap.ts'
import { browserTools } from '../tools/browser.ts'
import { deliverFileTool, type FileSink, type ShowResult } from '../tools/deliver-file.ts'
import { pdfReadTool, viewImageTool } from '../tools/documents.ts'
import { homeTools } from '../tools/home.ts'
import { imageGenerateTool } from '../tools/image-generate.ts'
import { jobTools } from '../tools/jobs.ts'
import { mcpProxyTools } from '../tools/mcp.ts'
import { memoryTools } from '../tools/memory.ts'
import { messagingTools } from '../tools/messaging.ts'
import { type RecallSource, recallTool } from '../tools/recall.ts'
import { scheduleTools } from '../tools/schedule.ts'
import { secretTools } from '../tools/secrets.ts'
import { agentCreateTool } from '../tools/team.ts'
import type { ToolHandler, ToolResultPart } from '../tools/types.ts'
import { userMdTools } from '../tools/user-md.ts'
import { type WebFetchSecret, webFetchTool, webSearchTool } from '../tools/web.ts'
import type {
  BrowserHost,
  ImageGenerationHost,
  InjectedMcpTool,
  JobHost,
  McpHost,
  MessagingHost,
  ResultContent,
  ScheduleHost,
  SecretHost,
  TeamHost,
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
  /** The conversation the turn continues, for `recall`. */
  recall: RecallSource
  // Each optional host enables its tools.
  messagingHost?: MessagingHost
  userMdHost?: UserMdHost
  browserHost?: BrowserHost
  /** MCP tools discovered daemon-side, proxied through `mcpHost`. */
  mcpHost?: McpHost
  mcpTools?: InjectedMcpTool[]
  fileSink?: FileSink
  showResult?: ShowResult
  imageGenerationHost?: ImageGenerationHost
  /** Daemon-run search; absent means no web_search tool. */
  webSearchHost?: WebSearchHost
  askUser?: AskUser
  /** Adding teammates (`agent_create`), in a turn the operator started. */
  teamHost?: TeamHost
  /** The job_* tools for background jobs. */
  jobHost?: JobHost
  /** The schedule_* tools. */
  scheduleHost?: ScheduleHost
  /** secret_list, and secret_request when it can ask. */
  secretHost?: SecretHost
  /** The Agent's secrets with their values, for web_fetch headers. */
  secrets?: readonly WebFetchSecret[]
  /** Files the Agent names, read as its file tools would: view_image and pdf_read. */
  readFile?: (path: string) => Buffer
  /** One of its saved results, for view_image. */
  readResult?: (resultId: string) => Promise<ResultContent>
  /** Merged env (process.env + secrets). */
  env?: NodeJS.ProcessEnv
  /** Commands run in Docker: paths the Agent is told are the container's. */
  docker?: boolean
}

/**
 * Bazilion's tools for one session: memory, recall, home, web, plus those whose host is present.
 */
export function createBazilionCustomTools(opts: BazilionCustomToolsOpts): ToolDefinition[] {
  const handlers: ToolHandler[] = [
    ...memoryTools(opts.memory),
    recallTool(opts.recall),
    ...homeTools(opts.agent.agent.dir),
    bootstrapTool(opts.agent.agent.dir),
    webFetchTool({
      env: opts.env,
      // A long page is kept whole with the Agent's uploads, which Docker commands see at /inputs.
      savePages: {
        dir: join(opts.agent.agent.dir, 'uploads'),
        shown: opts.docker ? SANDBOX_INPUTS_DIR : join(opts.agent.agent.dir, 'uploads'),
      },
      ...(opts.secrets?.length ? { secrets: opts.secrets } : {}),
    }),
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
  if (opts.fileSink)
    handlers.push(deliverFileTool(opts.agent.team.path, opts.fileSink, opts.showResult))
  if (opts.imageGenerationHost) handlers.push(imageGenerateTool(opts.imageGenerationHost))
  if (opts.askUser) handlers.push(askUserTool(opts.askUser))
  if (opts.teamHost) handlers.push(agentCreateTool(opts.teamHost))
  if (opts.jobHost) handlers.push(...jobTools(opts.jobHost))
  if (opts.scheduleHost) handlers.push(...scheduleTools(opts.scheduleHost))
  if (opts.secretHost) handlers.push(...secretTools(opts.secretHost))
  if (opts.readFile) {
    const sources = {
      readFile: opts.readFile,
      ...(opts.readResult ? { readResult: opts.readResult } : {}),
    }
    handlers.push(viewImageTool(sources), pdfReadTool(sources))
  }
  return handlers.map(ourToolToPiTool)
}
