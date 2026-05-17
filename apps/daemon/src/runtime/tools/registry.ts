import type { ToolHandler, ToolRegistry } from './types.ts'

export function createToolRegistry(handlers: ToolHandler[]): ToolRegistry {
  const map = new Map<string, ToolHandler>()
  for (const h of handlers) map.set(h.def.name, h)

  return {
    list() {
      return [...map.values()].map((h) => h.def)
    },
    has(name) {
      return map.has(name)
    },
    async invoke(name, jsonArgs) {
      const handler = map.get(name)
      if (!handler) throw new Error(`unknown tool: ${name}`)
      let args: Record<string, unknown>
      try {
        args = jsonArgs ? JSON.parse(jsonArgs) : {}
      } catch (err) {
        throw new Error(`tool ${name}: invalid JSON arguments — ${(err as Error).message}`)
      }
      if (!args || typeof args !== 'object') {
        throw new Error(`tool ${name}: arguments must be a JSON object`)
      }
      return handler.invoke(args)
    },
  }
}
