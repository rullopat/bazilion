import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ResolvedAgent } from '@bazilion/api-types'
import { expect, test, vi } from 'vitest'
import { resolvePaths } from '../../src/core/index.ts'
import type { MemoryBackend } from '../../src/runtime/memory/types.ts'
import { createBazilionSession } from '../../src/runtime/pi/session.ts'
import {
  type ApiKeyRefreshTurnContext,
  createIpcApiKeyRefresher,
  refreshApiKeyForTurn,
} from '../../src/runtime/worker/api-key-refresh.ts'
import { createIpcClient, type WorkerIpcCall } from '../../src/runtime/worker/ipc-client.ts'
import type {
  ApiKeyRefreshArgs,
  ApiKeyRefreshHost,
  IpcReply,
  IpcRequest,
} from '../../src/runtime/worker/ipc-protocol.ts'
import { spawnWorkerTurn } from '../../src/runtime/worker/spawn.ts'

const context: ApiKeyRefreshTurnContext = {
  providerName: 'openai-codex',
  agentId: 'agent-1',
  turnId: 'turn-1',
}

const request: ApiKeyRefreshArgs = {
  providerName: 'openai-codex',
  agentId: 'agent-1',
  turnId: 'turn-1',
}

test('worker refresher sends only provider and current-turn identity over IPC', async () => {
  const calls: Array<{ method: string; args: unknown }> = []
  const call: WorkerIpcCall = async <T>(method: string, args: unknown) => {
    calls.push({ method, args })
    return 'fresh-access-token' as T
  }
  const refresh = createIpcApiKeyRefresher(call, context)

  await expect(refresh('openai-codex')).resolves.toBe('fresh-access-token')
  expect(calls).toEqual([{ method: 'refreshApiKey', args: request }])
})

test('worker rejects a provider mismatch without sending an IPC request', async () => {
  let calls = 0
  const call: WorkerIpcCall = async <T>() => {
    calls += 1
    return 'must-not-return' as T
  }
  const refresh = createIpcApiKeyRefresher(call, context)

  await expect(refresh('openai')).rejects.toThrow(/unexpected API key refresh provider/)
  expect(calls).toBe(0)
})

test('worker IPC disconnect rejects and clears a pending refresh request', async () => {
  let onMessage: ((message: unknown) => void) | undefined
  let onDisconnect: (() => void) | undefined
  const sent: IpcRequest[] = []
  const call = createIpcClient({
    send(message, done) {
      sent.push(message)
      done(null)
    },
    onMessage(listener) {
      onMessage = listener
    },
    onDisconnect(listener) {
      onDisconnect = listener
    },
  })
  const refresh = createIpcApiKeyRefresher(call, context)
  const pending = refresh('openai-codex')
  const rejected = expect(pending).rejects.toThrow(/IPC channel disconnected/)

  expect(sent).toHaveLength(1)
  onDisconnect?.()
  await rejected

  // A late credential-bearing reply after shutdown is ignored because the
  // pending correlation entry was cleared with the disconnect.
  const lateReply: IpcReply = {
    type: 'rpc-reply',
    id: sent[0]?.id ?? '',
    ok: true,
    result: 'late-access-token',
  }
  expect(() => onMessage?.(lateReply)).not.toThrow()
})

test('worker IPC refuses new requests after disconnect without calling send', async () => {
  let onDisconnect: (() => void) | undefined
  const send = vi.fn()
  const call = createIpcClient({
    send,
    onMessage() {},
    onDisconnect(listener) {
      onDisconnect = listener
    },
  })
  onDisconnect?.()

  await expect(call('refreshApiKey', request)).rejects.toThrow(/IPC channel disconnected/)
  expect(send).not.toHaveBeenCalled()
})

test('worker IPC cleans up and rejects when send throws synchronously', async () => {
  let onMessage: ((message: unknown) => void) | undefined
  let sent: IpcRequest | undefined
  const sendError = new Error('synthetic synchronous IPC send failure')
  const call = createIpcClient({
    send(message) {
      sent = message
      throw sendError
    },
    onMessage(listener) {
      onMessage = listener
    },
    onDisconnect() {},
  })

  await expect(call('refreshApiKey', request)).rejects.toBe(sendError)
  expect(sent).toBeDefined()
  expect(() =>
    onMessage?.({
      type: 'rpc-reply',
      id: sent?.id ?? '',
      ok: true,
      result: 'late-access-token',
    } satisfies IpcReply),
  ).not.toThrow()
})

test('spawned worker refreshes end-to-end without putting either token in ChatFrames', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-worker-refresh-spawn-'))
  const paths = resolvePaths(home)
  const agent = resolvedOpenAICodexAgent(paths)
  mkdirSync(agent.agent.dir, { recursive: true })
  mkdirSync(agent.team.path, { recursive: true })
  const initialToken = 'initial-access-token-must-not-enter-frames'
  const refreshedToken = 'end-to-end-refreshed-token-must-not-enter-frames'
  const refresh = vi.fn(async () => refreshedToken)
  const frames: unknown[] = []

  try {
    for await (const frame of spawnWorkerTurn(
      {
        agent,
        message: 'exercise refresh IPC',
        enabledProviders: ['openai-codex'],
        apiKey: initialToken,
        turnId: 'turn-spawn-integration',
        bashApprovalMode: 'auto_deny',
      },
      {
        apiKeyRefreshHost: { refresh },
        workerEntryPath: fileURLToPath(
          new URL('../fixtures/worker-api-key-refresh-entry.ts', import.meta.url),
        ),
      },
    )) {
      frames.push(frame)
    }

    expect(refresh).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith('openai-codex', expect.any(AbortSignal))
    expect(frames).toEqual([{ kind: 'done', messages: [] }])
    expect(JSON.stringify(frames)).not.toContain(initialToken)
    expect(JSON.stringify(frames)).not.toContain(refreshedToken)
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

test('daemon refresh accepts only the provider and identity bound to this turn', async () => {
  const refresh = vi.fn(async () => 'fresh-access-token')
  const host: ApiKeyRefreshHost = { refresh }

  await expect(refreshApiKeyForTurn(request, context, host)).resolves.toBe('fresh-access-token')
  expect(refresh).toHaveBeenCalledOnce()
  expect(refresh).toHaveBeenCalledWith('openai-codex', undefined)

  for (const mismatch of [
    { ...request, providerName: 'openai' },
    { ...request, agentId: 'agent-2' },
    { ...request, turnId: 'turn-2' },
  ]) {
    await expect(refreshApiKeyForTurn(mismatch, context, host)).rejects.toThrow(
      /unexpected API key refresh provider|does not belong to this worker turn/,
    )
  }
  expect(refresh).toHaveBeenCalledOnce()
})

test('daemon rejects refresh before host invocation when the turn is already cancelled', async () => {
  const controller = new AbortController()
  controller.abort()
  const refresh = vi.fn(async () => 'must-not-return')

  await expect(
    refreshApiKeyForTurn(request, context, { refresh }, controller.signal),
  ).rejects.toThrow(/cancelled with the worker turn/)
  expect(refresh).not.toHaveBeenCalled()
})

test('daemon rejects a refresh request when this turn has no refresh host', async () => {
  await expect(refreshApiKeyForTurn(request, context, undefined)).rejects.toThrow(
    /refresh is unavailable for this worker turn/,
  )
})

test('daemon stops waiting when cancellation happens during refresh', async () => {
  const controller = new AbortController()
  let hostSignal: AbortSignal | undefined
  let resolveRefresh: ((token: string) => void) | undefined
  const pending = new Promise<string>((resolve) => {
    resolveRefresh = resolve
  })
  const refresh = vi.fn((_providerName: string, signal?: AbortSignal) => {
    hostSignal = signal
    return pending
  })

  const result = refreshApiKeyForTurn(request, context, { refresh }, controller.signal)
  controller.abort()

  await expect(result).rejects.toThrow(/cancelled with the worker turn/)
  expect(hostSignal?.aborted).toBe(true)
  resolveRefresh?.('late-access-token')
})

test('daemon redacts host errors and rejects empty host results', async () => {
  const tokenSentinel = 'secret-access-token-must-not-leak'
  let exposedError: unknown
  try {
    await refreshApiKeyForTurn(request, context, {
      refresh: async () => {
        throw new Error(`upstream rejected Authorization: Bearer ${tokenSentinel}`)
      },
    })
  } catch (error) {
    exposedError = error
  }
  expect(exposedError).toBeInstanceOf(Error)
  expect((exposedError as Error).message).toMatch(/access token refresh failed/)
  expect((exposedError as Error).message).not.toContain(tokenSentinel)
  expect(String(exposedError)).not.toContain(tokenSentinel)
  expect(JSON.stringify(exposedError)).not.toContain(tokenSentinel)

  await expect(refreshApiKeyForTurn(request, context, { refresh: async () => '' })).rejects.toThrow(
    /invalid token/,
  )
})

test('Bazilion session gives pi the IPC-backed refresher for openai-codex', async () => {
  const home = mkdtempSync(join(tmpdir(), 'bazilion-worker-refresh-'))
  const paths = resolvePaths(home)
  const agentDir = paths.agentDir('agent-1')
  const teamDir = paths.teamDir('team-1')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(teamDir, { recursive: true })

  const agent = {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: null,
      reasoningLevel: 'medium',
      reviewEnabled: false,
      reviewEveryNTurns: 8,
      reviewModel: null,
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
      dir: paths.profileDir('profile-1'),
      defaultModel: 'openai-codex:gpt-5.3-codex',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.3-codex',
    reasoningLevel: 'medium',
    team: {
      id: 'team-1',
      name: 'Team One',
      path: teamDir,
      userMd: '',
      telegramTopicNameFormat: null,
      createdAt: 0,
    },
    skills: [],
  } satisfies ResolvedAgent
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
  const refreshApiKey = vi.fn(async () => 'session-refreshed-token')

  try {
    const handle = await createBazilionSession({
      agent,
      paths,
      env: { BAZILION_BASH_SANDBOX: 'off', BAZILION_BASH_APPROVAL: 'off' },
      memory,
      enabledProviders: new Set(['openai-codex']),
      apiKey: 'initial-access-token',
      refreshApiKey,
    })
    try {
      await expect(handle.session.agent.getApiKey?.('openai-codex')).resolves.toBe(
        'session-refreshed-token',
      )
      expect(refreshApiKey).toHaveBeenCalledWith('openai-codex')
      await expect(handle.session.agent.getApiKey?.('openai')).resolves.toBeUndefined()
    } finally {
      handle.dispose()
    }
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

function resolvedOpenAICodexAgent(paths: ReturnType<typeof resolvePaths>): ResolvedAgent {
  const agentDir = paths.agentDir('agent-1')
  return {
    agent: {
      id: 'agent-1',
      profileId: 'profile-1',
      name: 'Agent One',
      modelOverride: null,
      reasoningLevel: 'medium',
      reviewEnabled: false,
      reviewEveryNTurns: 8,
      reviewModel: null,
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
      dir: paths.profileDir('profile-1'),
      defaultModel: 'openai-codex:gpt-5.3-codex',
      skillsMode: 'selected',
      createdAt: 0,
      updatedAt: 0,
    },
    model: 'openai-codex:gpt-5.3-codex',
    reasoningLevel: 'medium',
    team: {
      id: 'team-1',
      name: 'Team One',
      path: paths.teamDir('team-1'),
      userMd: '',
      telegramTopicNameFormat: null,
      createdAt: 0,
    },
    skills: [],
  }
}
