// Specialist-verification live run (BAZ-044 gap closure).
//
//   pnpm tsx scripts/verification-live-run.mjs
//
// Boots a disposable daemon against a disposable repository and drives the story's whole loop through
// the real surfaces: a coder agent captures its change, asks an existing Team specialist to verify it,
// yields, the specialist runs the declared check, and the coder is woken by the result.
//
// The model is scripted by default, so this exercises the entire real path — daemon, worker
// subprocesses, the requester capability, restricted capability over IPC, the daemon-side executor, the
// BAZ-041 receipt, the result handed back and the inbox wake — without a provider key or network
// egress. What it does not establish is that a model *chooses* these tools unprompted; that is one env
// var away:
//
//   FIREWORKS_API_KEY=… pnpm tsx scripts/verification-live-run.mjs --model fireworks:accounts/fireworks/models/deepseek-v4-flash-0731
//
// The key is read from the environment of *this* process and passed to the disposable daemon. Nothing in
// this script prints it: every line goes through a scrubber that replaces any credential-looking
// environment value, including in failure output. Keep the key out of this repository, and never pass it
// as an argument — arguments land in shell history and in `ps`.
//
// Exits non-zero on the first invariant that does not hold. Evidence stays under the printed home so a
// failure can be inspected rather than re-run.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { startTestServer } from '../apps/cli/test/server-fixture.ts'

// Anything that looks like a credential in this process's environment is scrubbed from every line this
// script prints. A model provider can echo request context in an error, and a harness that prints a key
// once has leaked it into a terminal, a log or a transcript.
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
const image = process.env.BAZILION_BASH_SANDBOX_IMAGE ?? 'bazilion-coding:node24-pnpm10'
const sandbox = process.env.BAZILION_BASH_SANDBOX === 'docker' ? 'docker' : 'off'

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
  // 1. The coder asks an existing specialist to verify the change it just made.
  tool('ask', 'request_verification', {
    specialist: 'tester',
    checks: [
      {
        command: 'sh check.sh',
        purpose: 'the declared check for this change',
        timeoutSeconds: 60,
      },
    ],
    summary: 'the answer should now be 42',
    writablePaths: ['build'],
  }),
  // 2. It yields.
  say('Requested verification from tester; ending my turn.'),
  // 3. The specialist reads the captured request.
  tool('read', 'verification_request', {}),
  // 4. It runs the one declared check.
  tool('run', 'verification_check', { ordinal: 0 }),
  // 5. It reports what happened.
  say('Ran the declared check; the receipt records what it did.'),
  // 6. The coder, woken by the result, reports what it was told.
  say('The specialist reported the outcome; nothing is published.'),
]

let providerCalls = 0
const provider = createServer((request, response) => {
  let body = ''
  request.on('data', (piece) => {
    body += piece
  })
  request.on('end', () => {
    const call = providerCalls++
    if (process.env.VERIFY_LIVE_DEBUG && call === 0) {
      const names = (JSON.parse(body).tools ?? []).map((entry) => entry.function?.name)
      err(`[debug] tools offered: ${names.join(', ')}`)
    }
    const [delta, finish] = script[call] ?? say('Done.')
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    const frame = (payload) =>
      `data: ${JSON.stringify({ id: 'live-run', object: 'chat.completion.chunk', choices: [{ index: 0, ...payload }] })}\n\n`
    response.write(frame({ delta: { role: 'assistant' }, finish_reason: null }))
    response.write(frame({ delta, finish_reason: finish }))
    response.end('data: [DONE]\n\n')
  })
})
await new Promise((resolve) => provider.listen(0, '127.0.0.1', resolve))

const home = mkdtempSync(join(tmpdir(), 'baz044-live-'))
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
// The coder's change, and the check it wants run against it. The check writes into the declared
// output directory and, deliberately, somewhere it did not declare.
writeFileSync(join(repo, 'app.js'), 'export const answer = 42\n')
writeFileSync(
  join(repo, 'check.sh'),
  '#!/bin/sh\nmkdir -p build && echo out > build/out.txt && echo stray > stray.txt\nexit 0\n',
)
// Executable, so a model that asks for `./check.sh` gets a real result rather than a permission error.
chmodSync(join(repo, 'check.sh'), 0o755)

// The scheduler is left ON: requests are dispatched by its tick and the coder is woken by its inbox
// wake, which is the production path — the harness never reaches into the daemon to start either.
const server = await startTestServer({
  LMSTUDIO_URL: `http://127.0.0.1:${provider.address().port}/v1`,
  BAZILION_BASH_SANDBOX: sandbox,
  BAZILION_BASH_SANDBOX_IMAGE: image,
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
      ...(init.headers ?? {}),
    },
  }).then((response) => response.json())
const run = async (args) => {
  const result = await server.cli(args)
  if (result.exitCode !== 0) {
    throw new Error(`bazilion ${args.join(' ')} failed: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}
// A real model is slower than the scripted one, especially on its first turn with the full system
// prompt and repository context, so the wait budget is longer when a provider is actually being called.
/**
 * A turn that produced nothing must not be read as a turn that succeeded.
 *
 * This is the check that would have caught a broken provider path immediately: the CLI exits 0 when an
 * *error event* was reported (only a fatal frame is non-zero), so a turn that did nothing looks quiet. The
 * session transcript is the authority on whether anything was actually said.
 */
const requireTurnSpoke = (home, label, cliOutput) => {
  const agentsDir = join(home, 'agents')
  const sessions = []
  for (const agent of existsSync(agentsDir) ? readdirSync(agentsDir) : []) {
    const dir = join(agentsDir, agent, 'sessions')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) sessions.push(join(dir, file))
  }
  sessions.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  const newest = sessions[0]
  if (!newest)
    throw new Error(`${label}: the turn wrote no session at all. CLI output:\n${cliOutput}`)
  const spoke = readFileSync(newest, 'utf8')
    .split('\n')
    .filter(Boolean)
    .some((line) => {
      try {
        const entry = JSON.parse(line)
        const content = entry?.message?.content
        if (entry?.message?.role !== 'assistant' || !Array.isArray(content)) return false
        return content.some((part) =>
          part?.type === 'text' ? part.text.trim() !== '' : part?.type === 'toolCall',
        )
      } catch {
        return false
      }
    })
  if (!spoke) {
    throw new Error(
      `${label}: the turn produced no assistant message or tool call, so nothing happened. ` +
        `CLI output:\n${cliOutput}`,
    )
  }
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
  const team = 'live-run'
  out(`home:  ${home}`)
  out(`model: ${model}${realModel ? ' (real provider)' : ' (scripted)'}`)

  // A provider is only usable when the admin switch is on and the model is curated. The disposable home
  // starts with the fixture's defaults, so a real provider has to be admitted here — otherwise the run
  // fails on configuration rather than on anything it is meant to establish.
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
  // Two ordinary members of one Team: the coder that asks, and the specialist it hands the change to.
  await run(['profile', 'create', 'run-profile', '--name', 'Run', '--model', model])
  for (const name of ['coder', 'tester']) {
    await run(['agent', 'spawn', '--profile', 'run-profile', '--name', name, '--team', team])
  }
  const agents = await api('/api/agents')
  const coder = agents.find((entry) => entry.name === 'coder')?.id
  assert.ok(coder, 'the coder agent exists')

  // The coder asks in an ordinary chat turn. Nothing in this harness creates the request.
  const coderTurn = await run([
    'agent',
    'chat',
    'coder',
    '--message',
    'finish the change and have it verified',
  ])
  requireTurnSpoke(server.home, 'the coder turn', coderTurn)
  out('coder turn finished; waiting for the verification and the wake')

  const requests = await waitFor('a verification request', async () => {
    const list = await api(`/api/teams/${team}/verifications`)
    return list.requests.length > 0 ? list.requests : null
  })
  const requestId = requests[0].request.id
  const settled = await waitFor('a terminal request state', async () => {
    const report = await api(`/api/teams/${team}/verifications/${requestId}`)
    const state = report.request.request.state
    return ['completed', 'failed', 'blocked', 'cancelled', 'uncertain'].includes(state)
      ? report.request
      : null
  })
  const attempt = settled.attempts.at(-1)
  const outcome = attempt?.outcomes?.[0]
  // The commands are the *model's* choice, so they are printed rather than asserted.
  settled.checks.forEach((check) =>
    out(`asked for: [${check.ordinal}] ${check.command} (${check.purpose})`),
  )
  // The receipt's provenance comes from the daemon's own store, not from the report: it must name the
  // exact revision the request captured.
  const receiptRow = outcome?.commandId
    ? (() => {
        const db = new DatabaseSync(join(server.home, 'bazilion.db'))
        const row = db
          .prepare('SELECT receipt_json FROM coding_commands WHERE id = ?')
          .get(outcome.commandId)
        db.close()
        return row ? JSON.parse(row.receipt_json) : null
      })()
    : null
  if (receiptRow) {
    const provenance = receiptRow.sourceBefore?.id ?? '(none)'
    out(
      `receipt names revision: ${String(provenance).slice(0, 16)}${
        provenance === settled.request.snapshot.id ? ' (matches the request)' : ' (MISMATCH)'
      }`,
    )
  }
  out(`\nrequest:  ${requestId} -> ${settled.request.state}`)
  out(`requester: ${settled.request.requester.agentId} (the coder agent, not the operator)`)
  out(`attempt:  ${attempt?.state}${attempt?.error ? ` (${attempt.error})` : ''}`)
  out(`check:    [${outcome?.ordinal}] ${outcome?.state} exit ${outcome?.exitCode}`)
  out(`receipt:  ${outcome?.commandId ?? 'none'}`)
  out(`writes:   declared ${JSON.stringify(attempt?.observedWrites?.declaredPaths)}`)
  out(`          observed ${JSON.stringify(attempt?.observedWrites?.observedPaths)}`)
  out(`          undeclared ${JSON.stringify(attempt?.observedWrites?.undeclaredPaths)}`)

  // The plan is the model's; the facts are the executor's. Assert the executor's.
  assert.equal(settled.request.state, 'completed', 'the request settled with evidence')
  assert.equal(settled.request.requester.kind, 'agent', 'an agent was the requester')
  assert.equal(settled.request.requester.agentId, coder, 'the coder asked, not the operator')
  assert.equal(attempt?.state, 'completed')
  // A real model chooses its own checks, so the assertion is that *something executed and is recorded*,
  // never that a particular command succeeded.
  const executed = (attempt?.outcomes ?? []).filter((entry) =>
    ['succeeded', 'failed'].includes(entry.state),
  )
  assert.ok(executed.length > 0, 'at least one required check executed')
  assert.ok(
    executed.every((entry) => entry.commandId),
    'every executed check has an executor-owned receipt',
  )
  assert.equal(
    receiptRow?.sourceBefore?.id,
    settled.request.snapshot.id,
    'the receipt names the exact revision the request captured',
  )
  if (!realModel) {
    // Deterministic only for the scripted run: it is the strict regression case.
    assert.equal(outcome?.state, 'succeeded')
    assert.deepEqual(attempt?.observedWrites?.declaredPaths, ['build'])
    assert.deepEqual(attempt?.observedWrites?.undeclaredPaths, ['stray.txt'])
  }
  // The verification never touched the change it was handed.
  assert.match(readFileSync(join(repo, 'app.js'), 'utf8'), /answer = 42/)

  // The loop closes: the coder was woken by the result and told what the specialist found.
  // The result crosses the ordinary messaging path, so wait for it rather than assuming the send and
  // the settle are the same instant.
  const message = await waitFor('the result message', async () => {
    const inbox = await api(`/api/agents/${coder}/messages`)
    return inbox.messages.find((entry) => entry.fromAgentId === settled.request.recipientAgentId)
  })
  out(`\nresult message (${message.id}):\n${message.payload}`)
  assert.match(message.payload, /coding-receipt:/)
  if (!realModel) {
    assert.match(message.payload, /Writes outside the declared output paths \(build\): stray\.txt/)
  }
  out(
    `\nscripted-provider calls: ${providerCalls}${
      realModel ? ' (a real-model run talks to the provider instead)' : ''
    }`,
  )

  out(
    '\nobserved: coder asks -> capture -> restricted specialist -> daemon-executed check -> receipt -> result -> coder woken',
  )
  if (!realModel) {
    out(
      'the model was scripted; rerun with --model <provider:model> and a provider key to let a real model choose the tools',
    )
  }
} catch (error) {
  err(`\nFAILED: ${error instanceof Error ? error.message : String(error)}`)
  err(`evidence kept at ${home}`)
  await server.stop({ keepHome: true })
  provider.close()
  process.exit(1)
}

await server.stop()
provider.close()
