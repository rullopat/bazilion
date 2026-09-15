import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CodingCommandLogPage, CodingCommandReceipt } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { createProfile, spawnAgent } from '../../src/core/index.ts'
import {
  CODING_COMMAND_MAX_PER_TEAM,
  getCodingCommand,
  interruptCodingCommands,
  saveCodingCommand,
} from '../../src/core/repos/coding-commands.ts'
import { getSourceSnapshot, listSourceSnapshots } from '../../src/core/repos/source-snapshots.ts'
import { createCodingHost } from '../../src/lib/coding-environment/agent-host.ts'
import { CodingDiagnostics, codingSecrets } from '../../src/lib/coding-environment/diagnostics.ts'
import { createDbMessagingHost } from '../../src/lib/messaging-host.ts'
import { codingTools } from '../../src/runtime/pi/coding.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'
import { emptyRepositoryContext } from '../fixtures/repository-context.ts'

let env: TestEnv
let owner: string
let peer: string
let root: string
const command = {
  command: 'node --version',
  cwd: '.',
  purpose: 'runtime' as const,
  timeoutSeconds: 5,
}
beforeEach(() => {
  env = makeTestEnv()
  root = env.paths.teamDir(env.teamId)
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  createProfile(env.db, env.paths, {
    id: 'coder',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  owner = spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: env.teamId }).id
  peer = spawnAgent(env.db, env.paths, { profileId: 'coder', teamId: env.teamId }).id
})
afterEach(() => {
  vi.unstubAllEnvs()
  env.cleanup()
})
function host(agentId = owner, turnId = 'turn', secrets: string[] = []) {
  return createCodingHost({
    db: env.db,
    paths: env.paths,
    agentId,
    teamId: env.teamId,
    turnId,
    root,
    posture: 'host',
    imageId: null,
    values: {},
    context: async () => emptyRepositoryContext(env.teamId),
    assertActive: () => {},
    secrets,
  })
}
async function receipt() {
  const h = host()
  const started = (await h.invoke({
    action: 'start',
    toolCallId: 'call',
    input: command,
  })) as CodingCommandReceipt
  return (await h.invoke({
    action: 'finish',
    id: started.id,
    outcome: { state: 'succeeded', exitCode: 0, diagnostic: 'v24', truncated: false, reason: null },
  })) as CodingCommandReceipt
}
test('receipts require producer messages, current policy and current membership', async () => {
  const r = await receipt()
  const receiver = host(peer, 'peer-turn')
  await expect(receiver.invoke({ action: 'read', id: r.id })).rejects.toThrow(
    'authorized producer message',
  )
  const messages = createDbMessagingHost(env.db)
  const message = await messages.sendMessage({
    from: owner,
    to: peer,
    replyTo: null,
    payload: `Check coding-receipt:${r.id}`,
  })
  await expect(
    receiver.invoke({ action: 'read', id: r.id, messageId: message.messageId }),
  ).resolves.toMatchObject({ applicability: 'fresh', receipt: { id: r.id } })
  env.db.raw.run(
    'DELETE FROM team_policy_edges WHERE team_id = ? AND source_id = ? AND target_id = ?',
    [env.teamId, owner, peer],
  )
  await expect(
    receiver.invoke({ action: 'read', id: r.id, messageId: message.messageId }),
  ).rejects.toThrow('authorized producer message')
  env.db.raw.run("INSERT INTO teams (id,name,created_at) VALUES ('elsewhere','Elsewhere',0)")
  env.db.raw.run("UPDATE agents SET team_id = 'elsewhere' WHERE id = ?", [owner])
  await expect(
    receiver.invoke({ action: 'read', id: r.id, messageId: message.messageId }),
  ).rejects.toThrow('unavailable')
})
test('input changes and restart invalidate evidence without replaying commands', async () => {
  const r = await receipt()
  writeFileSync(join(root, 'pnpm-lock.yaml'), 'changed')
  await expect(host().invoke({ action: 'read', id: r.id })).resolves.toMatchObject({
    applicability: 'stale',
  })
  const running = (await host(owner, 'other').invoke({
    action: 'start',
    toolCallId: 'other',
    input: command,
  })) as CodingCommandReceipt
  interruptCodingCommands(env.db)
  expect(getCodingCommand(env.db, running.id)).toMatchObject({
    state: 'interrupted',
    environment: { inputFingerprint: null },
  })
  await expect(host().invoke({ action: 'read', id: r.id })).resolves.toMatchObject({
    applicability: 'unknown',
  })
})
test('turn ownership, duplicate calls and bounded redacted outcomes are enforced', async () => {
  const h = host(owner, 'turn', ['SECRET_VALUE'])
  const r = (await h.invoke({
    action: 'start',
    toolCallId: 'call',
    input: command,
  })) as CodingCommandReceipt
  await expect(h.invoke({ action: 'start', toolCallId: 'second', input: command })).rejects.toThrow(
    'active',
  )
  const outcome = {
    state: 'succeeded' as const,
    exitCode: 0,
    diagnostic: 'SECRET_VALUE',
    truncated: false,
    reason: null,
  }
  await expect(host(peer).invoke({ action: 'finish', id: r.id, outcome })).rejects.toThrow(
    'active turn',
  )
  await expect(
    h.invoke({ action: 'finish', id: r.id, outcome: { ...outcome, exitCode: 1 } }),
  ).rejects.toThrow('terminal evidence')
  await expect(h.invoke({ action: 'finish', id: r.id, outcome })).resolves.toMatchObject({
    diagnostic: '[redacted]',
  })
  await expect(h.invoke({ action: 'start', toolCallId: 'call', input: command })).rejects.toThrow(
    'repeated',
  )
  await expect(
    h.invoke({
      action: 'start',
      toolCallId: 'secret',
      input: { ...command, command: 'echo SECRET_VALUE' },
    }),
  ).rejects.toThrow('credential')
})
test('retention caps terminal evidence and never prunes an active command', async () => {
  const r = await receipt()
  for (let i = 0; i < CODING_COMMAND_MAX_PER_TEAM + 5; i++)
    saveCodingCommand(env.db, {
      ...r,
      id: `receipt-${i}`,
      toolCallId: `call-${i}`,
      startedAt: Date.now() + i,
    })
  const active = (await host(owner, 'active').invoke({
    action: 'start',
    toolCallId: 'active',
    input: command,
  })) as CodingCommandReceipt
  // Oldest finished receipts are pruned to the cap; the running command is preserved.
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM coding_commands').get()?.n,
  ).toBe(CODING_COMMAND_MAX_PER_TEAM + 1)
  expect(getCodingCommand(env.db, active.id)?.state).toBe('running')
})
test('same-workspace handoff returns promptly instead of waiting on its own lease', async () => {
  const messages = createDbMessagingHost(env.db, {
    workspace: { root, paths: env.paths, agentId: owner },
  })
  const sent = await messages.sendMessage({
    from: owner,
    to: peer,
    replyTo: null,
    payload: 'Run tests after my turn',
  })
  expect(() => messages.findReplies(owner, sent.messageId)).toThrow('end this turn')
  await messages.sendMessage({ from: peer, to: owner, payload: 'done', replyTo: sent.messageId })
  expect(await messages.findReplies(owner, sent.messageId)).toHaveLength(1)
})
test('the real host executor records failure, offline preparation, success and timeout without defaults', async () => {
  const tools = codingTools({
    host: host(),
    root,
    context: async () => emptyRepositoryContext(env.teamId),
    approval: false,
  })
  const run = tools.find((t) => t.name === 'coding_command')!
  let call = 0
  async function execute(command: string, purpose = 'test', timeoutSeconds = 5) {
    const result = await run.execute(
      `tool-${call++}`,
      { command, cwd: '.', purpose, timeoutSeconds },
      undefined,
      undefined,
      {} as never,
    )
    return JSON.parse((result.content[0] as { text: string }).text) as CodingCommandReceipt
  }
  expect((await execute(`node -e "require('./local.cjs')"`)).state).toBe('failed')
  writeFileSync(join(root, 'artifact.cjs'), 'module.exports = 42')
  expect((await execute('cp artifact.cjs local.cjs', 'prepare')).state).toBe('succeeded')
  expect(
    (await execute(`node -e "require('node:assert').equal(require('./local.cjs'),42)"`)).state,
  ).toBe('succeeded')
  expect((await execute('sleep 10', 'test', 1)).state).toBe('timed_out')
  const controller = new AbortController()
  controller.abort()
  const cancelled = await run.execute(
    'cancel',
    { ...command, command: 'sleep 10' },
    controller.signal,
    undefined,
    {} as never,
  )
  expect(JSON.parse((cancelled.content[0] as { text: string }).text).state).toBe('cancelled')
  expect(
    env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM team_coding_environments').get()
      ?.n,
  ).toBe(0)
})

test('retained logs are readable by the producer and only by an authorized peer', async () => {
  const h = host(owner, 'turn', ['SECRET_VALUE'])
  const started = (await h.invoke({
    action: 'start',
    toolCallId: 'log-call',
    input: { ...command, command: 'run' },
  })) as CodingCommandReceipt
  await h.invoke({
    action: 'finish',
    id: started.id,
    outcome: {
      state: 'failed',
      exitCode: 1,
      diagnostic: 'boom SECRET_VALUE',
      truncated: false,
      reason: null,
    },
  })
  // The producing Agent reads its own retained bytes, redacted at capture time.
  const page = (await host(owner, 'read-turn').invoke({
    action: 'log',
    id: started.id,
  })) as CodingCommandLogPage
  expect(page.availability).toBe('available')
  expect(page.text).toContain('[redacted]')
  expect(page.text).not.toContain('SECRET_VALUE')
  // A peer is refused until the source-owned message authorizes disclosure.
  await expect(host(peer, 'peer-turn').invoke({ action: 'log', id: started.id })).rejects.toThrow(
    'authorized producer message',
  )
  const messages = createDbMessagingHost(env.db)
  const message = await messages.sendMessage({
    from: owner,
    to: peer,
    replyTo: null,
    payload: `Check coding-receipt:${started.id}`,
  })
  const peerPage = (await host(peer, 'peer-turn').invoke({
    action: 'log',
    id: started.id,
    messageId: message.messageId,
  })) as CodingCommandLogPage
  expect(peerPage.text).toContain('[redacted]')
  // Bounded search pages over the same retained tail.
  const found = (await host(owner, 'search-turn').invoke({
    action: 'log-search',
    id: started.id,
    query: 'boom',
  })) as { matches: { line: number }[]; bounded: boolean }
  expect(found.matches).toHaveLength(1)
})

test('diagnostics bound huge output and redact credentials split across chunks', () => {
  const secrets = codingSecrets({
    OPENAI_CODEX_OAUTH: JSON.stringify({ access: 'SECRET_VALUE', refresh: 'REFRESH_VALUE' }),
  })
  const output = new CodingDiagnostics(secrets)
  output.append(Buffer.from('x'.repeat(100000)))
  output.append(Buffer.from('SECRET_'))
  output.append(Buffer.from('VALUE'))
  const result = output.finish()
  expect(result.truncated).toBe(true)
  expect(Buffer.byteLength(result.diagnostic)).toBeLessThanOrEqual(65536)
  expect(result.diagnostic).toContain('[redacted]')
  expect(result.diagnostic).not.toContain('SECRET_VALUE')
})
test('a credential learned mid-turn joins coding redaction', async () => {
  const secrets = ['FIRST_SECRET_VALUE']
  const tools = codingTools({
    host: host(),
    root,
    context: async () => emptyRepositoryContext(env.teamId),
    approval: false,
    secrets: () => secrets,
  })
  const run = tools.find((t) => t.name === 'coding_command')!
  async function execute(id: string, command: string) {
    const result = await run.execute(
      id,
      { command, cwd: '.', purpose: 'test', timeoutSeconds: 5 },
      undefined,
      undefined,
      {} as never,
    )
    return JSON.parse((result.content[0] as { text: string }).text) as CodingCommandReceipt
  }
  const first = await execute('call-a', `node -e "process.stdout.write('FIRST_SECRET_VALUE')"`)
  expect(first.diagnostic).toContain('[redacted]')
  // The token was not known when the session started: the supplier must be read
  // at command start so a mid-turn refresh redacts subsequent output.
  secrets.push('SECOND_SECRET_VALUE')
  const second = await execute('call-b', `node -e "process.stdout.write('SECOND_SECRET_VALUE')"`)
  expect(second.diagnostic).toContain('[redacted]')
  expect(second.diagnostic).not.toContain('SECOND_SECRET_VALUE')
})

test('dangerous command approval remains mandatory and does not execute on denial', async () => {
  writeFileSync(join(root, 'keep'), 'preserve')
  const tool = codingTools({
    host: host(),
    root,
    context: async () => emptyRepositoryContext(env.teamId),
    approval: true,
  }).find((t) => t.name === 'coding_command')!
  const result = await tool.execute(
    'dangerous',
    { command: 'cat .env', cwd: '.', purpose: 'prepare', timeoutSeconds: 5 },
    undefined,
    undefined,
    {} as never,
  )
  expect(JSON.parse((result.content[0] as { text: string }).text).state).toBe('blocked')
  expect(readFileSync(join(root, 'keep'), 'utf8')).toBe('preserve')
})

// ─── BAZ-042: turn-bound source snapshot + receipt linkage ────────────────────

function gitInRoot(...args: string[]): string {
  return execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      HOME: env.home,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@example.invalid',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@example.invalid',
    },
  }).trim()
}

function repoFixture(): void {
  gitInRoot('init', '-q', '-b', 'main')
  writeFileSync(join(root, 'app.txt'), 'one\n')
  gitInRoot('add', '.')
  gitInRoot('commit', '-qm', 'base')
}

test('the snapshot tool captures a start state and the receipt records it as sourceBefore', async () => {
  repoFixture()
  writeFileSync(join(root, 'app.txt'), 'changed before editing\n')
  const h = host()
  const captured = (await h.invoke({ action: 'snapshot', toolCallId: 'snap-1' })) as {
    reference: { id: string; complete: boolean }
    entries: number
  }
  expect(captured.reference.complete).toBe(true)
  expect(captured.entries).toBe(1)

  const started = (await h.invoke({
    action: 'start',
    toolCallId: 'call-1',
    input: command,
  })) as CodingCommandReceipt
  expect(started.sourceBefore).toEqual(captured.reference)
  expect(started.sourceAfter).toBeNull()

  // The persisted snapshot is readable through the Team-scoped service, with agent provenance.
  const stored = listSourceSnapshots(env.db, env.teamId)
  expect(stored).toEqual([
    expect.objectContaining({
      snapshotId: captured.reference.id,
      capturedBy: 'agent',
      agentId: owner,
      turnId: 'turn',
      toolCallId: 'snap-1',
    }),
  ])
})

test('a finished command records the source state at its own execution boundary', async () => {
  repoFixture()
  const h = host()
  const started = (await h.invoke({
    action: 'start',
    toolCallId: 'call-1',
    input: command,
  })) as CodingCommandReceipt
  // No starting capture this turn: the before reference stays absent rather than being invented.
  expect(started.sourceBefore).toBeNull()

  const finished = (await h.invoke({
    action: 'finish',
    id: started.id,
    outcome: {
      state: 'succeeded',
      exitCode: 0,
      diagnostic: 'ok\n',
      truncated: false,
      reason: null,
    },
  })) as CodingCommandReceipt
  expect(finished.sourceAfter?.complete).toBe(true)
  expect(finished.state).toBe('succeeded')
  // The reference is persisted, so a later verification can resolve it.
  const stored = getSourceSnapshot(env.db, env.teamId, finished.sourceAfter?.id ?? 'missing')
  expect(stored).not.toBeNull()
})

test('untracked content is opt-in, and a refused path is recorded rather than read', async () => {
  repoFixture()
  writeFileSync(join(root, 'notes.txt'), 'scratch\n')
  writeFileSync(join(root, '.env'), 'SECRET=1\n')
  const h = host()
  const bare = (await h.invoke({ action: 'snapshot', toolCallId: 'snap-1' })) as {
    includedUntracked: string[]
    entries: number
  }
  expect(bare.includedUntracked).toEqual([])
  expect(bare.entries).toBe(0)

  const selected = (await h.invoke({
    action: 'snapshot',
    toolCallId: 'snap-2',
    includeUntracked: ['notes.txt', '.env'],
  })) as {
    includedUntracked: string[]
    exclusions: { path: string; reason: string }[]
    entries: number
  }
  expect(selected.includedUntracked).toEqual(['notes.txt'])
  expect(selected.exclusions).toEqual([{ path: '.env', reason: 'credential_shaped' }])
  expect(selected.entries).toBe(1)
})

test('a source capture that cannot be taken never fails the command', async () => {
  // Not a repository at all: the capture is unavailable, and the command still settles.
  const h = host()
  await expect(h.invoke({ action: 'snapshot', toolCallId: 'snap-1' })).rejects.toThrow(
    /not a Git repository/i,
  )
  const started = (await h.invoke({
    action: 'start',
    toolCallId: 'call-1',
    input: command,
  })) as CodingCommandReceipt
  expect(started.sourceBefore).toBeNull()
  const finished = (await h.invoke({
    action: 'finish',
    id: started.id,
    outcome: {
      state: 'succeeded',
      exitCode: 0,
      diagnostic: 'ok\n',
      truncated: false,
      reason: null,
    },
  })) as CodingCommandReceipt
  expect(finished.state).toBe('succeeded')
  // Absent, not falsely complete: applicability for this receipt is unknown.
  expect(finished.sourceAfter).toBeNull()
})

test('a repeated or malformed snapshot tool call is rejected', async () => {
  repoFixture()
  const h = host()
  await h.invoke({ action: 'snapshot', toolCallId: 'snap-1' })
  await expect(h.invoke({ action: 'snapshot', toolCallId: 'snap-1' })).rejects.toThrow(
    /repeated coding tool call/,
  )
  await expect(h.invoke({ action: 'snapshot', toolCallId: '' })).rejects.toThrow(
    /Invalid or repeated coding tool call/,
  )
  await expect(
    h.invoke({
      action: 'snapshot',
      toolCallId: 'snap-2',
      includeUntracked: ['x'.repeat(4097)],
    }),
  ).rejects.toThrow(/Invalid untracked selection/)
})
