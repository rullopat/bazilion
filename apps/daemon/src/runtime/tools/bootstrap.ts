import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { ToolHandler } from './types.ts'

export function bootstrapTool(agentDir: string): ToolHandler {
  return {
    def: {
      name: 'bootstrap_done',
      description:
        'Call this once you have finished your bootstrap conversation (introduced yourself, learned the user, updated IDENTITY.md). Removes BOOTSTRAP.md so it does not appear in future sessions.',
      parameters: { type: 'object', properties: {} },
    },
    async invoke() {
      const path = join(agentDir, 'BOOTSTRAP.md')
      if (existsSync(path)) {
        rmSync(path)
        return 'BOOTSTRAP.md removed. Bootstrap is complete.'
      }
      return 'BOOTSTRAP.md was already removed.'
    },
  }
}
