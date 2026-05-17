import { homedir } from 'node:os'
import { join } from 'node:path'

export interface CliPaths {
  home: string
  authFile: string
}

export function resolveCliPaths(home?: string): CliPaths {
  const root = home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion')
  return { home: root, authFile: join(root, 'auth.json') }
}
