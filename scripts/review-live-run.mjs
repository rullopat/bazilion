// Specialist review live run (BAZ-043).
//
//   pnpm tsx scripts/review-live-run.mjs
//   FIREWORKS_API_KEY=… pnpm tsx scripts/review-live-run.mjs --model fireworks:accounts/fireworks/models/deepseek-v4-flash-0731
//
// Boots a disposable daemon against a disposable repository and drives the story's whole loop through the
// real surfaces: a coder agent captures its change, asks an existing Team member to review it, yields, the
// reviewer works statically through the restricted capability, and the coder is woken by the findings.
//
// The model is scripted by default, so this exercises the entire real path — daemon, worker subprocesses,
// the requester capability, restricted capability over IPC, the review state machine, the result handed
// back and the inbox wake — without a provider key or network egress. With `--model` and a key, a real model
// does the work instead.
//
// The key is read from this process's environment and passed to the disposable daemon. Nothing here prints
// it: every line goes through a scrubber, including the failure path.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startTestServer } from '../apps/cli/test/server-fixture.ts'

const secretValues = Object.entries(process.env)
  .filter(
    ([name, value]) =>
      typeof value === 'string' &&
      value.length >= 12 &&
      /(API_?KEY|_TOKEN$|_SECRET$|PASSWORD)/i.test(name),
  )
  .map(([, value]) => value)
const scrub = (value) => {
  let text = String(value)
  for (const secret of secretValues) text = text.split(secret).join('[redacted]')
  return text
}
const out = (...parts) => process.stdout.write(`${scrub(parts.join(' '))}\n`)
const err = (...parts) => process.stderr.write(`${scrub(parts.join(' '))}\n`)

const modelFlag = process.argv.indexOf('--model')
const realModel = modelFlag === -1 ? null : process.argv[modelFlag + 1]

const tool = (id, name, args) => [
  {
    tool_calls: [
      { index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } },
    ],
  },
  'tool_calls',
]
const say = (content) => [{ content }, 'stop']

// The scripted conversation, in call order. Turns are serial, so call order is deterministic.
const script = [
  // 1. The coder asks a teammate to review the change it just made.
  tool('ask', 'request_review', {
    reviewer: 'reviewer',
    summary: 'the answer should now be 42; check the change is complete and tested',
  }),
  // 2. It yields.
  say('Asked reviewer to read the change; ending my turn.'),
  // 3. The reviewer reads the captured revision.
  tool('read', 'review_packet', {}),
  // 4. And the patch for the changed path.
  tool('read-path', 'review_path', { path: 'app.js' }),
  // 5. It records a finding.
  tool('finding', 'review_finding', {
    path: 'app.js',
    severity: 'major',
    note: 'the new value has no test covering it',
    lineStart: 1,
    lineEnd: 1,
  }),
  // 6. And concludes.
  tool('conclude', 'review_conclusion', {
    conclusion: 'changes_requested',
    note: 'one finding: the change is untested',
  }),
  // 7. The coder, woken by the findings, reports what it was told.
  say('Reviewer asked for a test; nothing is published.'),
]

let providerCalls = 0
const provider = createServer((request, response) => {
  let body = ''
  request.on('data', (piece) => {
    body += piece
  })
  request.on('end', () => {
    const call = providerCalls++
    if (process.env.REVIEW_LIVE_DEBUG && call === 0) {
      const names = (JSON.parse(body).tools ?? []).map((entry) => entry.function?.name)
      err(`[debug] tools offered: ${names.join(', ')}`)
    }
    const [delta, finish] = script[call] ?? say('Done.')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const frame = (payload) =>
      `data: ${JSON.stringify({ id: 'review-live', object: 'chat.completion.chunk', choices: [{ index: 0, ...payload }] })}\n\n`
    response.write(frame({ delta: { role: 'assistant' }, finish_reason: null }))
    response.write(frame({ delta, finish_reason: finish }))
    response.end('data: [DONE]\n\n')
  })
})
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))

const home = mkdtempSync(join(tmpdir(), 'baz043-live-'))
const repo = join(home, 'checkout')
mkdirSync(repo)
const git = (...args) =>
  execFileSync('git', ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    },
  })
git('init', '-q', '-b', 'main')
writeFileSync(join(repo, 'app.js'), 'export const answer = 1\n')
git('add', '.')
git('-c', 'user.name=Run', '-c', 'user.email=run@example.invalid', 'commit', '-qm', 'base')
// The coder's change under review.
writeFileSync(join(repo, 'app.js'), 'export const answer = 42\n')
chmodSync(join(repo, 'app.js'), 0o644)

// The scheduler is left ON: review dispatch and the requester's inbox wake are its ticks, which is the
// production path — the harness never reaches into the daemon to start a review.
const server = await startTestServer({
  LMSTUDIO_URL: `http://127.0.0.1:${provider.address().port}/v1`,
  BAZILION_BASH_SANDBOX: 'off',
  BAZILION_SCHEDULER_TICK_MS: '500',
  BAZILION_PUBLIC_ORIGIN: '',
  TELEGRAM_BOT_TOKEN: '',
  TELEGRAM_CHAT_ID: '',
})

const api = (path, init = {}) =>
  fetch(`${server.url}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${server.token}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
    },
  }).then((response) => response.json())
const run = async (args) => {
  const result = await server.cli(args)
  if (result.exitCode !== 0) {
    throw new Error(`bazilion ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}
const waitFor = async (label, probe, attempts = realModel ? 480 : 120) => {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const value = await probe()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`timed out waiting for ${label}`)
}

try {
  const model = realModel ?? 'lmstudio:test-model'
  const team = 'live-review'
  out(`home:  ${home}`)
  out(`model: ${model}${realModel ? ' (real provider)' : ' (scripted)'}`)

  const [providerName, ...modelParts] = model.split(':')
  const modelId = modelParts.join(':')
  if (providerName && modelId) {
    await api(`/api/config/providers/${encodeURIComponent(providerName)}/enabled`, {
      method: 'PUT',
      body: JSON.stringify({ enabled: true }),
    })
    await api(`/api/config/providers/${encodeURIComponent(providerName)}/models`, {
      method: 'PUT',
      body: JSON.stringify({ models: [modelId] }),
    })
  }

  await run(['team', 'add', team, '--link', repo])
  await run(['profile', 'create', 'run-profile', '--name', 'Run', '--model', model])
  for (const name of ['coder', 'reviewer']) {
    await run(['agent', 'spawn', '--profile', 'run-profile', '--name', name, '--team', team])
  }
  const agents = await api('/api/agents')
  const coder = agents.find((entry) => entry.name === 'coder')?.id
  assert.ok(coder, 'the coder agent exists')

  await run(['agent', 'chat', 'coder', '--message', 'finish the change and have it reviewed'])
  out('coder turn finished; waiting for the review and the wake')

  const packets = await waitFor('a review packet', async () => {
    const list = await api(`/api/teams/${team}/reviews`)
    return list.packets.length > 0 ? list.packets : null
  })
  const packetId = packets[0].packet.id
  const settled = await waitFor('a terminal packet state', async () => {
    const response = await api(`/api/teams/${team}/reviews/${packetId}`)
    const report = response.report
    return ['reviewed', 'blocked', 'cancelled'].includes(report.packet.state) ? report : null
  })
  const attempt = settled.attempts.at(-1)
  out(`\npacket:   ${packetId} -> ${settled.packet.state}`)
  out(`requester: ${settled.packet.requester.agentId} (an agent, not the operator)`)
  out(`reviewer:  ${settled.packet.reviewerAgentId}`)
  out(`attempt:   ${attempt?.state}${attempt?.error ? ` (${attempt.error})` : ''}`)
  out(
    `applicability: ${settled.applicability.comparison} (stale: ${String(settled.applicability.stale)})`,
  )
  out(`findings:  ${settled.findings.length}`)
  for (const finding of settled.findings) {
    out(
      `  [${finding.severity}] ${finding.path}${finding.lineStart ? `:${finding.lineStart}` : ''} — ${finding.note} (${finding.state})`,
    )
  }
  out(`conclusion: ${settled.conclusions.map((entry) => entry.conclusion).join(', ') || 'none'}`)
  out(`reported:  ${JSON.stringify(settled.packet.reported)}`)

  assert.equal(
    settled.packet.state,
    'reviewed',
    'the reviewer concluded, so the packet is reviewed',
  )
  assert.equal(settled.packet.requester.kind, 'agent', 'the requester is an agent')
  assert.equal(settled.packet.requester.agentId, coder, 'the coder asked, not the operator')
  assert.equal(attempt?.state, 'completed')
  assert.ok(settled.findings.length > 0, 'the reviewer recorded at least one finding')
  assert.ok(
    settled.findings.every((finding) => finding.snapshotId === settled.packet.snapshot.id),
    'every finding names the revision it was made against',
  )
  assert.equal(
    settled.conclusions[0]?.snapshotId,
    settled.packet.snapshot.id,
    'the conclusion names the revision it is about',
  )
  // Nothing beyond a review is claimed: no commit, no merge, no acceptance.
  assert.deepEqual(settled.packet.reported, {
    committed: null,
    pushed: null,
    pullRequest: null,
    merged: null,
    deployed: null,
    productionAccepted: null,
  })
  assert.equal(settled.facts.reviewed, true)
  // The review never touched the change.
  assert.match(readFileSync(join(repo, 'app.js'), 'utf8'), /answer = 42/)

  const inbox = await api(`/api/agents/${coder}/messages`)
  const message = await waitFor('the review result', async () =>
    inbox.messages.find((entry) => entry.fromAgentId === settled.packet.reviewerAgentId),
  )
  out(`\nresult message (${message.id}):\n${message.payload}`)
  assert.match(message.payload, /changes_requested|commented|recommended/)
  assert.match(message.payload, /not operator acceptance/)

  out(
    `\nscripted-provider calls: ${providerCalls}${
      realModel ? ' (a real-model run talks to the provider instead)' : ''
    }`,
  )
  out(
    'observed: coder asks -> capture -> restricted reviewer -> findings + conclusion -> result -> coder woken',
  )
} catch (error) {
  err(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`)
  err(`evidence kept at ${home}`)
  await server.stop({ keepHome: true })
  provider.close()
  process.exit(1)
}

await server.stop()
provider.close()
