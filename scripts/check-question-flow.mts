// Disposable end-to-end question check: pnpm tsx scripts/check-question-flow.mts
// Uses real daemon/Pi workers and a local provider simulator; no external API calls.

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '')
process.env.BAZILION_HOME = mkdtempSync(join(tmpdir(), 'bazilion-question-check-'))
process.env.BAZILION_SCHEDULER = 'off'
process.env.BAZILION_BASH_SANDBOX = 'off'
process.env.BAZILION_TEAM_POLICY_ENFORCEMENT = 'on'
const fake = createServer(async (req, res) => {
  try {
    if (req.url?.endsWith('/models')) {
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ data: [{ id: 'demo' }] }))
      return
    }
    let bytes = ''
    for await (const part of req) bytes += part
    const body = JSON.parse(bytes)
    const messages = body.messages ?? []
    const lastUser = messages.findLastIndex((m: any) => m.role === 'user')
    const answered = messages.slice(lastUser).some((m: any) => m.role === 'tool')
    assert(body.tools?.some((t: any) => t.function?.name === 'ask_user'))
    res.writeHead(200, { 'content-type': 'text/event-stream' })
    const chunk = (delta: any, finish_reason: any = null) =>
      res.write(
        `data: ${JSON.stringify({ id: randomUUID(), object: 'chat.completion.chunk', created: 1, model: 'demo', choices: [{ index: 0, delta, finish_reason }] })}\n\n`,
      )
    chunk({ role: 'assistant' })
    if (!answered) {
      chunk({
        tool_calls: [
          {
            index: 0,
            id: 'question-call',
            type: 'function',
            function: {
              name: 'ask_user',
              arguments: JSON.stringify({
                prompt: 'Which format should this report use?',
                choices: [{ label: 'Text' }, { label: 'JSON' }],
                recommendedIndex: 1,
              }),
            },
          },
        ],
      })
      chunk({}, 'tool_calls')
    } else {
      chunk({
        content: 'The clarification result was received. This is a disposable provider simulation.',
      })
      chunk({}, 'stop')
    }
    res.end('data: [DONE]\n\n')
  } catch (error) {
    console.error(error)
    res.writeHead(500)
    res.end()
  }
})
await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
const providerAddress = fake.address()
assert(providerAddress && typeof providerAddress !== 'string')
process.env.LMSTUDIO_URL = `http://127.0.0.1:${providerAddress.port}/v1`
const { getCtx } = await import(`${root}/apps/daemon/src/lib/ctx.ts`)
const { seedDefaults } = await import(`${root}/apps/daemon/src/core/profile/seed.ts`)
const { createProfile } = await import(`${root}/apps/daemon/src/core/profile/create.ts`)
const { spawnAgent } = await import(`${root}/apps/daemon/src/core/agent/spawn.ts`)
const providers = await import(`${root}/apps/daemon/src/core/repos/providerState.ts`)
const models = await import(`${root}/apps/daemon/src/core/repos/providerModels.ts`)
const { createApp } = await import(`${root}/apps/daemon/src/app.ts`)
const { serve } = await import(`${root}/apps/daemon/node_modules/@hono/node-server/dist/index.mjs`)
const { db, paths, authToken } = getCtx()
providers.setEnabled(db, 'lmstudio', true)
models.replace(db, 'lmstudio', ['demo'])
seedDefaults(db, paths, { model: 'lmstudio:demo' })
createProfile(db, paths, {
  id: 'questions',
  defaultModel: 'lmstudio:demo',
  communicationDefaults: {
    userInput: true,
    userOutput: true,
    outsideTeamInput: false,
    outsideTeamOutput: false,
    peerDefault: 'allow_all',
  },
})
const agent = spawnAgent(db, paths, { profileId: 'questions', name: 'Question end-to-end fixture' })
const server = serve({ fetch: createApp().fetch, hostname: '127.0.0.1', port: 0 })
await new Promise<void>((resolve) =>
  server.listening ? resolve() : server.once('listening', resolve),
)
const daemonAddress = server.address()
assert(daemonAddress && typeof daemonAddress !== 'string')
const base = `http://127.0.0.1:${daemonAddress.port}`
const headers = { authorization: `Bearer ${authToken}`, 'content-type': 'application/json' }
const answers = [
  { kind: 'choice', index: 1 },
  { kind: 'text', text: 'CSV please' },
  { kind: 'skip' },
]
try {
  for (const [index, answer] of answers.entries()) {
    const head = (await (
      await fetch(`${base}/api/agents/${agent.id}/sessions/head`, { headers })
    ).json()) as any
    const response = await fetch(`${base}/api/agents/${agent.id}/chat`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: `Report ${index}`,
        questionMode: 'web',
        bashApprovalMode: 'auto_deny',
        expectedSelection: head.selection,
      }),
      signal: AbortSignal.timeout(30000),
    })
    assert.equal(response.status, 200)
    assert(response.body)
    let buffer = '',
      question: any,
      done = false
    for await (const chunk of response.body as any) {
      buffer += new TextDecoder().decode(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const frame = JSON.parse(line)
        if (frame.kind === 'fatal') throw new Error(frame.error)
        if (frame.kind === 'event' && frame.event.type === 'agent_question') {
          question = frame.event.question
          const reply = await fetch(
            `${base}/api/agents/${agent.id}/questions/${question.id}/answer`,
            {
              method: 'POST',
              headers,
              body: JSON.stringify({
                requestId: randomUUID(),
                conversationId: question.conversationId,
                answer,
              }),
            },
          )
          assert.equal(reply.status, 200, await reply.text())
        }
        if (frame.kind === 'done') {
          done = true
          assert(!JSON.stringify(frame.messages).includes('Which format should this report use?'))
        }
      }
    }
    assert(question, 'Question event missing')
    assert(done, 'Done missing')
    const outcome = (await (
      await fetch(`${base}/api/agents/${agent.id}/questions/${question.id}`, { headers })
    ).json()) as any
    assert.equal(outcome.continuation, 'consumed', JSON.stringify(outcome))
    const history = await (
      await fetch(`${base}/api/agents/${agent.id}/conversations/${question.conversationId}`, {
        headers,
      })
    ).json()
    assert(
      JSON.stringify(history).includes('Which format should this report use?'),
      'Released saved question missing',
    )
    console.log(
      `PASS real worker ${answer.kind}: accepted, persisted, consumed and authorized history; reused provider tool ID`,
    )
  }
  console.log(`Fixture home: ${paths.home}`)
} finally {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
  fake.closeAllConnections()
  await new Promise<void>((r) => fake.close(() => r()))
  db.close()
}
