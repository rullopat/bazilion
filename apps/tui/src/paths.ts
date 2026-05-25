import { homedir } from 'node:os'
import { join } from 'node:path'

export interface TuiPaths {
  home: string
  authFile: string
}

export function resolveTuiPaths(home?: string): TuiPaths {
  const root = home ?? process.env.BAZILION_HOME ?? join(homedir(), '.bazilion')
  return { home: root, authFile: join(root, 'auth.json') }
}
