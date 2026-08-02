import type { CommandApproval } from '@bazilion/api-types'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test, vi } from 'vitest'
import {
  CommandApprovalCard,
  interactiveChatRequest,
  shellApprovalsUrl,
  type RenderEntry,
  upsertCommandApprovalEntry,
} from '../src/components/ChatPane.tsx'

const pendingApproval: CommandApproval = {
  id: 'approval-1',
  turnId: 'turn-1',
  toolCallId: 'tool-1',
  agentId: 'agent-1',
  teamId: 'team-1',
  command: '<img src=x onerror=alert(1)> && rm -rf /',
  risks: [
    {
      code: 'broad-destructive-operation',
      severity: 'danger',
      message: 'Recursively changes or deletes a broad filesystem target.',
      matchedText: 'rm -rf /',
      span: { start: 35, end: 43 },
    },
  ],
  status: 'pending',
  expiresAt: Date.UTC(2026, 7, 2, 12, 0),
}

describe('inline shell command approval', () => {
  test('declares the browser chat turn as interactive', () => {
    expect(interactiveChatRequest('run it', [])).toEqual({
      message: 'run it',
      attachments: [],
      bashApprovalMode: 'interactive',
    })
    expect(shellApprovalsUrl('agent/one')).toBe(
      '/api/shell-approvals?agentId=agent%2Fone',
    )
  })

  test('upserts terminal state without moving or duplicating the pending card', () => {
    const initial: RenderEntry[] = [{ type: 'assistant', content: 'before' }]
    const withPending = upsertCommandApprovalEntry(initial, pendingApproval)
    const allowed = upsertCommandApprovalEntry(withPending, {
      ...pendingApproval,
      status: 'allowed',
    })

    expect(allowed).toHaveLength(2)
    expect(allowed[0]).toEqual(initial[0])
    expect(allowed[1]).toMatchObject({
      type: 'command_approval',
      approval: { id: 'approval-1', status: 'allowed' },
    })
  })

  test('renders command and risks as escaped text with explicit one-shot controls', () => {
    const html = renderToStaticMarkup(
      createElement(CommandApprovalCard, {
        approval: pendingApproval,
        onDecision: vi.fn(),
      }),
    )

    expect(html).toContain('Shell command approval')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(html).not.toContain('<img')
    expect(html).toContain('Recursively changes or deletes a broad filesystem target.')
    expect(html).toContain('broad-destructive-operation')
    expect(html).toContain('Deny blocks only this command; cancel stops the whole turn.')
    expect(html).toContain('>Deny</button>')
    expect(html).toContain('>Allow once</button>')
  })

  test('renders terminal outcome without actionable controls', () => {
    const html = renderToStaticMarkup(
      createElement(CommandApprovalCard, {
        approval: { ...pendingApproval, status: 'expired' },
        onDecision: vi.fn(),
      }),
    )

    expect(html).toContain('Expired — the command was not run.')
    expect(html).not.toContain('>Deny</button>')
    expect(html).not.toContain('>Allow once</button>')
  })
})
