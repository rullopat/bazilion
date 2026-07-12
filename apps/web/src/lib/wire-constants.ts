// Plain wire constants safe to import from any bundle (client or server).
//
// These mirror values defined in the daemon's core layer
// (`apps/daemon/src/core`) and re-exported through `@bazilion/api-types`. We
// re-declare them here rather than reaching into daemon source so the web
// app stays decoupled from Node-only deps (the architecture mandate is
// "apps/web never reaches into daemon source" — see AGENTS.md). Daemon-side
// validation re-checks every wire string against the source of truth, so
// a drift here surfaces as a 4xx, never as silent corruption.

import type { ReasoningLevel } from '@bazilion/api-types'

/** Stable id for the auto-seeded `default` profile. */
export const DEFAULT_PROFILE_ID = 'default'

/** Stable id for the auto-seeded `default` team. */
export const DEFAULT_TEAM_ID = 'default'

/** Mirrors the daemon's REASONING_LEVELS (apps/daemon/src/core). */
export const REASONING_LEVELS: ReasoningLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
]
