// Daemon-side `BrowserHost` — services the worker's `browser_*` IPC calls by
// driving the managed browser pool in `pool.ts`. One per turn; the pool it
// talks to is the process-lifetime registry, so sessions persist across turns.
//
// T09 identity binding: the admission inputs (canonical Agent id, admitted
// Team id, daemon paths, the turn's cancellation signal) are captured HERE,
// in the daemon, from the turn's own binding — never from worker arguments.
// Every `browserInvoke` is validated against that binding BEFORE any pool
// access: a forged agent id, an unknown action, malformed/oversized args or a
// cancelled turn are refused outright, and the pool is always keyed on the
// daemon-resolved id rather than the worker's claim.

import type { BrowserHost } from '../../runtime/index.ts'
import type { ToolResultPart } from '../../runtime/tools/types.ts'
import { boundText, RESPONSE_BOUND_BYTES } from './observation.ts'
import {
  BROWSER_ACTIONS,
  type BrowserAdmission,
  type BrowserConfig,
  browserStatusFor,
  invokeBrowserAction,
} from './pool.ts'

/** Bound on one `browserInvoke` args payload (bounded IPC, T08/T09). */
const ARGS_BOUND_BYTES = 64 * 1024

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Read-only `browser_status` result, serialized for the model. */
function statusText(agentId: string, config: BrowserConfig, admission: BrowserAdmission) {
  const status = browserStatusFor(agentId, config, admission)
  const text = JSON.stringify(status, null, 2)
  return [{ type: 'text', text: boundText(text) }] as ToolResultPart[]
}

export function createBrowserHost(
  config: BrowserConfig,
  admission: BrowserAdmission,
  /** Test seam: the pool dispatch (defaults to the real one). */
  dispatch: (
    agentId: string,
    action: string,
    args: Record<string, unknown>,
  ) => Promise<ToolResultPart[]> = (agentId, action, args) =>
    invokeBrowserAction(agentId, action, args, config, admission),
): BrowserHost {
  const canonicalAgentId = admission.agentId
  return {
    invoke: async (agentId, action, args) => {
      // Identity binding: the worker's claimed agent id must match the
      // canonical Agent of the admitted turn.
      if (agentId !== canonicalAgentId) {
        throw new Error('browser: this call is not admitted for the requesting agent')
      }
      // A cancelled turn may not start or drive browser work.
      if (admission.signal?.aborted) {
        throw new Error('browser: the turn was cancelled; browser actions are refused')
      }
      // Read-only status short-circuits before the pool — it must never launch.
      if (action === 'status') return statusText(canonicalAgentId, config, admission)
      if (!BROWSER_ACTIONS.has(action)) {
        throw new Error(boundText(`browser: unknown action "${action}"`))
      }
      if (
        !isPlainRecord(args) ||
        Buffer.byteLength(JSON.stringify(args) ?? '', 'utf8') > ARGS_BOUND_BYTES
      ) {
        throw new Error('browser: invalid action arguments')
      }
      // The pool is keyed on the canonical id, never the worker's claim.
      // Bound errors as well as text results: a Playwright/SSRF error may
      // contain worker-controlled URLs and bypass the pool's text() formatter.
      try {
        return await dispatch(canonicalAgentId, action, args)
      } catch (error) {
        // Never stringify arbitrary thrown data: it may be unbounded or have
        // attacker-defined conversion hooks. No effects can be inferred here.
        if (!(error instanceof Error)) {
          throw new Error(
            'browser: action failed with a non-Error rejection; effects may be uncertain',
          )
        }
        if (Buffer.byteLength(error.message, 'utf8') > RESPONSE_BOUND_BYTES) {
          const bounded = new Error(boundText(error.message))
          bounded.name = error.name
          if ('reasonCode' in error) Object.assign(bounded, { reasonCode: error.reasonCode })
          throw bounded
        }
        throw error
      }
    },
  }
}
