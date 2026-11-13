import { spawn } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createWebSearchHost } from '../../src/lib/web-search.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import { createBazilionCustomTools } from '../../src/runtime/pi/tools.ts'
import type { DockerTurn } from '../../src/runtime/shell/tooling.ts'
import type {
  ApiKeyRefreshHost,
  MessagingHost,
  UserMdHost,
} from '../../src/runtime/worker/ipc-protocol.ts'
import {
  type AgentTurnWorkerSpec,
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
  ExactValueStreamRedactor,
  minimalWorkerProcessEnv,
  parseWorkerInput,
  type RestrictedReviewWorkerSpec,
} from '../../src/runtime/worker/runtime.ts'
import {
  formatWorkerExitFailure,
  type ReviewSpawnOptions,
  spawnReviewWorker,
  spawnWorkerTurn,
} from '../../src/runtime/worker/spawn.ts'
import { seedConversationTarget } from '../fixtures/conversation.ts'

const cleanup: string[] = []
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

// These executable fixtures spawn real workers; their process-group and Docker assertions are
// Linux-only.
const linuxSpawnTest = test.skipIf(process.platform !== 'linux')
describe('minimal worker runtime', () => {
  test('a real worker turn searches through the daemon host, reads the source and completes offline', async () => {
    const { spec: prepared } = turnFixture(tempRoot())
    prepared.agent.model = 'openai:gpt-6.1-sol'
    prepared.agent.reasoningLevel = 'medium'
    const marker = join(prepared.agent.team.path, 'unadmitted-mcp-started')
    const mcpConfig = JSON.stringify({
      mcpServers: {
        trap: {
          command: process.execPath,
          args: [
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'UNADMITTED_MCP')`,
          ],
        },
      },
    })
    for (const directory of [
      join(prepared.agent.team.path, '.pi'),
      join(prepared.agent.agent.dir, '..', '..', 'pi'),
    ]) {
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, 'mcp.json'), mcpConfig)
    }
    const answer = {
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [
        {
          type: 'output_text',
          text: 'NASA source discovered.',
          annotations: [
            { type: 'url_citation', title: 'NASA', url: 'https://www.nasa.gov/old-artemis-ii' },
          ],
        },
      ],
    }
    const provider = vi.fn(
      async () =>
        new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { output: [answer] } })}\n\n`,
        ),
    )
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 25000)
    const host = createWebSearchHost({
      backend: 'openai',
      env: () => ({ OPENAI_API_KEY: 'fixture-search-key' }),
      model: prepared.agent.model,
      codexToken: async () => {
        throw new Error('unadmitted')
      },
      signal: controller.signal,
      fetch: provider,
    })
    const frames = []
    try {
      for await (const frame of spawnWorkerTurn(
        {
          kind: 'agent_turn',
          agent: prepared.agent,
          repositoryInstructions: prepared.repositoryInstructions,
          conversation: prepared.conversation,
          message: 'Research NASA Artemis II with official sources.',
          turnId: 'real-loop',
          bashApprovalMode: 'auto_deny',
        },
        {
          signal: controller.signal,
          env: {
            BAZILION_HOME: join(prepared.agent.agent.dir, '..', '..'),
            OPENAI_API_KEY: 'fixture-search-key',
            NODE_OPTIONS: `--import=${new URL('../fixtures/worker-search-preload.mjs', import.meta.url).href}`,
          },
          webSearchHost: host,
        },
      ))
        frames.push(frame)
    } finally {
      clearTimeout(timeout)
    }
    const serialized = JSON.stringify(frames)
    expect(
      frames.filter((f) => f.kind === 'done'),
      serialized,
    ).toHaveLength(1)
    expect(frames.filter((f) => f.kind === 'fatal')).toHaveLength(0)
    expect(serialized).toContain('NASA source discovered.')
    expect(serialized).toContain('[final URL: https://www.nasa.gov/mission/artemis-ii/]')
    expect(serialized).toContain('Source actually read')
    expect(existsSync(marker)).toBe(false)
    expect(serialized).not.toContain('fixture-search-key')
    const transcript = readFileSync(
      join(prepared.agent.agent.dir, 'sessions', `${prepared.conversation.id}.jsonl`),
      'utf8',
    )
    expect(transcript).toContain('NASA source discovered.')
    expect(transcript).toContain('OFFLINE NASA FIXTURE')
    expect(transcript).not.toContain('fixture-search-key')
    expect(provider).toHaveBeenCalledTimes(1)
  }, 35000)

  linuxSpawnTest(
    'an exited worker ends its process group and stops reading pipes a detached process holds',
    async () => {
      const { spec } = turnFixture(tempRoot())
      const pidFile = (name: string) => join(spec.agent.team.path, `fixture-${name}-pid`)
      let holder: number | undefined
      try {
        const frames = []
        const started = Date.now()
        for await (const frame of spawnWorkerTurn(spec, {
          env: {},
          workerEntryPath: fileURLToPath(
            new URL('../fixtures/worker-output-holder-entry.ts', import.meta.url),
          ),
        }))
          frames.push(frame)
        expect(frames.map((frame) => frame.kind)).toEqual(['done'])
        expect(Date.now() - started).toBeLessThan(10_000)
        holder = Number(readFileSync(pidFile('descendant'), 'utf8'))
        const sibling = Number(readFileSync(pidFile('group-child'), 'utf8'))
        await vi.waitFor(() => expect(() => process.kill(sibling, 0)).toThrow(), {
          timeout: 5000,
        })
        // A process that left the worker's group is not ours to stop; it only lost its reader.
        expect(() => process.kill(holder as number, 0)).not.toThrow()
      } finally {
        if (holder) {
          try {
            process.kill(-holder, 'SIGKILL')
          } catch {}
        }
      }
    },
  )
  linuxSpawnTest('no signal reaches the worker group after the worker has exited', async () => {
    const { spec } = turnFixture(tempRoot())
    const kill = vi.spyOn(process, 'kill')
    const groupSignals = () => kill.mock.calls.filter(([pid]) => Number(pid) < 0).length
    let holder: number | undefined
    try {
      for await (const _frame of spawnWorkerTurn(spec, {
        env: {},
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/worker-output-holder-entry.ts', import.meta.url),
        ),
      })) {
      }
      holder = Number(readFileSync(join(spec.agent.team.path, 'fixture-descendant-pid'), 'utf8'))
      // Its leftovers were signalled as it exited. Later, its emptied group id could be reused.
      const atEnd = groupSignals()
      expect(atEnd).toBeGreaterThan(0)
      await new Promise((resolve) => setTimeout(resolve, 1_000))
      expect(groupSignals()).toBe(atEnd)
    } finally {
      kill.mockRestore()
      if (holder) {
        try {
          process.kill(-holder, 'SIGKILL')
        } catch {}
      }
    }
  })

  linuxSpawnTest(
    'the real worker exits when its IPC channel disconnects',
    async () => {
      const entry = fileURLToPath(new URL('../../src/runtime/worker/entry.ts', import.meta.url))
      const child = spawn(
        process.execPath,
        ['--experimental-strip-types', '--no-warnings', entry],
        {
          env: { PATH: process.env.PATH },
          stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        },
      )
      let stdout = ''
      child.stdout?.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      const exited = new Promise<number | null>((resolve) => child.once('exit', resolve))
      try {
        // Its input never arrives (stdin stays open): only the disconnect can end the worker.
        child.disconnect()
        expect(await exited).toBe(0)
        expect(stdout.trim()).toBe(
          JSON.stringify({ kind: 'event', event: { type: 'error', error: 'cancelled' } }),
        )
      } finally {
        child.kill('SIGKILL')
      }
    },
    30_000,
  )

  test('constructs an exact POSIX environment with no ambient startup or credential values', () => {
    const scratch = createMinimalWorkerScratch()
    try {
      const env = minimalWorkerProcessEnv(scratch)
      expect(env).toEqual({
        HOME: scratch.homeDir,
        TMPDIR: scratch.tempDir,
        TMP: scratch.tempDir,
        TEMP: scratch.tempDir,
        LANG: 'C',
        LC_ALL: 'C',
      })
    } finally {
      cleanupMinimalWorkerScratch(scratch)
    }
    expect(existsSync(scratch.root)).toBe(false)
  })

  test('redacts initial and rotated values across arbitrary chunk boundaries', () => {
    const redactor = new ExactValueStreamRedactor(['initial-access-token'])
    let output = redactor.push('before initial-ac')
    output += redactor.push('cess-token after ')
    redactor.add('rotated-access-token')
    output += redactor.push('rotated-ac')
    output += redactor.push('cess-token done')
    output += redactor.flush()
    expect(output).toBe('before [REDACTED] after [REDACTED] done')
  })

  test('the worker checks only that its input is a kind it knows', () => {
    const { spec } = turnFixture(tempRoot())
    const input = { ...spec, hosts: [] }
    expect(parseWorkerInput(input)).toBe(input)
    expect(() => parseWorkerInput({ ...input, kind: 'packet_review' })).toThrow(/unknown/)
    expect(() => parseWorkerInput(null)).toThrow(/unknown/)
  })

  test('the custom-tool set grows only with the hosts the daemon supplies', () => {
    const root = tempRoot()
    const { spec } = turnFixture(root)
    const hosts = scopedHosts()
    const memory: MemoryBackend = {
      init: async () => {},
      read: async () => {
        throw new Error('unused')
      },
      write: async () => {
        throw new Error('unused')
      },
      search: async () => [],
      list: async () => [],
      remove: async () => {},
    }
    const base = {
      agent: spec.agent,
      memory,
      messagingHost: hosts.messagingHost,
      userMdHost: hosts.userMdHost,
      fileSink: async () => ({ resultId: 'fixture-result' }),
      env: {},
    }
    const names = createBazilionCustomTools(base).map((tool) => tool.name)

    expect(names).toContain('web_fetch')
    expect(names).toContain('deliver_file')
    // Discovery is daemon-owned: absent without the host, present only with it.
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('propose_lesson')
    expect(names).not.toContain('ask_user')
    expect(names).not.toContain('image_generate')
    const withImages = createBazilionCustomTools({
      ...base,
      imageGenerationHost: { generate: vi.fn() },
    }).map((tool) => tool.name)
    expect(withImages).toContain('image_generate')
    expect(withImages.filter((name) => name !== 'image_generate')).toEqual(names)
    const withQuestion = createBazilionCustomTools({
      ...base,
      askUser: async (question) => ({
        questionId: 'fixture-question',
        question,
        kind: 'no_answer',
        reason: 'skipped',
      }),
    }).map((tool) => tool.name)
    expect(withQuestion).toContain('ask_user')
    expect(withQuestion.filter((name) => name !== 'ask_user')).toEqual(names)
    expect(names.some((name) => name.startsWith('browser_'))).toBe(false)
    expect(names.some((name) => name.startsWith('mcp_'))).toBe(false)
  })

  test('refuses a worker input that cannot be serialized before spawn', async () => {
    const root = tempRoot()
    const { spec } = turnFixture(root)
    ;(spec.agent.profile as typeof spec.agent.profile & { cycle?: unknown }).cycle =
      spec.agent.profile
    const iterator = spawnWorkerTurn(spec, {
      env: {},
      workerEntryPath: join(root, 'must-not-spawn.ts'),
    })
    await expect(iterator.next()).rejects.toThrow(/circular/i)
  })

  describe('review worker', () => {
    let scratchParent: string
    let priorTmpdir: string | undefined
    beforeEach(() => {
      scratchParent = tempRoot()
      priorTmpdir = process.env.TMPDIR
      // Review scratch trees are created here, so each test can see them removed.
      process.env.TMPDIR = scratchParent
    })
    afterEach(() => {
      if (priorTmpdir === undefined) delete process.env.TMPDIR
      else process.env.TMPDIR = priorTmpdir
    })

    linuxSpawnTest(
      'gets only the refresh host and an exact minimal env, and its output is redacted',
      async () => {
        const initial = 'initial-worker-secret'
        const rotated = 'rotated-worker-secret'
        const diagnostics: string[] = []
        const refresh: ApiKeyRefreshHost = { refresh: vi.fn(async () => rotated) }
        // A review is served only the refresh host, whatever else a caller hands it.
        const browserHost = { invoke: vi.fn(async () => []) }
        const imageGenerationHost = { generate: vi.fn() }
        const ambientSecrets = {
          TELEGRAM_BOT_TOKEN: 'telegram-secret-sentinel',
          BAZILION_TOKEN: 'bootstrap-secret-sentinel',
          OPENAI_CODEX_OAUTH: 'oauth-refresh-secret-sentinel',
          ANTHROPIC_API_KEY: 'unrelated-provider-secret-sentinel',
          FIRECRAWL_API_KEY: 'unrelated-tool-secret-sentinel',
        }
        const priorEnvironment = Object.fromEntries(
          Object.keys(ambientSecrets).map((key) => [key, process.env[key]]),
        )
        Object.assign(process.env, ambientSecrets)
        let proposals: Awaited<ReturnType<typeof spawnReviewWorker>> = []
        try {
          proposals = await spawnReviewWorker(reviewSpec(initial), {
            apiKeyRefreshHost: refresh,
            browserHost,
            imageGenerationHost,
            diagnosticSink: (message) => diagnostics.push(message),
            workerEntryPath: minimalWorkerEntry,
          } as ReviewSpawnOptions)
        } finally {
          for (const [key, value] of Object.entries(priorEnvironment)) {
            if (value === undefined) delete process.env[key]
            else process.env[key] = value
          }
        }

        expect(refresh.refresh).toHaveBeenCalledOnce()
        expect(browserHost.invoke).not.toHaveBeenCalled()
        expect(imageGenerationHost.generate).not.toHaveBeenCalled()
        expect(readdirSync(scratchParent)).toEqual([])
        const serialized = JSON.stringify(proposals)
        expect(serialized).not.toContain(initial)
        expect(serialized).not.toContain(rotated)
        expect(serialized).toContain('[REDACTED]')
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]?.length).toBeLessThanOrEqual(16 * 1024)
        expect(diagnostics[0]).not.toContain(initial)
        expect(diagnostics[0]).not.toContain(rotated)
        expect(diagnostics[0]).toContain('initial=[REDACTED]')
        expect(diagnostics[0]).toContain('rotated=[REDACTED]')

        const content = proposals[0]?.text
        if (!content) throw new Error('fixture did not emit inspection content')
        const inspected = JSON.parse(content) as {
          hosts: string[]
          environment: Record<string, string>
          argv: string[]
          scratchRoot: string
          stdinEnded: boolean
          stdioAreRegularFiles: boolean[]
          ipcConnected: boolean
          forbiddenInputOccurrences: Record<string, number>
        }
        expect(inspected.hosts).toEqual(['apiKeyRefreshHost'])
        expect(Object.keys(inspected.environment).sort()).toEqual(
          ['HOME', 'LANG', 'LC_ALL', 'TEMP', 'TMP', 'TMPDIR'].sort(),
        )
        expect(inspected.environment.PATH).toBeUndefined()
        expect(inspected.environment.NODE_OPTIONS).toBeUndefined()
        expect(inspected.environment.BAZILION_HOME).toBeUndefined()
        expect(inspected.environment.DOCKER_HOST).toBeUndefined()
        expect(inspected.stdinEnded).toBe(true)
        expect(inspected.stdioAreRegularFiles).toEqual([false, false, false])
        expect(inspected.ipcConnected).toBe(true)
        expect(inspected.forbiddenInputOccurrences).toEqual({
          'telegram-secret-sentinel': 0,
          'bootstrap-secret-sentinel': 0,
          'oauth-refresh-secret-sentinel': 0,
          'unrelated-provider-secret-sentinel': 0,
          'unrelated-tool-secret-sentinel': 0,
        })
        expect(inspected.argv.join(' ')).not.toContain(initial)
        expect(inspected.argv.join(' ')).not.toContain(rotated)
        expect(existsSync(inspected.scratchRoot)).toBe(false)
      },
    )

    linuxSpawnTest(
      'terminates a live child before cleaning scratch when a consumer stops early',
      async () => {
        // The fixture emits its result and then hangs; the reviewer returns on the result.
        const proposals = await spawnReviewWorker(
          { ...reviewSpec(), message: 'hang-after-frame' },
          {
            apiKeyRefreshHost: { refresh: async () => 'rotated' },
            workerEntryPath: minimalWorkerEntry,
          },
        )
        expect(proposals).toHaveLength(1)
        expect(readdirSync(scratchParent)).toEqual([])
      },
    )

    linuxSpawnTest('bounds an unterminated stdout frame and fails closed', async () => {
      await expect(
        spawnReviewWorker(
          { ...reviewSpec(), message: 'oversized-frame' },
          {
            apiKeyRefreshHost: { refresh: async () => 'rotated' },
            workerEntryPath: minimalWorkerEntry,
          },
        ),
      ).rejects.toThrow('worker frame exceeded the maximum size')
      expect(readdirSync(scratchParent)).toEqual([])
    })

    linuxSpawnTest(
      'turns a native module ABI mismatch into an actionable fatal frame',
      async () => {
        const diagnostics: string[] = []
        const failure = await spawnReviewWorker(
          { ...reviewSpec(), message: 'native-abi-mismatch' },
          {
            apiKeyRefreshHost: { refresh: async () => 'rotated' },
            diagnosticSink: (message) => diagnostics.push(message),
            workerEntryPath: minimalWorkerEntry,
          },
        ).then(
          () => undefined,
          (error: unknown) => error,
        )

        expect((failure as Error).message).toMatch(
          /built for Node module ABI 141.*requires ABI 147.*pnpm rebuild better-sqlite3/s,
        )
        expect((failure as Error).message).not.toContain('/private/checkout')
        expect(diagnostics).toHaveLength(1)
        expect(diagnostics[0]).toContain('/private/checkout/node_modules/better_sqlite3.node')
        expect(readdirSync(scratchParent)).toEqual([])
      },
    )

    linuxSpawnTest(
      'normalizes a native ABI mismatch already emitted as a worker frame',
      async () => {
        const failure = await spawnReviewWorker(
          { ...reviewSpec(), message: 'native-abi-frame' },
          {
            apiKeyRefreshHost: { refresh: async () => 'rotated' },
            workerEntryPath: minimalWorkerEntry,
          },
        ).then(
          () => undefined,
          (error: unknown) => error,
        )

        expect((failure as Error).message).toMatch(
          /built for Node module ABI 141.*requires ABI 147.*pnpm rebuild better-sqlite3/s,
        )
        expect((failure as Error).message).not.toContain('/private/checkout')
        expect(readdirSync(scratchParent)).toEqual([])
      },
    )
  })

  test('uses generic rebuild guidance for a different native addon', () => {
    const error = formatWorkerExitFailure(
      'worker exited with code 1',
      "The module '/private/checkout/tree_sitter.node' was compiled against a different " +
        'Node.js version using NODE_MODULE_VERSION 141. This version of Node.js requires ' +
        'NODE_MODULE_VERSION 147.',
    )

    expect(error).toContain('run `pnpm rebuild`')
    expect(error).not.toContain('pnpm rebuild better-sqlite3')
    expect(error).not.toContain('/private/checkout')
  })
})

function tempRoot(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'bazilion-worker-runtime-test-')))
  cleanup.push(root)
  return root
}

const minimalWorkerEntry = fileURLToPath(
  new URL('../fixtures/worker-minimal-runtime-entry.ts', import.meta.url),
)

function turnFixture(root: string): {
  spec: AgentTurnWorkerSpec
  docker: DockerTurn
} {
  const agentDir = join(root, 'agents', 'agent-1')
  const teamDir = join(root, 'teams', 'team-1')
  const memoryDir = join(teamDir, 'memory')
  const sessionsDir = join(agentDir, 'sessions')
  for (const path of [agentDir, teamDir, memoryDir, sessionsDir])
    mkdirSync(path, { recursive: true })
  return {
    spec: {
      kind: 'agent_turn',
      repositoryInstructions: [],
      conversation: seedConversationTarget(sessionsDir, teamDir),
      agent: resolvedAgent(agentDir, teamDir),
      message: 'test agent turn',
      turnId: 'turn-1',
      bashApprovalMode: 'auto_deny',
    },
    docker: {
      image: 'test:image',
      cwd: '.',
      containerPrefix: `bazilion-${'1'.repeat(12)}-${'2'.repeat(12)}-`,
    },
  }
}

function reviewSpec(accessToken = 'initial-access-token'): RestrictedReviewWorkerSpec {
  return {
    kind: 'restricted_review',
    message: 'test review',
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'high',
      apiKey: accessToken,
    },
    evidence: [],
  }
}

function resolvedAgent(agentDir: string, teamDir: string): ResolvedAgent {
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: 'openai-codex:gpt-5.6-sol',
      reasoningLevel: 'high',
      reviewEnabled: true,
      reviewEveryNTurns: 8,
      reviewModel: 'openai-codex:gpt-5.6-sol',
      reviewReasoningLevel: 'low',
      reviewTurnsSinceLast: 0,
      status: 'idle',
      dir: agentDir,
      teamId: 'team-1',
      telegramTopicId: null,
      telegramMirrorMode: 'minimal',
      telegramIconEmoji: null,
      createdAt: 0,
      archivedAt: null,
    },
    profile: {
      id: 'profile-1',
      name: 'Profile One',
      dir: join(agentDir, '..', '..', 'profiles', 'profile-1'),
      defaultModel: 'openai-codex:gpt-5.6-sol',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.6-sol',
    reasoningLevel: 'high',
    team: {
      id: 'team-1',
      name: 'Team One',
      path: teamDir,
      userMd: '',
      telegramTopicNameFormat: null,
      policyMode: 'open',
      createdAt: 0,
    },
    skills: [],
    privateLessons: [],
  }
}

function scopedHosts(): {
  messagingHost: MessagingHost
  userMdHost: UserMdHost
} {
  return {
    messagingHost: {
      agentExists: () => false,
      sendMessage: () => ({ messageId: 'unused' }),
      listInbox: () => [],
      markRead: () => {},
      findReplies: () => [],
    },
    userMdHost: {
      get: () => ({ content: '', etag: 'unused' }),
      write: () => ({ etag: 'unused', totalBytes: 0 }),
    },
  }
}
