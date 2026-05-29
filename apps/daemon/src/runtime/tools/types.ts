import type { ToolDef } from '@bazilion/api-types'

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
 * What a tool handler returns. A bare string is shorthand for a single text
 * block — every legacy tool (memory_*, messaging, web_*, …) uses it. Tools
 * that emit images return an explicit part array.
 */
export type ToolOutput = string | ToolResultPart[]

export interface ToolHandler {
  def: ToolDef
  invoke(args: Record<string, unknown>): Promise<ToolOutput>
}

export interface ToolRegistry {
  list(): ToolDef[]
  has(name: string): boolean
  /** invoke a tool with JSON-serialized arguments; returns text or multimodal output */
  invoke(name: string, jsonArgs: string): Promise<ToolOutput>
}
