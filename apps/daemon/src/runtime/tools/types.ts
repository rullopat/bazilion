import type { ResultReference, ToolDef } from '@bazilion/api-types'

/**
 * One block of tool output. Mirrors pi's `TextContent | ImageContent` so the
 * adapter in `pi/tools.ts` can map it straight through to the model. Image
 * data is base64 (no data: prefix) — it rides the IPC JSON channel fine when
 * a worker tool proxies a daemon-side resource (browser screenshots, MCP
 * image results).
 */
export type ToolResultPart =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }

/**
 * Structured data a tool result carries next to its content. Pi stores it with the result in the
 * transcript; the model never sees it.
 */
export interface ToolResultDetails {
  /** Files the tool saved as results. */
  results?: ResultReference[]
  /** `browser_use`: the browser the conversation switched to (BAZ-102). */
  browser?: 'own' | 'yours'
  /** `browser_use`: the operator allowed the move to their Chrome. */
  approved?: boolean
}

/**
 * What a tool handler returns: a string (one text block), content parts (text and images), or
 * content with details.
 */
export type ToolOutput =
  | string
  | ToolResultPart[]
  | { content: ToolResultPart[]; details: ToolResultDetails }

/**
 * How the model reaches a tool (Pi's tool exposure, BAZ-100). Declared to the model is the
 * default; `model-only` keeps it out of codemode scripts (it asks the operator), and `deferred`
 * leaves it undeclared until `tool_search` loads it, while scripts can always call it.
 */
export type ToolReach = 'model-only' | 'deferred'

/** A group of tools, such as one MCP connection: what scripts and searches know it by. */
export interface ToolGroup {
  name: string
  description?: string
}

export interface ToolHandler {
  def: ToolDef
  reach?: ToolReach
  group?: ToolGroup
  invoke(
    args: Record<string, unknown>,
    context?: {
      toolCallId: string
      signal?: AbortSignal
      /** Live output while the call runs; each replaces the one before. */
      progress?: (text: string) => void
    },
  ): Promise<ToolOutput>
}
