import { describe, expect, it } from 'vitest'
import { requiredScope, scopeAllows } from '../../src/lib/scopes.ts'

// BAZ-055: the scope→route table is the fixture. These tests walk it
// exhaustively at the unit level; apps/cli/test/authz-scopes.test.ts asserts
// the same decisions over real HTTP. If a new route family appears without a
// scope decision, it falls into the read/write default — the HTTP tests pin
// the carve-outs so silent defaults cannot drift into privilege.

describe('requiredScope — admin carve-outs', () => {
  const adminPaths = [
    '/api/config',
    '/api/config/providers',
    '/api/config/telegram',
    '/api/mcp-servers',
    '/api/mcp-servers/mcp_1',
    '/api/backup',
    '/api/backup/restore',
    '/api/tokens',
    '/api/tokens/tok_1',
    '/api/auth/openai/start',
    '/api/providers/test',
    '/api/communication',
  ]
  for (const path of adminPaths) {
    it(`admin: ${path}`, () => {
      expect(requiredScope('GET', path)).toBe('admin')
      expect(requiredScope('POST', path)).toBe('admin')
      expect(requiredScope('DELETE', path)).toBe('admin')
    })
  }
})

describe('requiredScope — approvals carve-outs', () => {
  const approvalPaths = [
    ['POST', '/api/approvals/ap_1/resolve'],
    ['POST', '/api/approvals'],
    ['POST', '/api/shell-approvals/sh_1'],
    ['POST', '/api/notifications'],
    ['POST', '/api/agents/ag_1/queue/q_1/reconcile'],
    ['POST', '/api/agents/ag_1/queue/control'],
    ['POST', '/api/agents/ag_1/queue/stop'],
    ['PATCH', '/api/agents/ag_1/queue/q_1'],
    ['DELETE', '/api/agents/ag_1/queue/q_1'],
    ['POST', '/api/agents/ag_1/questions/q_2/answer'],
    ['POST', '/api/attention/k_1/acknowledge'],
    ['POST', '/api/attention/acknowledge-all'],
    ['DELETE', '/api/attention/k_1/acknowledgement'],
  ] as const
  for (const [method, path] of approvalPaths) {
    it(`approvals: ${method} ${path}`, () => {
      expect(requiredScope(method, path)).toBe('approvals')
    })
  }
  // Attention acknowledgement via the generic /acknowledge pattern.
  it('approvals: POST /api/agents/ag_1/attention/k/acknowledge', () => {
    expect(requiredScope('POST', '/api/agents/ag_1/attention/k/acknowledge')).toBe('approvals')
  })
})

describe('requiredScope — defaults', () => {
  const readPaths = [
    '/api/agents',
    '/api/agents/ag_1',
    '/api/agents/ag_1/queue',
    '/api/agents/ag_1/queue/q_1/input',
    '/api/agents/ag_1/questions',
    '/api/attention',
    '/api/attention/summary',
    '/api/notifications',
    '/api/notifications/receipts',
    '/api/teams',
    '/api/team-templates',
    '/api/profiles',
    '/api/skills',
    '/api/triggers',
    '/api/results',
    '/api/messages',
  ]
  for (const path of readPaths) {
    it(`read: GET ${path}`, () => {
      expect(requiredScope('GET', path)).toBe('read')
    })
  }

  const writePaths = [
    ['POST', '/api/agents/ag_1/chat'],
    ['POST', '/api/teams'],
    ['POST', '/api/agents/ag_1/review/packets/rev_1/conclude'],
    ['POST', '/api/agents/ag_1/publish'],
    ['PATCH', '/api/skills/sk_1'],
    ['POST', '/api/triggers'],
    ['DELETE', '/api/results/r_1'],
  ] as const
  for (const [method, path] of writePaths) {
    it(`write: ${method} ${path}`, () => {
      expect(requiredScope(method, path)).toBe('write')
    })
  }
})

describe('scopeAllows', () => {
  it('a scope set allows exactly its scope and denies with the required scope named', () => {
    const check = scopeAllows(['read'], 'POST', '/api/teams')
    expect(check).toEqual({ allowed: false, required: 'write' })
    expect(scopeAllows(['read'], 'GET', '/api/teams')).toEqual({
      allowed: true,
      required: 'read',
    })
    expect(scopeAllows(['approvals'], 'POST', '/api/approvals/a/resolve')).toEqual({
      allowed: true,
      required: 'approvals',
    })
    expect(scopeAllows(['admin'], 'GET', '/api/config')).toEqual({
      allowed: true,
      required: 'admin',
    })
    // Admin alone does not read teams — scopes are explicit, not hierarchical.
    expect(scopeAllows(['admin'], 'GET', '/api/teams')).toEqual({
      allowed: false,
      required: 'read',
    })
  })
})
