import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import { extractAgentId } from './helpers.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

let server: TestServer
let owner: string
let helper: string
let requests = 0
const leases: string[] = []
const failures: string[] = []
let resumed = false
const fake = createServer(async (request, response) => {
  try {
    let raw = ''
    for await (const chunk of request) raw += chunk
    const body = JSON.parse(raw)
    const db = openDb(join(server.home, 'bazilion.db'))
    let step: [string, unknown] | undefined
    try {
      const writers = db.raw.query<{ id: string }, []>('SELECT id FROM workspace_writers').all()
      if (writers.length !== 1) throw new Error('Expected exactly one workspace writer')
      leases.push(writers[0]!.id)
      switch (requests++) {
        case 0:
          step = [
            'send_message',
            { to: helper, text: 'HANDOFF_TASK: run the scoped test and reply with its receipt.' },
          ]
          break
        case 1:
          break
        case 2:
          if (!JSON.stringify(body.messages).includes('HANDOFF_TASK'))
            throw new Error('Missing inbox task')
          step = [
            'coding_command',
            {
              command: 'node --test scoped.test.cjs',
              cwd: '.',
              purpose: 'test',
              timeoutSeconds: 10,
            },
          ]
          break
        case 3: {
          const receipt = db.raw.query<{ id: string }, []>('SELECT id FROM coding_commands').get()!
          const message = db.raw
            .query<{ id: string }, [string]>('SELECT id FROM messages WHERE from_agent_id = ?')
            .get(owner)!
          step = [
            'send_message',
            {
              to: owner,
              text: `HANDOFF_RESULT: coding-receipt:${receipt.id}`,
              reply_to: message.id,
            },
          ]
          break
        }
        case 4:
          break
        case 5: {
          const receipt = db.raw.query<{ id: string }, []>('SELECT id FROM coding_commands').get()!
          const message = db.raw
            .query<{ id: string }, [string]>('SELECT id FROM messages WHERE from_agent_id = ?')
            .get(helper)!
          if (!JSON.stringify(body.messages).includes('HANDOFF_RESULT'))
            throw new Error('Missing result wake')
          step = ['coding_receipt', { id: receipt.id, messageId: message.id }]
          break
        }
        case 6:
          if (!JSON.stringify(body.messages).includes('succeeded'))
            throw new Error('Missing peer evidence')
          resumed = true
          break
        default:
          throw new Error('Unexpected extra turn')
      }
    } finally {
      db.close()
    }
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const delta = step
      ? {
          tool_calls: [
            {
              index: 0,
              id: `handoff-${requests}`,
              type: 'function',
              function: { name: step[0], arguments: JSON.stringify(step[1]) },
            },
          ],
        }
      : { content: 'Finished this part; continue from the scoped result.' }
    response.write(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }] })}\n\n`,
    )
    response.write(
      `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: step ? 'tool_calls' : 'stop' }] })}\n\n`,
    )
    response.end('data: [DONE]\n\n')
  } catch (error) {
    failures.push(String(error))
    response.writeHead(500)
    response.end('fixture failed')
  }
})
beforeAll(async () => {
  if (process.env.BAZILION_TEST_DOCKER !== '1') return
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
  const address = fake.address()
  if (!address || typeof address === 'string') throw new Error('Missing port')
  server = await startTestServer({
    LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
    BAZILION_SCHEDULER: 'on',
    BAZILION_SCHEDULER_TICK_MS: '100',
    BAZILION_PUBLIC_ORIGIN: '',
    BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
    BAZILION_BASH_SANDBOX: 'docker',
    BAZILION_BASH_SANDBOX_IMAGE:
      process.env.BAZILION_TEST_DOCKER_IMAGE ?? 'bazilion-coding:node24-pnpm10',
    TELEGRAM_BOT_TOKEN: '',
  })
})
afterAll(async () => {
  await server?.stop()
  if (fake.listening) await new Promise<void>((resolve) => fake.close(() => resolve()))
})
test.skipIf(process.env.BAZILION_TEST_DOCKER !== '1')(
  'existing inbox handoff releases ownership, runs protected peer and resumes with authorized evidence',
  async () => {
    writeFileSync(
      join(server.home, 'teams/default/scoped.test.cjs'),
      "require('node:test')('scoped',()=>require('node:assert').equal(2+2,4))",
    )
    expect(
      (await server.cli(['profile', 'create', 'coder', '--model', 'lmstudio:test-model'])).exitCode,
    ).toBe(0)
    owner = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout)
    helper = extractAgentId((await server.cli(['agent', 'spawn', '--profile', 'coder'])).stdout)
    const db = openDb(join(server.home, 'bazilion.db'))
    try {
      db.raw.run(
        "INSERT INTO team_policy_edges (team_id,source_kind,source_id,target_kind,target_id,posture) VALUES ('default','agent',?,'agent',?,'allow') ON CONFLICT DO NOTHING",
        [owner, helper],
      )
      db.raw.run(
        "INSERT INTO team_policy_edges (team_id,source_kind,source_id,target_kind,target_id,posture) VALUES ('default','agent',?,'agent',?,'allow') ON CONFLICT DO NOTHING",
        [helper, owner],
      )
      for (const agent of [owner, helper]) {
        db.raw.run(
          "INSERT INTO team_policy_edges (team_id,source_kind,source_id,target_kind,target_id,posture) VALUES ('default','user','','agent',?,'allow') ON CONFLICT DO NOTHING",
          [agent],
        )
        db.raw.run(
          "INSERT INTO team_policy_edges (team_id,source_kind,source_id,target_kind,target_id,posture) VALUES ('default','agent',?,'user','','allow') ON CONFLICT DO NOTHING",
          [agent],
        )
      }
      const result = await server.cli([
        'agent',
        'chat',
        owner,
        '--message',
        'Delegate the scoped test to the helper and yield.',
      ])
      expect(result.exitCode, result.stderr).toBe(0)
      await expect.poll(() => resumed || failures.length > 0, { timeout: 20000 }).toBe(true)
      expect(failures).toEqual([])
      expect(resumed).toBe(true)
      expect(leases).toHaveLength(7)
      expect(leases[0]).toBe(leases[1])
      expect(leases[2]).toBe(leases[4])
      expect(leases[5]).toBe(leases[6])
      expect(new Set(leases).size).toBe(3)
      const receipt = db.raw
        .query<{ agent_id: string; receipt_json: string }, []>(
          'SELECT agent_id,receipt_json FROM coding_commands',
        )
        .get()!
      expect(receipt.agent_id).toBe(helper)
      expect(JSON.parse(receipt.receipt_json)).toMatchObject({
        state: 'succeeded',
        environment: { posture: 'protected' },
      })
      await expect
        .poll(
          () =>
            db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM workspace_writers').get()?.n,
        )
        .toBe(0)
    } finally {
      db.close()
    }
  },
  30000,
)
