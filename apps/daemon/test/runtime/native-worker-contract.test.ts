import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import type { NativeExecutionAdmission } from '@bazilion/api-types'
import { afterEach, expect, test, vi } from 'vitest'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import type { NativeTurnExecution } from '../../src/lib/native-execution/turn.ts'
import { MAC_PROTECTED_EXECUTION_UNAVAILABLE } from '../../src/runtime/shell/platform-support.ts'
import { assertNativeExecutionAdmission } from '../../src/runtime/worker/native-contract.ts'
import {
  createMinimalWorkerScratch,
  type ProtectedWorkerSpec,
  parseWorkerInput,
} from '../../src/runtime/worker/runtime.ts'
import { spawnVerificationWorker, spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'
import { makeTestEnv } from '../core/helpers.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'
import { emptyRepositoryContext } from '../fixtures/repository-context.ts'

const cleanups: Array<() => void> = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})
function metadata(): NativeExecutionAdmission {
  // Deliberately synthetic description: parsing this MUST NOT grant live native authority.
  return {
    cwd: '.',
    facts: {
      backend: process.platform === 'darwin' ? 'darwin-seatbelt' : 'linux-bwrap',
      architecture: process.arch as 'x64' | 'arm64',
      nodeVersion: process.version,
      kernelRelease: release(),
      policyFingerprint: 'a'.repeat(64),
      fingerprint: 'b'.repeat(64),
    },
  }
}
function fixture() {
  const env = makeTestEnv()
  cleanups.push(env.cleanup)
  createProfile(env.db, env.paths, { id: 'native-wire', defaultModel: 'openai-codex:gpt-5.6-sol' })
  const agent = resolveAgent(
    env.db,
    env.paths,
    spawnAgent(env.db, env.paths, { profileId: 'native-wire', teamId: env.teamId }).id,
  )
  mkdirSync(join(agent.team.path, 'memory'), { recursive: true })
  const spec: ProtectedWorkerSpec = {
    kind: 'protected',
    agent,
    message: 'synthetic native wire description only',
    turnId: 'native-wire-turn',
    repositoryContext: emptyRepositoryContext(env.teamId),
    conversation: seedConversationTarget(join(agent.agent.dir, 'sessions'), agent.team.path),
    bashApprovalMode: 'auto_deny',
    webFetchEnabled: true,
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: agent.reasoningLevel,
      apiKey: 'native-wire-synthetic-key',
    },
    paths: {
      agentDir: agent.agent.dir,
      teamDir: agent.team.path,
      memoryDir: join(agent.team.path, 'memory'),
      sessionDir: join(agent.agent.dir, 'sessions'),
      skills: [],
      homeDocuments: {
        'AGENTS.md': null,
        'SOUL.md': null,
        'TOOLS.md': null,
        'IDENTITY.md': null,
        'BOOTSTRAP.md': null,
      },
    },
    nativeExecution: metadata(),
  }
  const scratch = createMinimalWorkerScratch(env.home)
  return { ...env, spec, input: { ...spec, scratch, apiKeyRefreshEnabled: true } }
}

test('closed native metadata parses but contains no launch, path, credential or recovery authority', () => {
  const f = fixture()
  expect(parseWorkerInput(f.input)).toBe(f.input)
  for (const extra of [
    { env: {} },
    { workspace: '/unadmitted' },
    { profile: 'allow default' },
    { writerId: 'forged' },
  ])
    expect(() => assertNativeExecutionAdmission({ ...metadata(), ...extra })).toThrow('description')
  for (const extra of [
    { pid: 123 },
    { nodeVersion: 'v26.4.0' },
    { kernelRelease: 'unobserved' },
    { architecture: 'unobserved' },
    { policyFingerprint: 'not-a-fingerprint' },
  ])
    expect(() =>
      assertNativeExecutionAdmission({ ...metadata(), facts: { ...metadata().facts, ...extra } }),
    ).toThrow()
  expect(() => assertNativeExecutionAdmission({ ...metadata(), cwd: '../escape' })).toThrow()
})

test('native requester admission is an explicit true-only native flag, never a restricted input capability', () => {
  const f = fixture()
  const admitted = { ...f.input, nativeVerificationRequestEnabled: true }
  expect(parseWorkerInput(admitted)).toBe(admitted)
  expect(() => parseWorkerInput({ ...admitted, nativeVerificationRequestEnabled: false })).toThrow(
    'native verification requester',
  )
  expect(() => parseWorkerInput({ ...admitted, nativeExecution: undefined })).toThrow(
    'native verification requester',
  )
  expect(() =>
    parseWorkerInput({
      kind: 'specialist_verification',
      agentId: f.spec.agent.agent.id,
      message: 'scope',
      turnId: 'scope',
      runtime: f.spec.runtime,
      verification: { requestId: 'request', attemptId: 'attempt' },
      scratch: f.input.scratch,
      apiKeyRefreshEnabled: true,
      nativeVerificationRequestEnabled: true,
    }),
  ).toThrow('native verification requester')
})

test('native worker input rejects mixed execution and a container control namespace', () => {
  const f = fixture()
  expect(() => parseWorkerInput({ ...f.input, docker: {} })).toThrow(
    'exactly one execution backend',
  )
  expect(() =>
    parseWorkerInput({ ...f.input, containerNamespace: '11111111-1111-4111-8111-111111111111' }),
  ).toThrow('Docker namespace')
  expect(() => parseWorkerInput({ ...f.input, nativeExecution: undefined })).toThrow(
    'exactly one execution backend',
  )
  const configured = {
    kind: 'configured_operator_http',
    agent: f.spec.agent,
    message: 'wire-only',
    turnId: f.spec.turnId,
    repositoryContext: f.spec.repositoryContext,
    conversation: f.spec.conversation,
    bashApprovalMode: 'auto_deny',
    enabledProviders: ['openai-codex'],
    apiKeyRefreshEnabled: false,
    nativeExecution: metadata(),
  }
  expect(parseWorkerInput(configured)).toBe(configured)
  expect(() => parseWorkerInput({ ...configured, configuredDocker: {} })).toThrow('Docker inputs')
})

test('metadata and a copied structural native host cannot start a provider worker', async () => {
  const f = fixture(),
    marker = join(f.home, 'must-not-start'),
    entry = join(f.home, 'canary.mjs')
  writeFileSync(
    entry,
    `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},'STARTED')`,
    { flag: 'wx' },
  )
  const beforeSpawn = vi.fn(),
    beforeInput = vi.fn()
  const opts = {
    messagingHost: {
      agentExists: () => false,
      sendMessage: () => ({ messageId: 'unused' }),
      listInbox: () => [],
      markRead() {},
      findReplies: () => [],
      approvalStatus: () => null,
    },
    userMdHost: {
      get: () => ({ content: '', etag: 'unused' }),
      write: () => ({ etag: 'unused', totalBytes: 0 }),
    },
    bashApprovalHost: {
      begin() {
        throw new Error('unused')
      },
    },
    apiKeyRefreshHost: {
      async refresh() {
        return 'unused'
      },
    },
    workerEntryPath: entry,
    resourceLifecycle: {
      beforeSpawn,
      beforeInput,
      beforeSignal() {},
      async afterExit() {
        return true
      },
    },
    nativeExecutionSecrets: () => [],
  }
  const run = async (host: unknown) => {
    for await (const _frame of spawnWorkerTurn(f.spec, {
      ...opts,
      nativeExecutionHost: host as NativeTurnExecution,
    })) {
      /* must refuse before spawn */
    }
  }
  const rejection = process.platform === 'darwin' ? MAC_PROTECTED_EXECUTION_UNAVAILABLE : 'refused'
  await expect(run(undefined)).rejects.toThrow(rejection)
  await expect(
    run({
      facts: metadata().facts,
      cwd: '.',
      async exec() {
        throw new Error('forged')
      },
      cancel() {
        return false
      },
      async close() {
        return true
      },
    }),
  ).rejects.toThrow(rejection)
  expect(beforeSpawn).not.toHaveBeenCalled()
  expect(beforeInput).not.toHaveBeenCalled()
  expect(existsSync(marker)).toBe(false)
})

test('restricted verification input and spawn options reject native execution, including undefined host fields', async () => {
  const f = fixture()
  const spec = {
    kind: 'specialist_verification' as const,
    agentId: f.spec.agent.agent.id,
    message: 'restricted',
    turnId: 'restricted-turn',
    runtime: f.spec.runtime,
    verification: { requestId: 'request', attemptId: 'attempt' },
  }
  expect(() =>
    parseWorkerInput({
      ...spec,
      scratch: f.input.scratch,
      apiKeyRefreshEnabled: true,
      nativeExecution: metadata(),
    }),
  ).toThrow('nativeExecution')
  const run = async () => {
    for await (const _frame of spawnVerificationWorker(spec, {
      apiKeyRefreshHost: {
        async refresh() {
          return 'unused'
        },
      },
      verificationHost: {
        async read() {
          throw new Error('unused')
        },
        async run() {
          throw new Error('unused')
        },
      },
      nativeExecutionHost: undefined,
    })) {
      /* no process */
    }
  }
  await expect(run()).rejects.toThrow(
    process.platform === 'darwin'
      ? MAC_PROTECTED_EXECUTION_UNAVAILABLE
      : 'rejects nativeExecutionHost',
  )
})

test.each([
  'inactive',
  'restored',
  'substituted',
] as const)('fresh native lease admission rejects %s canonical rows without affecting cleanup semantics', (state) => {
  const env = makeTestEnv()
  cleanups.push(env.cleanup)
  const lifecycle = workspaceLifecycle(env.db),
    root = env.paths.teamDir(env.teamId),
    lease = lifecycle.coordinator.claim(env.teamId, root, 'agent')
  lifecycle.coordinator.assertActiveLease(lease, env.teamId, root)
  if (state === 'inactive')
    env.db.raw.run("UPDATE workspace_writers SET state='recovery' WHERE id=?", [lease.writer.id])
  if (state === 'restored')
    env.db.raw.run("UPDATE workspace_writers SET recovery_mode='restored' WHERE id=?", [
      lease.writer.id,
    ])
  if (state === 'substituted')
    env.db.raw.run('UPDATE workspace_writers SET created_at=created_at+1 WHERE id=?', [
      lease.writer.id,
    ])
  expect(() => lifecycle.coordinator.assertActiveLease(lease, env.teamId, root)).toThrow(
    'admission changed',
  )
  // No process or executable creation occurred in this unit fixture.
})
