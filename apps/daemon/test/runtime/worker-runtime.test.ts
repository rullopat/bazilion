import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedAgent } from '@bazilion/api-types'
import { afterEach, describe, expect, test, vi } from 'vitest'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import { createProtectedBazilionCustomTools } from '../../src/runtime/pi/tools.ts'
import type { ProtectedDockerRuntime } from '../../src/runtime/shell/docker.ts'
import type {
  ApiKeyRefreshHost,
  BashApprovalHost,
  MessagingHost,
  UserMdHost,
} from '../../src/runtime/worker/ipc-protocol.ts'
import {
  cleanupMinimalWorkerScratch,
  createMinimalWorkerScratch,
  ExactValueStreamRedactor,
  minimalWorkerProcessEnv,
  type ProtectedWorkerSpec,
  parseWorkerInput,
} from '../../src/runtime/worker/runtime.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'

const cleanup: string[] = []
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('minimal worker runtime', () => {
  test('constructs an exact POSIX environment with no ambient startup or credential values', () => {
    const scratch = createMinimalWorkerScratch()
    try {
      const env = minimalWorkerProcessEnv(scratch, 'linux', {
        PATH: '/must/not/pass',
        NODE_OPTIONS: '--require /evil.cjs',
        BASH_ENV: '/evil.sh',
        HTTPS_PROXY: 'https://proxy.example',
        NODE_EXTRA_CA_CERTS: '/secret/ca.pem',
        BAZILION_HOME: '/secret/bazilion',
        OPENAI_API_KEY: 'secret',
        DOCKER_HOST: 'ssh://remote',
      })
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

  test('constructs the exact Windows bootstrap mechanics without ambient credentials', () => {
    const root = tempRoot()
    const scratch = createMinimalWorkerScratch(root)
    const systemRoot = join(root, 'Windows')
    const comSpec = join(systemRoot, 'System32', 'cmd.exe')
    mkdirSync(join(systemRoot, 'System32'), { recursive: true })
    writeFileSync(comSpec, '')
    try {
      const env = minimalWorkerProcessEnv(scratch, 'win32', {
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        ComSpec: comSpec,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
        Path: 'C:\\must-not-pass',
        NODE_OPTIONS: '--require C:\\evil.cjs',
        HTTPS_PROXY: 'https://proxy.example',
        OPENAI_API_KEY: 'secret',
        BAZILION_HOME: 'C:\\secret',
      })
      expect(env).toEqual({
        USERPROFILE: scratch.homeDir,
        TMPDIR: scratch.tempDir,
        TMP: scratch.tempDir,
        TEMP: scratch.tempDir,
        SystemRoot: systemRoot,
        WINDIR: systemRoot,
        ComSpec: comSpec,
        PATHEXT: '.COM;.EXE;.BAT;.CMD',
      })
    } finally {
      cleanupMinimalWorkerScratch(scratch)
    }
    expect(existsSync(scratch.root)).toBe(false)
  })

  test('redacts initial and rotated values across arbitrary chunk boundaries', () => {
    const redactor = new ExactValueStreamRedactor('initial-access-token')
    let output = redactor.push('before initial-ac')
    output += redactor.push('cess-token after ')
    redactor.add('rotated-access-token')
    output += redactor.push('rotated-ac')
    output += redactor.push('cess-token done')
    output += redactor.flush()
    expect(output).toBe('before [REDACTED] after [REDACTED] done')
  })

  test('rejects missing, extra, legacy, and malformed nested protected fields', () => {
    const root = tempRoot()
    const scratch = createMinimalWorkerScratch(root)
    const input = {
      ...protectedSpec(root),
      apiKeyRefreshEnabled: true,
      scratch,
    }
    try {
      expect(parseWorkerInput(input)).toEqual(input)
      const missing = structuredClone(input) as Record<string, unknown>
      delete missing.runtime
      expect(() => parseWorkerInput(missing)).toThrow(/missing required fields: runtime/)
      expect(() => parseWorkerInput({ ...input, enabledProviders: [] })).toThrow(
        /unexpected fields: enabledProviders/,
      )

      const wrongProviderCredential = structuredClone(input)
      wrongProviderCredential.runtime = {
        ...wrongProviderCredential.runtime,
        providerName: 'anthropic',
        credentialEnv: [{ name: 'AWS_SECRET_ACCESS_KEY', value: 'cross-provider-secret' }],
      }
      expect(() => parseWorkerInput(wrongProviderCredential)).toThrow(/unexpected credential field/)

      const badMount = structuredClone(input)
      badMount.docker.readOnlyMounts[0] = {
        ...badMount.docker.readOnlyMounts[0],
        target: '/host',
        credential: 'must-not-pass',
      } as never
      expect(() => parseWorkerInput(badMount)).toThrow(
        /unexpected fields: credential|target is not permitted/,
      )

      const badEnvironment = structuredClone(input)
      ;(badEnvironment.docker.containerEnv as unknown as Record<string, string>).AWS_PROFILE =
        'secret'
      expect(() => parseWorkerInput(badEnvironment)).toThrow(/unexpected fields: AWS_PROFILE/)

      const badDocuments = structuredClone(input)
      delete (
        badDocuments.paths.homeDocuments as Partial<ProtectedWorkerSpec['paths']['homeDocuments']>
      )['SOUL.md']
      expect(() => parseWorkerInput(badDocuments)).toThrow(/missing required fields: SOUL.md/)

      const missingMemoryMount = structuredClone(input)
      missingMemoryMount.docker.readOnlyMounts = []
      expect(() => parseWorkerInput(missingMemoryMount)).toThrow(/mount set is incomplete/)

      const traversalTarget = structuredClone(input)
      const firstMount = traversalTarget.docker.readOnlyMounts[0]
      if (!firstMount) throw new Error('fixture memory mount is missing')
      firstMount.target = '/skills/../inputs'
      expect(() => parseWorkerInput(traversalTarget)).toThrow(/target is not permitted/)

      const external = join(root, 'outside-session')
      mkdirSync(external)
      rmSync(input.paths.sessionDir, { recursive: true })
      symlinkSync(external, input.paths.sessionDir, 'dir')
      expect(() => parseWorkerInput(input)).toThrow(/session directory must be a real directory/)
    } finally {
      cleanupMinimalWorkerScratch(scratch)
    }
  })

  test('accepts a registered Team-root symlink with canonical prepared child paths', () => {
    const root = tempRoot()
    const scratch = createMinimalWorkerScratch(root)
    const spec = protectedSpec(root)
    const registeredTeamDir = spec.paths.teamDir
    const linkedTeamDir = join(root, 'linked-team')
    rmSync(registeredTeamDir, { recursive: true })
    mkdirSync(join(linkedTeamDir, 'memory'), { recursive: true })
    symlinkSync(linkedTeamDir, registeredTeamDir, 'dir')
    const canonicalTeamDir = realpathSync(linkedTeamDir)
    const canonicalMemoryDir = realpathSync(join(linkedTeamDir, 'memory'))
    spec.paths.memoryDir = canonicalMemoryDir
    spec.docker = fakeDockerRuntime(canonicalTeamDir, canonicalMemoryDir)

    try {
      const input = { ...spec, apiKeyRefreshEnabled: true, scratch }
      expect(parseWorkerInput(input)).toEqual(input)
    } finally {
      cleanupMinimalWorkerScratch(scratch)
    }
  })

  test('builds the closed protected custom-tool projection without search, browser, MCP, or review', () => {
    const root = tempRoot()
    const spec = protectedSpec(root)
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
    const names = createProtectedBazilionCustomTools({
      agent: spec.agent,
      memory,
      messagingHost: hosts.messagingHost,
      userMdHost: hosts.userMdHost,
      fileSink: () => {},
    }).map((tool) => tool.name)

    expect(names).toContain('web_fetch')
    expect(names).toContain('deliver_file')
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('propose_lesson')
    expect(names.some((name) => name.startsWith('browser_'))).toBe(false)
    expect(names.some((name) => name.startsWith('mcp_'))).toBe(false)
  })

  test('spawns with exact minimal env, closes stdin, redacts rotated diagnostics, and cleans scratch', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const initial = 'initial-worker-secret'
    const rotated = 'rotated-worker-secret'
    const diagnostics: string[] = []
    const frames = []
    const refresh: ApiKeyRefreshHost = { refresh: vi.fn(async () => rotated) }
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
    const spec = protectedSpec(root, initial)
    spec.message = `do not duplicate ${initial}`
    spec.agent.agent.name = `Agent ${initial}`
    spec.paths.homeDocuments['IDENTITY.md'] = `identity ${initial}`

    try {
      for await (const frame of spawnWorkerTurn(spec, {
        ...scopedHosts(),
        apiKeyRefreshHost: refresh,
        scratchParentDir: scratchParent,
        diagnosticSink: (message) => diagnostics.push(message),
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/worker-minimal-runtime-entry.ts', import.meta.url),
        ),
      })) {
        frames.push(frame)
      }
    } finally {
      for (const [key, value] of Object.entries(priorEnvironment)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }

    expect(refresh.refresh).toHaveBeenCalledOnce()
    expect(readdirSync(scratchParent)).toEqual([])
    const serialized = JSON.stringify(frames)
    expect(serialized).not.toContain(initial)
    expect(serialized).not.toContain(rotated)
    expect(serialized).toContain('[REDACTED]')
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]?.length).toBeLessThanOrEqual(16 * 1024)
    expect(diagnostics[0]).not.toContain(initial)
    expect(diagnostics[0]).not.toContain(rotated)
    expect(diagnostics[0]).toContain('initial=[REDACTED]')
    expect(diagnostics[0]).toContain('rotated=[REDACTED]')

    const done = frames.find((frame) => frame.kind === 'done')
    if (done?.kind !== 'done') throw new Error('fixture did not emit done')
    const content = done.messages[0]?.content
    if (!content) throw new Error('fixture did not emit inspection content')
    const inspected = JSON.parse(content) as {
      environment: Record<string, string>
      argv: string[]
      scratchRoot: string
      stdinEnded: boolean
      stdioAreRegularFiles: boolean[]
      ipcConnected: boolean
      selectedTokenInputOccurrences: number
      forbiddenInputOccurrences: Record<string, number>
    }
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
    expect(inspected.selectedTokenInputOccurrences).toBe(1)
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
  })

  test('cleans scratch when protected input validation fails before spawn', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const invalid = {
      ...protectedSpec(root),
      webFetchEnabled: false,
    } as unknown as ProtectedWorkerSpec
    const iterator = spawnWorkerTurn(invalid, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
    })
    await expect(iterator.next()).rejects.toThrow(/requires guarded web_fetch/)
    expect(readdirSync(scratchParent)).toEqual([])
  })

  test('rejects a malformed Docker executable identity before worker spawn', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const invalid = protectedSpec(root)
    invalid.docker.executableIdentity.inode = 'not-an-inode'
    const iterator = spawnWorkerTurn(invalid, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
    })

    await expect(iterator.next()).rejects.toThrow(/executable identity has invalid inode/)
    expect(readdirSync(scratchParent)).toEqual([])
  })

  test('cleans scratch when a nested worker input cannot be serialized before spawn', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const spec = protectedSpec(root)
    ;(spec.agent.profile as typeof spec.agent.profile & { cycle?: unknown }).cycle =
      spec.agent.profile
    const iterator = spawnWorkerTurn(spec, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
    })

    await expect(iterator.next()).rejects.toThrow(/circular/i)
    expect(readdirSync(scratchParent)).toEqual([])
  })

  test('bounds protected stdin before spawn and cleans its scratch tree', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const spec = protectedSpec(root)
    spec.message = 'x'.repeat(2_048)
    const iterator = spawnWorkerTurn(spec, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
      maxInputBytes: 1_024,
      workerEntryPath: join(root, 'must-not-spawn.ts'),
    })

    await expect(iterator.next()).rejects.toThrow(/input exceeded the maximum size/)
    expect(readdirSync(scratchParent)).toEqual([])
  })

  test('terminates a live child before cleaning scratch when a consumer stops early', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const spec = protectedSpec(root)
    spec.message = 'hang-after-frame'
    const iterator = spawnWorkerTurn(spec, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
      workerEntryPath: fileURLToPath(
        new URL('../fixtures/worker-minimal-runtime-entry.ts', import.meta.url),
      ),
      killGraceMs: 500,
    })

    const first = await iterator.next()
    expect(first.done).toBe(false)
    await iterator.return(undefined)
    expect(readdirSync(scratchParent)).toEqual([])
  })

  test('bounds an unterminated stdout frame and fails closed', async () => {
    const root = tempRoot()
    const scratchParent = join(root, 'scratch-parent')
    mkdirSync(scratchParent)
    const spec = protectedSpec(root)
    spec.message = 'oversized-frame'
    const frames = []

    for await (const frame of spawnWorkerTurn(spec, {
      ...scopedHosts(),
      apiKeyRefreshHost: { refresh: async () => 'rotated' },
      scratchParentDir: scratchParent,
      workerEntryPath: fileURLToPath(
        new URL('../fixtures/worker-minimal-runtime-entry.ts', import.meta.url),
      ),
      maxFrameChars: 1_024,
      killGraceMs: 500,
    })) {
      frames.push(frame)
    }

    expect(frames).toContainEqual({
      kind: 'fatal',
      error: 'worker frame exceeded the maximum size',
    })
    expect(readdirSync(scratchParent)).toEqual([])
  })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-worker-runtime-test-'))
  cleanup.push(root)
  return root
}

function protectedSpec(root: string, accessToken = 'initial-access-token'): ProtectedWorkerSpec {
  const agentDir = join(root, 'agents', 'agent-1')
  const teamDir = join(root, 'teams', 'team-1')
  const memoryDir = join(teamDir, 'memory')
  const sessionsDir = join(agentDir, 'sessions')
  for (const path of [agentDir, teamDir, memoryDir, sessionsDir])
    mkdirSync(path, { recursive: true })
  const agent = resolvedAgent(agentDir, teamDir)
  const docker = fakeDockerRuntime(teamDir, memoryDir)
  return {
    kind: 'protected',
    agent,
    message: 'test protected runtime',
    turnId: 'turn-1',
    bashApprovalMode: 'auto_deny',
    runtime: {
      providerName: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      reasoningLevel: 'high',
      apiKey: accessToken,
    },
    paths: {
      agentDir,
      teamDir,
      memoryDir,
      sessionDir: sessionsDir,
      skills: [],
      homeDocuments: {
        'AGENTS.md': null,
        'SOUL.md': null,
        'TOOLS.md': null,
        'IDENTITY.md': null,
        'BOOTSTRAP.md': null,
      },
    },
    docker,
    webFetchEnabled: true,
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
      createdAt: 0,
    },
    skills: [],
    privateLessons: [],
  }
}

function fakeDockerRuntime(teamDir: string, memoryDir: string): ProtectedDockerRuntime {
  return {
    dockerPath: process.execPath,
    executableIdentity: {
      device: '1',
      inode: '2',
      mode: '33261',
      size: '3',
      modifiedTimeNs: '4',
      changedTimeNs: '5',
    },
    endpoint: 'unix:///tmp/bazilion-test-docker.sock',
    image: 'test:image',
    imageId: `sha256:${'a'.repeat(64)}`,
    uid: typeof process.getuid === 'function' ? process.getuid() : 1,
    gid: typeof process.getgid === 'function' ? process.getgid() : 1,
    workspace: { source: teamDir, sourceRoot: teamDir, target: '/workspace' },
    readOnlyMounts: [{ source: memoryDir, sourceRoot: teamDir, target: '/workspace/memory' }],
    containerEnv: {
      PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      HOME: '/tmp',
      LANG: 'C.UTF-8',
      LC_ALL: 'C.UTF-8',
      SHELL: '/bin/bash',
      TMPDIR: '/tmp',
    },
  }
}

function scopedHosts(): {
  messagingHost: MessagingHost
  userMdHost: UserMdHost
  bashApprovalHost: BashApprovalHost
} {
  return {
    messagingHost: {
      agentExists: () => false,
      sendMessage: () => ({ messageId: 'unused' }),
      listInbox: () => [],
      markRead: () => {},
      findReplies: () => [],
      approvalStatus: () => null,
    },
    userMdHost: {
      get: () => ({ content: '', etag: 'unused' }),
      write: () => ({ etag: 'unused', totalBytes: 0 }),
    },
    bashApprovalHost: {
      begin: () => ({
        approval: {
          id: 'unused',
          turnId: 'turn-1',
          toolCallId: 'unused',
          agentId: 'agent-1',
          teamId: 'team-1',
          command: 'unused',
          risks: [],
          status: 'auto_denied',
          createdAt: 0,
          expiresAt: 0,
        },
        decision: Promise.resolve({ decision: 'deny', reason: 'auto_deny' }),
      }),
    },
  }
}
