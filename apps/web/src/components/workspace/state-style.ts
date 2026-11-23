// How an Agent's state looks wherever it is shown: the colour of its line and of its dot.

import type { AgentState } from '../../lib/activity'

export const STATE_TEXT: Record<AgentState['kind'], string> = {
  needs: 'text-warning',
  working: 'text-success',
  paused: 'text-warning',
  fresh: 'text-accent-foreground',
  idle: 'text-muted-foreground',
}
export const STATE_DOT: Record<AgentState['kind'], string> = {
  needs: 'bg-warning',
  working: 'bg-success animate-pulse',
  paused: 'bg-fawn',
  fresh: 'bg-primary',
  idle: 'bg-fawn',
}
