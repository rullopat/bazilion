import type { ToolDef } from '@bazilion/api-types'

export interface ToolHandler {
  def: ToolDef
  invoke(args: Record<string, unknown>): Promise<string>
}

export interface ToolRegistry {
  list(): ToolDef[]
  has(name: string): boolean
  /** invoke a tool with JSON-serialized arguments; returns text result */
  invoke(name: string, jsonArgs: string): Promise<string>
}
