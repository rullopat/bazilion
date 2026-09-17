// BAZ-055: per-device authorization scopes.
//
// The scope→route mapping lives in REQUIRED_SCOPE rules below and is the test
// fixture: apps/cli/test/authz-scopes.test.ts asserts HTTP behavior against
// this table, and the unit tests in apps/daemon/test/lib/authz.test.ts assert
// the pure function exhaustively over it. Adding a route family without a
// scope decision should surface as a failing test, not as an implicit default.
//
// Model (from the OpenClaw/Hermes auth comparison, adapted to single-operator
// Bazilion):
// - The bootstrap token holds all scopes implicitly — never checked here.
// - Device tokens hold an explicit scope set (`web_tokens.scopes`).
// - Defaults after the explicit carve-outs: GET/HEAD/OPTIONS → `read`,
//   everything else → `write`. The carve-outs exist because some surfaces must
//   NOT follow the read/write default:
//     * config/tokens/backups/providers/MCP are `admin` even for GET — they
//       never appear on companion devices;
//     * approvals/shell-approvals/notifications mutations, queue resolution,
//       question answers, and attention acknowledgements are `approvals` —
//       resolving an agent-initiated gate is not an ordinary write.

import type { DeviceTokenScope } from '@bazilion/api-types'

/** Route prefixes that require `admin` for every method, GET included. */
const ADMIN_PREFIXES = [
  '/api/config',
  '/api/mcp-servers',
  '/api/backup',
  '/api/tokens',
  '/api/auth/openai',
  '/api/providers/test',
  '/api/communication',
]

/** Route prefixes whose *mutations* resolve agent-initiated gates → `approvals`. */
const APPROVALS_MUTATION_PREFIXES = ['/api/approvals', '/api/shell-approvals', '/api/notifications']

/**
 * Mutation sub-paths under `/api/agents` and `/api/attention` that resolve
 * agent-initiated gates → `approvals` (everything else mutating under those
 * prefixes is an ordinary operator `write`).
 */
const APPROVALS_MUTATION_PATTERNS: RegExp[] = [
  /\/queue(\/|$)/, // follow-up queue resolve/control/stop/reconcile
  /\/questions\/[^/]+\/answer$/, // structured question answers (BAZ-037)
  /\/acknowledge/, // attention acknowledge / acknowledge-all (BAZ-026)
]

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

/**
 * Which scope does this request require? Pure function — the single source of
 * truth for both the auth middleware and the generated tests.
 */
export function requiredScope(method: string, path: string): DeviceTokenScope {
  const isRead = READ_METHODS.has(method.toUpperCase())
  if (ADMIN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    return 'admin'
  }
  if (!isRead) {
    if (APPROVALS_MUTATION_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
      return 'approvals'
    }
    if (path.startsWith('/api/agents') || path.startsWith('/api/attention')) {
      if (APPROVALS_MUTATION_PATTERNS.some((re) => re.test(path))) return 'approvals'
    }
  }
  return isRead ? 'read' : 'write'
}

export interface ScopeCheck {
  allowed: boolean
  required: DeviceTokenScope
}

/** Does this scope set (from a device token) allow the request? */
export function scopeAllows(
  scopes: readonly DeviceTokenScope[],
  method: string,
  path: string,
): ScopeCheck {
  const required = requiredScope(method, path)
  return { allowed: scopes.includes(required), required }
}
