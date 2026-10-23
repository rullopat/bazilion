import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Api, AssistantMessage, Model } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream } from '@earendil-works/pi-ai'
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { afterEach, describe, expect, test } from 'vitest'
import { installProtectedCredentialBoundary } from '../../src/runtime/pi/session.ts'
import {
  createOpenAICodexPiRuntime,
  createProtectedPiRuntime,
  resolvePiModel,
} from '../../src/runtime/providers/pi-runtime.ts'

const cleanup: string[] = []
afterEach(() => {
  for (const path of cleanup.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('protected Pi persistence credential boundary', () => {
  test('Azure SDK requests refresh only the bound Bazilion credential', async () => {
    const initial = 'azure-initial-fixture-token'
    const rotated = 'azure-rotated-fixture-token'
    const harness = await createHarness(initial, [], 'azure-openai')
    const tokens = [initial]
    const requests: string[] = []
    harness.session.agent.streamFunction = (model, _context, options) => {
      expect(model.provider).toBe('azure')
      expect(options?.apiKey).toBe(rotated)
      const stream = createAssistantMessageEventStream()
      queueMicrotask(() =>
        stream.push({
          type: 'done',
          reason: 'stop',
          message: assistantMessage(model, 'stop', [{ type: 'text', text: 'finished' }]),
        }),
      )
      return stream
    }
    installProtectedCredentialBoundary(
      harness.session,
      'azure-openai',
      tokens,
      async (provider) => {
        requests.push(provider)
        return rotated
      },
    )
    try {
      for (const provider of ['openai', 'azure-openai-responses']) {
        expect(await harness.session.agent.getApiKey?.(provider)).toBeUndefined()
      }
      expect(await harness.session.agent.getApiKey?.('azure')).toBe(rotated)
      requests.length = 0
      await harness.session.prompt('exercise the selected Azure credential')
      expect(harness.session.getLastAssistantText()).toBe('finished')
      expect(requests).toEqual(['azure-openai'])
      expect(tokens).toContain(rotated)
    } finally {
      harness.session.dispose()
    }
  })

  test('sanitizes initial and rotated provider errors before session persistence', async () => {
    const initial = 'initial-provider-access-token'
    const rotated = 'rotated-provider-access-token'
    const harness = await createHarness(initial, [])
    harness.session.agent.streamFunction = (_model, _context, _options) => {
      const stream = createAssistantMessageEventStream()
      queueMicrotask(() => {
        const error = assistantMessage(
          harness.model,
          'error',
          [],
          `provider exposed ${initial} then ${rotated}`,
        )
        stream.push({ type: 'error', reason: 'error', error })
      })
      return stream
    }
    installProtectedCredentialBoundary(
      harness.session,
      'openai-codex',
      [initial],
      async () => rotated,
    )

    await harness.session.prompt('exercise provider error')
    const serializedState = JSON.stringify(harness.session.agent.state.messages)
    harness.session.dispose()
    const transcript = readTranscript(harness.sessionDir)

    for (const serialized of [serializedState, transcript]) {
      expect(serialized).not.toContain(initial)
      expect(serialized).not.toContain(rotated)
      expect(serialized).toContain('[REDACTED]')
    }
  })

  test('converts an async provider iterator throw into a sanitized persisted error event', async () => {
    const initial = 'iterator-throw-access-token'
    const sentinel = 'ITERATOR_THROW_SENTINEL'
    const harness = await createHarness(initial, [])
    harness.session.agent.streamFunction = () => {
      const stream = createAssistantMessageEventStream()
      Object.defineProperty(stream, Symbol.asyncIterator, {
        value: () => ({
          async next() {
            await Promise.resolve()
            throw new Error(`${sentinel}: provider exposed ${initial}`)
          },
          [Symbol.asyncIterator]() {
            return this
          },
        }),
      })
      return stream
    }
    installProtectedCredentialBoundary(
      harness.session,
      'openai-codex',
      [initial],
      async () => initial,
    )
    const unhandled: unknown[] = []
    const captureUnhandled = (reason: unknown) => unhandled.push(reason)
    process.on('unhandledRejection', captureUnhandled)

    try {
      await harness.session.prompt('exercise provider iterator throw')
      await new Promise<void>((resolve) => setImmediate(resolve))
    } finally {
      process.off('unhandledRejection', captureUnhandled)
    }
    const serializedState = JSON.stringify(harness.session.agent.state.messages)
    harness.session.dispose()
    const transcript = readTranscript(harness.sessionDir)

    expect(unhandled).toEqual([])
    for (const serialized of [serializedState, transcript]) {
      expect(serialized).toContain(sentinel)
      expect(serialized).not.toContain(initial)
      expect(serialized).toContain('[REDACTED]')
    }
  })

  test('sanitizes thrown tool errors before tool-result persistence', async () => {
    const initial = 'initial-tool-access-token'
    const leakTool: ToolDefinition = {
      name: 'leak_tool',
      label: 'leak_tool',
      description: 'test-only tool',
      parameters: Type.Object({}),
      async execute() {
        throw new Error(`tool exposed ${initial}`)
      },
    }
    const harness = await createHarness(initial, [leakTool])
    let call = 0
    harness.session.agent.streamFunction = (_model, _context, _options) => {
      const stream = createAssistantMessageEventStream()
      const reason = call++ === 0 ? ('toolUse' as const) : ('stop' as const)
      const message =
        reason === 'toolUse'
          ? assistantMessage(harness.model, 'toolUse', [
              { type: 'toolCall', id: 'call-1', name: 'leak_tool', arguments: {} },
            ])
          : assistantMessage(harness.model, 'stop', [{ type: 'text', text: 'finished' }])
      queueMicrotask(() => stream.push({ type: 'done', reason, message }))
      return stream
    }
    installProtectedCredentialBoundary(
      harness.session,
      'openai-codex',
      [initial],
      async () => initial,
    )

    await harness.session.prompt('exercise tool error')
    const serializedState = JSON.stringify(harness.session.agent.state.messages)
    harness.session.dispose()
    const transcript = readTranscript(harness.sessionDir)

    for (const serialized of [serializedState, transcript]) {
      expect(serialized).not.toContain(initial)
      expect(serialized).toContain('[REDACTED]')
    }
  })
})

async function createHarness(
  accessToken: string,
  tools: ToolDefinition[],
  providerName: 'openai-codex' | 'azure-openai' = 'openai-codex',
): Promise<{
  root: string
  sessionDir: string
  model: Model<Api>
  session: Awaited<ReturnType<typeof createAgentSession>>['session']
}> {
  const root = mkdtempSync(join(tmpdir(), 'bazilion-protected-session-test-'))
  cleanup.push(root)
  const cwd = join(root, 'cwd')
  const agentDir = join(root, 'pi')
  const sessionDir = join(root, 'sessions')
  for (const path of [cwd, agentDir, sessionDir]) mkdirSync(path)
  const settingsManager = SettingsManager.inMemory({
    cacheWarming: 'off',
    compaction: { enabled: false },
    retry: {
      enabled: false,
      maxRetries: 0,
      baseDelayMs: 1,
      provider: { maxRetryDelayMs: 1 },
    },
  })
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  })
  await resourceLoader.reload()
  const modelId = providerName === 'azure-openai' ? 'gpt-6.1-sol' : 'gpt-5.6-sol'
  const modelRuntime =
    providerName === 'azure-openai'
      ? await createProtectedPiRuntime({ providerName, modelId, apiKey: accessToken })
      : await createOpenAICodexPiRuntime({ providerName, modelId, accessToken })
  const model = resolvePiModel(modelRuntime, providerName, modelId)
  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model,
    thinkingLevel: 'off',
    tools: tools.map((tool) => tool.name),
    customTools: tools,
    sessionManager: SessionManager.create(cwd, sessionDir),
    settingsManager,
    modelRuntime,
    resourceLoader,
  })
  return { root, sessionDir, model, session }
}

function assistantMessage(
  model: Model<Api>,
  stopReason: AssistantMessage['stopReason'],
  content: AssistantMessage['content'],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: 'assistant',
    content,
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  }
}

function readTranscript(sessionDir: string): string {
  const file = readdirSync(sessionDir).find((name) => name.endsWith('.jsonl'))
  if (!file) throw new Error('session transcript was not created')
  return readFileSync(join(sessionDir, file), 'utf8')
}
