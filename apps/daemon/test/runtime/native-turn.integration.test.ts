import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CodingCommandReceipt } from '@bazilion/api-types'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { expect, test } from 'vitest'
import { openDb } from '../../src/core/db/client.ts'
import { runMigrations } from '../../src/core/db/migrate.ts'
import { createProfile, resolveAgent, spawnAgent } from '../../src/core/index.ts'
import { resolvePaths } from '../../src/core/paths.ts'
import { workspaceLifecycle } from '../../src/lib/coding-environment/lifecycle.ts'
import {
  assertBoundNativeTurnForWorker,
  assertNativeTurn,
  bindNativeTurnWorker,
  bindNativeWorkerApproval,
  consumeNativeTurnForWorker,
  prepareNativeTurn,
} from '../../src/lib/native-execution/turn.ts'
import { resolveRepositoryContext } from '../../src/lib/repository-context/index.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import {
  createBazilionSession,
  createProtectedBazilionSession,
} from '../../src/runtime/pi/session.ts'
import { dispatchWorkerRpc } from '../../src/runtime/worker/spawn.ts'

import { nativeIntegrationEnabled as enabled } from '../fixtures/native-platform.ts'

async function fixture(
  visit: (
    turn: Awaited<ReturnType<typeof prepareNativeTurn>>,
    workspace: string,
    context: { db: ReturnType<typeof openDb>; paths: ReturnType<typeof resolvePaths> },
  ) => Promise<void>,
  cwd = '.',
  worker?: { agentId: string; turnId?: string },
  secrets?: () => readonly string[],
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-turn-'))),
    paths = resolvePaths(root),
    workspace = paths.teamDir('one'),
    privateRoot = join(root, 'turn')
  for (const directory of [paths.profilesDir, paths.agentsDir, paths.skillsDir, paths.logsDir])
    mkdirSync(directory, { recursive: true })
  mkdirSync(workspace, { recursive: true })
  mkdirSync(join(workspace, 'memory'))
  mkdirSync(join(workspace, 'application'))
  mkdirSync(privateRoot, { mode: 0o700 })
  const db = openDb(join(root, 'state.sqlite'))
  runMigrations(db)
  db.raw.run('INSERT INTO teams(id,name,created_at) VALUES(?,?,?)', ['one', 'one', 1])
  const lifecycle = workspaceLifecycle(db),
    lease = lifecycle.coordinator.claim('one', workspace, 'agent')
  try {
    const turn = await prepareNativeTurn({
      root: privateRoot,
      lifecycle,
      lease,
      cwd,
      worker,
      secrets,
      env: {},
      readOnlyDirectories: [],
      readOnlyFiles: [],
      unavailable: [],
      assertActive() {
        lifecycle.coordinator.assertLease(lease, 'one', workspace)
      },
    })
    await visit(turn, workspace, { db, paths })
    expect(await turn.close()).toBe(true)
    expect(await turn.close()).toBe(true)
    await lifecycle.release(lease)
    db.close()
    rmSync(root, { recursive: true })
  } catch (cause) {
    throw new Error(`Native turn admission failed; retained ${root}`, { cause })
  }
}
test.skipIf(!enabled)(
  'real native deny proof admits one frozen turn and serializes concurrent tool paths',
  async () => {
    await fixture(async (turn, workspace) => {
      assertNativeTurn(turn)
      expect(() => assertNativeTurn({ ...turn })).toThrow('refused')
      const first = turn.exec(
        {
          toolCallId: 'one',
          command: 'printf first > ordered; sleep 0.1',
          cwd: '.',
          timeoutMs: 5000,
        },
        () => {},
      )
      const second = turn.exec(
        { toolCallId: 'two', command: 'printf second >> ordered', cwd: '.', timeoutMs: 5000 },
        () => {},
      )
      expect((await first).code).toBe(0)
      expect((await second).code).toBe(0)
      expect(readFileSync(join(workspace, 'ordered'), 'utf8')).toBe('firstsecond')
      expect(() =>
        turn.exec(
          { toolCallId: 'one', command: 'printf replay >> ordered', cwd: '.', timeoutMs: 5000 },
          () => {},
        ),
      ).toThrow('refused')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'correlated turn cancellation refuses a queued effect without creating another scope',
  async () => {
    await fixture(async (turn, workspace) => {
      const first = turn.exec(
        { toolCallId: 'first', command: 'sleep 0.1', cwd: '.', timeoutMs: 5000 },
        () => {},
      )
      const queued = turn.exec(
        { toolCallId: 'queued', command: 'touch forbidden', cwd: '.', timeoutMs: 5000 },
        () => {},
      )
      const rejected = expect(queued).rejects.toMatchObject({
        code: 'cancelled',
        cleanupConfirmed: true,
      })
      expect(turn.cancel('queued')).toBe(true)
      expect((await first).code).toBe(0)
      await rejected
      expect(turn.cancel('queued')).toBe(false)
      expect(existsSync(join(workspace, 'forbidden'))).toBe(false)
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'prepared-turn RPC dispatch executes a real native scope and redacts before encoding',
  async () => {
    await fixture(async (turn) => {
      const parts: string[] = []
      const reply = await dispatchWorkerRpc(
        {
          type: 'rpc',
          id: randomUUID(),
          method: 'nativeExecute',
          args: {
            toolCallId: 'rpc',
            command: 'printf native-; printf output',
            cwd: '.',
            timeoutMs: 5000,
          },
        },
        { nativeExecutionHost: turn, nativeExecutionSecrets: () => ['native-output'] },
        {
          assertActive() {},
          secrets: () => ['native-output'],
          async send(part) {
            parts.push(Buffer.from(part.data, 'base64').toString())
          },
        },
      )
      expect(reply).toMatchObject({ ok: true, result: { code: 0 } })
      expect(parts.join('')).toBe('[REDACTED]')
    })
  },
  20_000,
)
test.skipIf(!enabled)(
  'native worker RPC cannot create a second approval channel or choose its Actor/mode',
  async () => {
    await fixture(async (turn, _workspace, { db }) => {
      let began = 0
      const reply = await dispatchWorkerRpc(
        {
          type: 'rpc',
          id: randomUUID(),
          method: 'bashApproval',
          args: {
            id: randomUUID(),
            agentId: 'forged-agent',
            teamId: 'forged-team',
            turnId: 'forged-turn',
            toolCallId: 'forged',
            command: 'rm -rf /outside',
            risks: [],
            mode: 'interactive',
          },
        },
        {
          nativeExecutionHost: turn,
          bashApprovalHost: {
            begin() {
              began++
              throw new Error('must not open a worker-chosen approval')
            },
          },
        },
      )
      expect(reply).toMatchObject({ ok: false, error: 'Native approval is daemon-owned' })
      expect(began).toBe(0)
      expect(db.raw.query('SELECT id FROM workspace_resources').all()).toHaveLength(1)
    })
  },
  20_000,
)

test.skipIf(!enabled).each(['configured', 'protected'] as const)(
  'real native %s Pi session routes bash/coding_command through the same live turn',
  async (kind) => {
    await fixture(async (turn, workspace, { db, paths }) => {
      createProfile(db, paths, { id: 'native-sdk', defaultModel: 'openai-codex:gpt-5.6-sol' })
      const agent = resolveAgent(
        db,
        paths,
        spawnAgent(db, paths, { profileId: 'native-sdk', teamId: 'one' }).id,
      )
      const sessionId = randomUUID(),
        sessionDir = join(agent.agent.dir, 'sessions')
      writeFileSync(
        join(sessionDir, `${sessionId}.jsonl`),
        `${JSON.stringify(SessionManager.inMemory(workspace, { id: sessionId }).getHeader())}\n`,
        { flag: 'wx' },
      )
      writeFileSync(join(workspace, 'memory', 'canary'), 'read-only-sentinel', { flag: 'wx' })
      const repositoryContext = await resolveRepositoryContext({ teamId: 'one', root: workspace })
      const repositoryContextHost = (target: string) =>
        resolveRepositoryContext({ teamId: 'one', root: workspace, target })
      const memory: MemoryBackend = {
        async init() {},
        async read() {
          throw new Error('unused')
        },
        async write() {
          throw new Error('unused')
        },
        async list() {
          return []
        },
        async search() {
          return []
        },
        async remove() {},
      }
      // Receipt lifecycle is a synthetic SDK fixture here; actual commands, deny effects and
      // canonical native writer/resource settlement are real. This is not installed API/evidence
      // or live-provider acceptance, and no synthetic receipt is persisted.
      const codingHost = {
        async invoke(value: import('../../src/runtime/pi/coding-contract.ts').CodingRequest) {
          if (value.action === 'start')
            return { id: 'sdk-fixture-only', startedAt: Date.now() } as CodingCommandReceipt
          if (value.action === 'finish')
            return { id: value.id, ...value.outcome } as CodingCommandReceipt
          throw new Error('unused synthetic receipt action')
        },
      }
      const common = {
        agent,
        memory,
        repositoryContext,
        repositoryContextHost,
        codingHost,
        nativeExecution: { cwd: turn.cwd, host: turn },
        conversation: { id: sessionId, filename: `${sessionId}.jsonl` },
      }
      const token = 'synthetic-provider-token-never-sent'
      const handle =
        kind === 'configured'
          ? await createBazilionSession({
              ...common,
              paths,
              env: {},
              apiKey: token,
              enabledProviders: new Set(['openai-codex']),
            })
          : await createProtectedBazilionSession({
              ...common,
              runtime: {
                providerName: 'openai-codex',
                modelId: 'gpt-5.6-sol',
                reasoningLevel: agent.reasoningLevel,
                apiKey: token,
              },
              paths: {
                agentDir: agent.agent.dir,
                teamDir: workspace,
                memoryDir: join(workspace, 'memory'),
                sessionDir,
                skills: [],
                homeDocuments: {
                  'AGENTS.md': 'Scoped private Agent instructions',
                  'SOUL.md': null,
                  'TOOLS.md': null,
                  'IDENTITY.md': null,
                  'BOOTSTRAP.md': null,
                },
              },
              scratch: (
                await import('../../src/runtime/worker/runtime.ts')
              ).createMinimalWorkerScratch(paths.home),
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
              bashApprovalHost: { requestApproval: async () => 'denied' },
              fileSink: async () => ({ resultId: 'unused' }),
              refreshApiKey: async () => token,
            })
      let rounds = 0
      const memoryCanary = `'${join(workspace, 'memory', 'canary').replaceAll("'", "'\\''")}'`
      try {
        handle.session.agent.streamFunction = (model) => {
          const stream = createAssistantMessageEventStream(),
            tools = rounds++ === 0
          queueMicrotask(() =>
            stream.push({
              type: 'done',
              reason: tools ? 'toolUse' : 'stop',
              message: {
                role: 'assistant',
                api: model.api,
                provider: model.provider,
                model: model.id,
                content: tools
                  ? [
                      {
                        type: 'toolCall',
                        id: 'real-native-sdk-bash',
                        name: 'bash',
                        arguments: {
                          command: `printf native-bash > bash-marker; if printf forbidden > ${memoryCanary} 2>/dev/null; then exit 91; fi`,
                          timeout: 5,
                        },
                      },
                      {
                        type: 'toolCall',
                        id: 'real-native-sdk-coding',
                        name: 'coding_command',
                        arguments: {
                          command: 'printf native-coding > coding-marker',
                          cwd: '.',
                          purpose: 'test',
                          timeoutSeconds: 5,
                        },
                      },
                    ]
                  : [{ type: 'text', text: 'finished synthetic provider turn' }],
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                stopReason: tools ? 'toolUse' : 'stop',
                timestamp: Date.now(),
              },
            }),
          )
          return stream
        }
        await handle.session.prompt(
          'Exercise actual native SDK coding scopes with synthetic provider transport.',
        )
        expect(rounds).toBe(2)
        expect(readFileSync(join(workspace, 'application', 'bash-marker'), 'utf8')).toBe(
          'native-bash',
        )
        expect(readFileSync(join(workspace, 'coding-marker'), 'utf8')).toBe('native-coding')
        expect(readFileSync(join(workspace, 'memory', 'canary'), 'utf8')).toBe('read-only-sentinel')
        expect(
          handle.session
            .getCallableToolNames()
            .filter((name) => ['read', 'write', 'edit', 'grep', 'find', 'ls'].includes(name)),
        ).toEqual([])
        expect(
          db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        ).toEqual([])
      } finally {
        handle.dispose()
      }
    }, 'application')
  },
  20_000,
)

test.skipIf(!enabled)(
  'live native worker binding is actor/turn/root/facts-bound, one-use and revoked by inactive canonical ownership',
  async () => {
    await fixture(
      async (turn, workspace, { db }) => {
        const binding = {
          agentId: 'bound-agent',
          turnId: 'bound-turn',
          teamId: 'one',
          registeredRoot: workspace,
          admission: { cwd: turn.cwd, facts: turn.facts },
        }
        expect(() => consumeNativeTurnForWorker({ ...turn }, binding)).toThrow('refused')
        for (const wrong of [
          { ...binding, agentId: 'another' },
          { ...binding, turnId: 'another' },
          { ...binding, teamId: 'another' },
          { ...binding, admission: { ...binding.admission, cwd: 'application' } },
          {
            ...binding,
            admission: {
              ...binding.admission,
              facts: {
                ...turn.facts,
                fingerprint:
                  turn.facts.fingerprint === '0'.repeat(64) ? '1'.repeat(64) : '0'.repeat(64),
              },
            },
          },
        ])
          expect(() => consumeNativeTurnForWorker(turn, wrong)).toThrow()
        expect(() => assertBoundNativeTurnForWorker(turn, binding)).toThrow('refused')
        const approval = { requestApproval: async () => 'denied' as const }
        expect(() => bindNativeWorkerApproval(turn, binding, approval)).toThrow('refused')
        consumeNativeTurnForWorker(turn, binding)
        assertBoundNativeTurnForWorker(turn, binding)
        expect(() => bindNativeWorkerApproval({ ...turn }, binding, approval)).toThrow('refused')
        bindNativeWorkerApproval(turn, binding, approval)
        expect(() => bindNativeWorkerApproval(turn, binding, approval)).toThrow('refused')
        expect(() => consumeNativeTurnForWorker(turn, binding)).toThrow('refused')
        db.raw.run("UPDATE workspace_writers SET state='recovery'")
        expect(() => assertBoundNativeTurnForWorker(turn, binding)).toThrow('admission changed')
        // The only command was the already-settled readiness canary. Revocation never starts code;
        // normal native closure can retire its frozen template without signalling receipt PIDs.
        expect(await turn.close()).toBe(true)
      },
      '.',
      { agentId: 'bound-agent', turnId: 'bound-turn' },
    )
  },
  20_000,
)

test.skipIf(!enabled)(
  'inbox-style native readiness fixes its turn only after claims, before a one-use worker handoff',
  async () => {
    await fixture(
      async (turn, workspace, { db }) => {
        const request = {
          toolCallId: 'post-claim',
          command: 'printf native-handoff > handoff-marker',
          cwd: '.',
          timeoutMs: 5000,
        }
        const binding = {
          agentId: 'inbox-agent',
          turnId: 'claimed-message-attempt',
          teamId: 'one',
          registeredRoot: workspace,
          admission: { cwd: turn.cwd, facts: turn.facts },
        }
        expect(() => turn.exec(request, () => {})).toThrow('refused')
        expect(() => consumeNativeTurnForWorker(turn, binding)).toThrow('refused')
        expect(() =>
          bindNativeTurnWorker({ ...turn }, { agentId: binding.agentId, turnId: binding.turnId }),
        ).toThrow('refused')
        expect(() =>
          bindNativeTurnWorker(turn, { agentId: 'another-agent', turnId: binding.turnId }),
        ).toThrow('refused')
        bindNativeTurnWorker(turn, { agentId: binding.agentId, turnId: binding.turnId })
        expect(() =>
          bindNativeTurnWorker(turn, { agentId: binding.agentId, turnId: binding.turnId }),
        ).toThrow('refused')
        expect(() => turn.exec(request, () => {})).toThrow('refused')
        expect(existsSync(join(workspace, 'handoff-marker'))).toBe(false)
        expect(db.raw.query('SELECT id FROM workspace_resources').all()).toHaveLength(1)
        consumeNativeTurnForWorker(turn, binding)
        expect((await turn.exec(request, () => {})).code).toBe(0)
        expect(readFileSync(join(workspace, 'handoff-marker'), 'utf8')).toBe('native-handoff')
        expect(
          db.raw.query('SELECT id FROM workspace_resources WHERE cleanup_confirmed=0').all(),
        ).toEqual([])
      },
      '.',
      { agentId: 'inbox-agent' },
    )
  },
  20_000,
)

test.skipIf(!enabled)(
  'a credential learned after native readiness refuses command input before creating another job',
  async () => {
    const secrets: string[] = []
    await fixture(
      async (turn, workspace, { db }) => {
        secrets.push('live-private-native-value')
        await expect(
          turn.exec(
            {
              toolCallId: 'refuse-secret',
              command: 'printf live-private-native-value > forbidden',
              cwd: '.',
              timeoutMs: 5000,
            },
            () => {},
          ),
        ).rejects.toMatchObject({ code: 'unavailable', cleanupConfirmed: true })
        expect(existsSync(join(workspace, 'forbidden'))).toBe(false)
        expect(db.raw.query('SELECT id FROM workspace_resources').all()).toHaveLength(1)
      },
      '.',
      undefined,
      () => secrets,
    )
  },
  20_000,
)

test.skipIf(!enabled)(
  'private Unix readiness works beneath long TMPDIR paths without widening the admitted IPC root',
  async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'native-long-ipc-')))
    const long = join(root, 'x'.repeat(100))
    mkdirSync(long, { mode: 0o700 })
    const previous = process.env.TMPDIR
    let settled = false
    try {
      process.env.TMPDIR = long
      await fixture(async (turn) => {
        expect(
          (
            await turn.exec(
              { toolCallId: 'long-path', command: 'printf private-ipc', cwd: '.', timeoutMs: 5000 },
              () => {},
            )
          ).code,
        ).toBe(0)
      })
      settled = true
    } finally {
      if (previous === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = previous
      if (settled) rmSync(root, { recursive: true })
    }
  },
  20_000,
)

test.skipIf(!enabled)(
  'closed turn admission refuses future effects rather than adopting a new native runtime',
  async () => {
    await fixture(async (turn) => {
      expect(await turn.close()).toBe(true)
      expect(() => assertNativeTurn(turn)).toThrow('refused')
      expect(() =>
        turn.exec(
          { toolCallId: 'late', command: 'printf late', cwd: '.', timeoutMs: 5000 },
          () => {},
        ),
      ).toThrow('refused')
    })
  },
  20_000,
)
