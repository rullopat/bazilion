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
}

/**
 * What a tool handler returns: a string (one text block), content parts (text and images), or
 * content with details.
 */
export type ToolOutput =
  | string
  | ToolResultPart[]
  | { content: ToolResultPart[]; details: ToolResultDetails }

export interface ToolHandler {
  def: ToolDef
  invoke(
    args: Record<string, unknown>,
    context?: { toolCallId: string; signal?: AbortSignal },
  ): Promise<ToolOutput>
}
