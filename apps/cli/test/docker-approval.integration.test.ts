import { existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { ChatFrame, CommandApproval } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { openDb, resolveAgent, resolvePaths } from '../../daemon/src/core/index.ts'
import {
  type CannedResponse,
  type MockLlm,
  sseFromCanned,
  startLmStudioMock,
} from './fixtures/mock-lmstudio.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, stopSettledTestServer, type TestServer } from './server-fixture.ts'

const docker = process.platform === 'linux' && process.env.BAZILION_TEST_DOCKER === '1'

describe.skipIf(!docker)('actual Docker command approval over daemon HTTP and worker IPC', () => {
  let mock: MockLlm | undefined
  let server: TestServer | undefined
  let agentId: string
  let proofPath: string
  let tools: string[]
  // A literal risk-classifier trigger, NOT an environment lookup or credential read. Even a
  // broken host fallback could only append inside this fixture's own Team working directory.
  const command =
    'printf "BAZILION_TOKEN" >/dev/null; printf "executed\\n" >> approval-proof.txt; printf "sandbox=%s\\n" "$PWD"'

  beforeEach(async () => {
    tools = []
    mock = await startLmStudioMock()
    server = await startTestServer({
      LMSTUDIO_URL: mock.url,
      LMSTUDIO_API_KEY: 'synthetic-lmstudio-fixture-key',
      BAZILION_BASH_SANDBOX: 'docker',
      BAZILION_BASH_SANDBOX_IMAGE: process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'debian:bookworm-slim',
      BAZILION_BASH_APPROVAL: 'dangerous',
      BAZILION_IMAGE_GENERATION: 'off',
      BAZILION_SCHEDULER: 'off',
    })
    const profile = await server.cli(['profile', 'create', 'p', '--model', 'lmstudio:test-model'])
    expect(profile.exitCode, profile.stderr).toBe(0)
    const spawned = await server.cli(['agent', 'spawn', '--profile', 'p'])
    expect(spawned.exitCode, spawned.stderr).toBe(0)
    agentId = extractAgentId(spawned.stdout)
    const paths = resolvePaths(server.home)
    const db = openDb(paths.db)
    try {
      proofPath = join(resolveAgent(db, paths, agentId).team.path, 'approval-proof.txt')
    } finally {
      db.close()
    }
  }, 30_000)

  afterEach(async () => {
    try {
      if (server) await stopSettledTestServer(server)
    } finally {
      server = undefined
      if (mock) await mock.stop()
      mock = undefined
    }
  }, 30_000)

  function headers(json = false): Record<string, string> {
    if (!server) throw new Error('missing fixture')
    return {
      authorization: `Bearer ${server.token}`,
      origin: server.url,
      ...(json ? { 'content-type': 'application/json' } : {}),
    }
  }

  async function journey(decision: 'allow' | 'deny' | 'cancel' | 'auto_deny') {
    if (!server || !mock) throw new Error('missing fixture')
    const request: CannedResponse = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_approval',
                type: 'function',
                function: { name: 'bash', arguments: JSON.stringify({ command, timeout: 15 }) },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    }
    mock.push([
      (req: IncomingMessage, res: ServerResponse) => {
        let body = ''
        req.on('data', (chunk: Buffer) => {
          body += chunk.toString()
        })
        req.on('end', () => {
          try {
            const parsed = JSON.parse(body) as { tools?: Array<{ function?: { name?: string } }> }
            tools = (parsed.tools ?? []).map((tool) => tool.function?.name ?? '')
            sseFromCanned(res, request)
          } catch {
            res.writeHead(400)
            res.end('invalid synthetic provider request')
          }
        })
      },
      { choices: [{ message: { role: 'assistant', content: 'finished' }, finish_reason: 'stop' }] },
    ])
    const response = await fetch(`${server.url}/api/agents/${agentId}/chat`, {
      method: 'POST',
      headers: headers(true),
      signal: AbortSignal.timeout(35_000),
      body: JSON.stringify({
        message: 'Run the fixture command.',
        bashApprovalMode: decision === 'auto_deny' ? 'auto_deny' : 'interactive',
        expectedSelection: { conversationId: null, revision: 0 },
      }),
    })
    expect(response.status, response.status === 200 ? undefined : await response.text()).toBe(200)
    if (!response.body) throw new Error('missing chat stream')
    const frames: ChatFrame[] = []
    let pending: CommandApproval | undefined
    let buffer = ''
    const decoder = new TextDecoder()
    for await (const bytes of response.body) {
      buffer += decoder.decode(bytes, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const frame = JSON.parse(line) as ChatFrame
        frames.push(frame)
        if (
          frame.kind !== 'event' ||
          frame.event.type !== 'command_approval' ||
          frame.event.approval.status !== 'pending'
        )
          continue
        expect(pending).toBeUndefined()
        pending = frame.event.approval
        expect(pending.command).toBe(command)
        expect(pending.risks.length).toBeGreaterThan(0)
        expect(existsSync(proofPath), 'held commands must have no workspace side effect').toBe(
          false,
        )
        const listUrl = `${server.url}/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`
        expect((await fetch(listUrl)).status).toBe(401)
        const listed = await fetch(listUrl, { headers: headers() })
        expect(listed.status).toBe(200)
        expect(await listed.json()).toMatchObject({
          approvals: [{ id: pending.id, status: 'pending' }],
        })
        if (decision === 'cancel') {
          const cancelled = await fetch(`${server.url}/api/agents/${agentId}/cancel`, {
            method: 'POST',
            headers: headers(),
          })
          expect(cancelled.status).toBe(204)
        } else {
          expect(decision).not.toBe('auto_deny')
          // The duplicate is the same operator decision, never a new model/tool invocation.
          for (let n = 0; n < 2; n++) {
            const result = await fetch(
              `${server.url}/api/shell-approvals/${encodeURIComponent(pending.id)}`,
              { method: 'POST', headers: headers(true), body: JSON.stringify({ decision }) },
            )
            expect(result.status).toBe(200)
          }
        }
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) frames.push(JSON.parse(buffer) as ChatFrame)
    expect(tools).toContain('bash')
    expect(
      tools.filter((name) => ['read', 'edit', 'write', 'ls', 'find', 'grep'].includes(name)),
    ).toEqual([])
    expect(mock.callCount()).toBe(decision === 'cancel' ? 1 : 2)
    const remaining = await fetch(
      `${server.url}/api/shell-approvals?agentId=${encodeURIComponent(agentId)}`,
      { headers: headers() },
    )
    expect(await remaining.json()).toEqual({ approvals: [] })
    return { frames, pending }
  }

  test('allow releases the real container command exactly once after duplicate HTTP decisions', async () => {
    const { frames, pending } = await journey('allow')
    expect(pending).toBeDefined()
    expect(readFileSync(proofPath, 'utf8')).toBe('executed\n')
    expect(
      frames.some(
        (frame) =>
          frame.kind === 'event' &&
          frame.event.type === 'tool_result' &&
          frame.event.name === 'bash' &&
          frame.event.result.includes('sandbox=/workspace'),
      ),
    ).toBe(true)
    expect(frames.at(-1)?.kind).toBe('done')
  }, 45_000)

  test('deny holds then refuses the real container command without a workspace side effect', async () => {
    const { frames, pending } = await journey('deny')
    expect(pending).toBeDefined()
    expect(existsSync(proofPath)).toBe(false)
    expect(
      frames.some((frame) => frame.kind === 'event' && frame.event.type === 'tool_error'),
    ).toBe(true)
    expect(frames.at(-1)?.kind).toBe('done')
  }, 45_000)

  test('non-interactive approval is auto-denied without holding or executing the command', async () => {
    const { frames, pending } = await journey('auto_deny')
    expect(pending).toBeUndefined()
    expect(existsSync(proofPath)).toBe(false)
    expect(
      frames.some((frame) => frame.kind === 'event' && frame.event.type === 'tool_error'),
    ).toBe(true)
    expect(frames.at(-1)?.kind).toBe('done')
  }, 45_000)

  test('cancellation releases a pending approval without executing or replaying its command', async () => {
    const { frames, pending } = await journey('cancel')
    expect(pending).toBeDefined()
    expect(existsSync(proofPath)).toBe(false)
    expect(
      frames.some(
        (frame) =>
          frame.kind === 'event' &&
          frame.event.type === 'command_approval' &&
          frame.event.approval.status === 'cancelled',
      ),
      JSON.stringify(frames),
    ).toBe(true)
  }, 45_000)
})
