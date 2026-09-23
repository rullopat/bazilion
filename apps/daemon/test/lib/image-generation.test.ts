import { appendFileSync } from 'node:fs'
import { join } from 'node:path'
import type { ImageGenerationInput, ImageGenerationOutput } from '@bazilion/api-types'
import type { AssistantImages, ImagesModels } from '@earendil-works/pi-ai'
import { afterEach, beforeEach, expect, type Mock, test, vi } from 'vitest'
import { resolveAgent } from '../../src/core/agent/resolve.ts'
import { spawnAgent } from '../../src/core/agent/spawn.ts'
import { openDb } from '../../src/core/db/client.ts'
import {
  IMAGE_MODELS,
  imageGenerationConfig,
  imageTurnEnv,
  OPENROUTER_IMAGE_MODELS,
} from '../../src/core/image-generation-config.ts'
import { createProfile } from '../../src/core/profile/create.ts'
import { setEnabled } from '../../src/core/repos/providerState.ts'
import * as results from '../../src/core/repos/results.ts'
import { authorizeHttpChatFrame } from '../../src/lib/communication.ts'
import { resolveConversationTarget } from '../../src/lib/conversation-target.ts'
import {
  boundedImageFetch,
  createImageGenerationHost,
  IMAGE_RESPONSE_BYTES,
  imageCatalogue,
} from '../../src/lib/image-generation.ts'
import { createTurnToolSource } from '../../src/lib/turn-tool-source.ts'
import {
  clearCredentials,
  hasCredentials,
  loadAccessToken,
  saveLoginCredentials,
} from '../../src/runtime/auth/openai-codex.ts'
import { piMessagesToProviderView } from '../../src/runtime/pi/events.ts'
import { ourToolToPiTool } from '../../src/runtime/pi/tools.ts'
import { imageGenerateTool } from '../../src/runtime/tools/image-generate.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
  'base64',
)
let env: TestEnv
let agentId: string
let sessionId: string
let signal: AbortController
let config: NodeJS.ProcessEnv
let host: ReturnType<typeof createImageGenerationHost>
let models: ReturnType<typeof imageCatalogue>
let generate: Mock<ImagesModels['generateImages']>
let source: ReturnType<typeof createTurnToolSource>
function response(images = 1): AssistantImages {
  return {
    api: 'openrouter-images',
    provider: 'openrouter',
    model: IMAGE_MODELS[0],
    stopReason: 'stop',
    timestamp: Date.now(),
    responseId: 'provider-response',
    output: Array.from({ length: images }, () => ({
      type: 'image',
      mimeType: 'image/png',
      data: png.toString('base64'),
    })),
  }
}
function input(id = 'call', prompt = 'A little bird'): ImageGenerationInput {
  const args = { prompt, name: 'bird' }
  appendFileSync(
    join(env.paths.agentDir(agentId), 'sessions', `${sessionId}.jsonl`),
    `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'toolCall', id, name: 'image_generate', arguments: args }] } })}\n`,
  )
  return { sessionId, toolCallId: id, ...args }
}
function firstResultId(output: ImageGenerationOutput): string {
  const file = output.files[0]
  if (!file) throw new Error('Missing generated image')
  return file.result.resultId
}
function operationCount() {
  return env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM image_generations').get()?.n
}
function outcome() {
  return env.db.raw.query<{ outcome: string }, []>('SELECT outcome FROM image_generations').get()
    ?.outcome
}
beforeEach(() => {
  env = makeTestEnv()
  createProfile(env.db, env.paths, {
    id: 'producer',
    defaultModel: 'lmstudio:test',
    communicationDefaults: {
      userInput: true,
      userOutput: true,
      outsideTeamInput: false,
      outsideTeamOutput: false,
      peerDefault: 'allow_all',
    },
  })
  agentId = spawnAgent(env.db, env.paths, { profileId: 'producer', teamId: env.teamId }).id
  const conversation = resolveConversationTarget(env.db, env.paths, agentId)
  sessionId = conversation.id
  source = createTurnToolSource(
    env.paths,
    resolveAgent(env.db, env.paths, agentId),
    conversation,
    'image_generate',
  )
  signal = new AbortController()
  config = {
    BAZILION_IMAGE_GENERATION: 'on',
    BAZILION_IMAGE_MODEL: IMAGE_MODELS[0],
    OPENROUTER_API_KEY: 'test-key-not-for-network',
  }
  models = imageCatalogue()
  generate = vi.fn<ImagesModels['generateImages']>(async () => response())
  models.generateImages = generate
  host = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'turn-one',
    signal: signal.signal,
    env: () => config,
    assertActive: () => {},
    source,
    models,
  })
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  env.cleanup()
})

function automaticHost(fetcher: typeof fetch, accessToken = async () => 'oauth-private') {
  config.BAZILION_IMAGE_MODEL = 'auto'
  config.OPENAI_API_KEY = 'direct-private'
  return createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'auto-turn',
    chatModel: 'lmstudio:chat',
    signal: signal.signal,
    env: () => config,
    source,
    assertActive: () => {},
    fetch: fetcher,
    codex: { connected: () => true, accessToken },
  })
}

test('automatic text enablement switches future image calls but never rewrites an admitted route or replays it', async () => {
  setEnabled(env.db, 'openai', true)
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).includes('api.openai.com')) {
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer direct-private')
      // Operator switches text providers while the first image request is already in flight.
      setEnabled(env.db, 'openai', false)
      setEnabled(env.db, 'openai-codex', true)
      return Response.json({ data: [{ b64_json: png.toString('base64') }] })
    }
    expect(String(url)).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer oauth-private')
    return new Response(
      `data: ${JSON.stringify({ type: 'response.completed', response: { output: [{ type: 'image_generation_call', result: png.toString('base64') }] } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    )
  })
  const auto = automaticHost(fetcher)
  const original = input()
  const first = await auto.generate(original)
  expect(first.model).toBe('openai:gpt-image-2')
  expect(results.getReceipt(env.db, firstResultId(first))?.imageModel).toBe('openai:gpt-image-2')
  await expect(auto.generate(original)).rejects.toThrow('does not match')
  const second = await auto.generate(input('next-call'))
  expect(second.model).toBe('openai-codex:gpt-image-2')
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('automatic routing refuses dispatch when text enablement changes during OAuth refresh', async () => {
  setEnabled(env.db, 'openai-codex', true)
  let finish: (key: string) => void = () => {}
  const token = new Promise<string>((resolve) => {
    finish = resolve
  })
  const fetcher = vi.fn<typeof fetch>()
  const auto = automaticHost(fetcher, () => token)
  const pending = auto.generate(input())
  setEnabled(env.db, 'openai-codex', false)
  setEnabled(env.db, 'openai', true)
  finish('oauth-private')
  await expect(pending).rejects.toThrow('configuration changed before dispatch')
  expect(fetcher).not.toHaveBeenCalled()
  expect(outcome()).toBe('uncertain')
})

test('automatic routing never retries an uncertain operation through a newly enabled text provider', async () => {
  setEnabled(env.db, 'openai', true)
  const fetcher = vi.fn<typeof fetch>(async () =>
    Response.json({ error: 'unavailable' }, { status: 401 }),
  )
  const getToken = vi.fn(async () => 'oauth-private')
  const auto = automaticHost(fetcher, getToken)
  await expect(auto.generate(input())).rejects.toThrow('No automatic retry or credential fallback')
  setEnabled(env.db, 'openai', false)
  setEnabled(env.db, 'openai-codex', true)
  await expect(auto.generate(input('new-id'))).rejects.toThrow('blocked for the rest')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(getToken).not.toHaveBeenCalled()
})

test.each([
  'openai',
  'openai-codex',
] as const)('captures %s images under the selected billing route without replay or credential disclosure', async (provider) => {
  config.BAZILION_IMAGE_MODEL = `${provider}:gpt-image-2`
  config.OPENAI_API_KEY = 'direct-private'
  saveLoginCredentials(env.db, 'password', {
    access: 'oauth-private',
    refresh: 'refresh-private',
    expires: Date.now() + 3600000,
  })
  const credential = provider === 'openai' ? 'direct-private' : 'oauth-private'
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${credential}`)
    return provider === 'openai'
      ? Response.json({ id: credential, data: [{ b64_json: png.toString('base64') }] })
      : new Response(
          `data: ${JSON.stringify({ type: 'response.completed', response: { id: credential, output: [{ id: 'ig', type: 'image_generation_call', status: 'completed', result: png.toString('base64') }] } })}\n\n`,
          { headers: { 'content-type': 'text/event-stream' } },
        )
  })
  const getToken = vi.fn(() => loadAccessToken(env.db, 'password'))
  const direct = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'direct-turn',
    signal: signal.signal,
    source,
    assertActive: () => {},
    env: () => config,
    fetch: fetcher,
    codex: { connected: () => hasCredentials(env.db, 'password'), accessToken: getToken },
  })
  const request = input()
  const output = await direct.generate(request)
  expect(await direct.generate(request)).toEqual(output)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(getToken).toHaveBeenCalledTimes(provider === 'openai-codex' ? 1 : 0)
  expect(output.model).toBe(`${provider}:gpt-image-2`)
  const receipt = results.getReceipt(env.db, firstResultId(output))
  expect(receipt).toMatchObject({ imageModel: `${provider}:gpt-image-2`, releasedAt: null })
  expect(JSON.stringify(output)).not.toContain(credential)
  expect(
    env.db.raw
      .query<{ response_id: string | null }, []>('SELECT response_id FROM image_generations')
      .get()?.response_id,
  ).toBeNull()
  expect(results.readCaptured(env.db, firstResultId(output))).toEqual(png)
  config.BAZILION_IMAGE_MODEL =
    provider === 'openai' ? 'openai-codex:gpt-image-2' : 'openai:gpt-image-2'
  await expect(direct.generate(request)).rejects.toThrow('does not match')
  expect(fetcher).toHaveBeenCalledTimes(1)
  if (provider === 'openai') {
    clearCredentials(env.db, 'password')
    await expect(direct.generate(input('after-logout'))).rejects.toThrow('Connect ChatGPT')
    expect(fetcher).toHaveBeenCalledTimes(1)
  }
})

test('Codex credential refresh failure is actionable, private and cannot fall back to an API key', async () => {
  config.BAZILION_IMAGE_MODEL = 'openai-codex:gpt-image-2'
  config.OPENAI_API_KEY = 'available-but-not-authorized'
  const fetcher = vi.fn<typeof fetch>()
  const direct = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'direct-turn',
    signal: signal.signal,
    source,
    assertActive: () => {},
    env: () => config,
    fetch: fetcher,
    codex: {
      connected: () => true,
      accessToken: async () => {
        throw new Error('private-refresh-secret')
      },
    },
  })
  await expect(direct.generate(input())).rejects.toThrow('Reconnect ChatGPT')
  expect(fetcher).not.toHaveBeenCalled()
  expect(outcome()).toBe('uncertain')
  await expect(direct.generate(input('another-id'))).rejects.toThrow('blocked for the rest')
})

test('cancelling a shared Codex credential refresh prevents late image dispatch', async () => {
  config.BAZILION_IMAGE_MODEL = 'openai-codex:gpt-image-2'
  let finish: (key: string) => void = () => {}
  const token = new Promise<string>((resolve) => {
    finish = resolve
  })
  const fetcher = vi.fn<typeof fetch>()
  const direct = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'direct-turn',
    signal: signal.signal,
    source,
    assertActive: () => {},
    env: () => config,
    fetch: fetcher,
    codex: { connected: () => true, accessToken: () => token },
  })
  const pending = direct.generate(input())
  signal.abort()
  await expect(pending).rejects.toThrow('cancelled')
  finish('late-private-token')
  await new Promise((resolve) => setImmediate(resolve))
  expect(fetcher).not.toHaveBeenCalled()
  expect(outcome()).toBe('uncertain')
})

test('resolves exactly the two curated Pi image entries without network or ambient auth', () => {
  for (const id of OPENROUTER_IMAGE_MODELS) {
    expect(models.getModel('openrouter', id)).toMatchObject({
      api: 'openrouter-images',
      provider: 'openrouter',
      baseUrl: 'https://openrouter.ai/api/v1',
    })
    expect(models.getModel('openrouter', id)?.output).toContain('image')
  }
  expect(imageTurnEnv(config, 'lmstudio:chat').OPENROUTER_API_KEY).toBeUndefined()
  expect(imageTurnEnv(config, 'openrouter:chat').OPENROUTER_API_KEY).toBe(config.OPENROUTER_API_KEY)
  expect(config.OPENROUTER_API_KEY).toBe('test-key-not-for-network')
  expect(imageGenerationConfig({}).ready).toBe(false)
  expect(
    imageGenerationConfig({ ...config, OPENROUTER_API_KEY: '', OPENAI_API_KEY: 'not-an-image-key' })
      .ready,
  ).toBe(false)
})

test('captures all image bytes privately, keeps real source identity, and never bills duplicate IPC', async () => {
  generate.mockResolvedValue(response(2))
  const request = input()
  const first = await host.generate(request)
  expect(first.files).toHaveLength(2)
  expect(first.files.map((file) => file.name)).toEqual(['bird-1.png', 'bird-2.png'])
  expect(await host.generate(request)).toEqual(first)
  expect(generate).toHaveBeenCalledTimes(1)
  expect(generate.mock.calls[0]?.[2]).toMatchObject({
    apiKey: config.OPENROUTER_API_KEY,
    maxRetries: 0,
    timeoutMs: 180000,
  })
  expect(outcome()).toBe('completed')
  for (const [index, file] of first.files.entries()) {
    const id = file.result.resultId
    expect(results.getReleased(env.db, id)).toBeNull()
    expect(results.getReceipt(env.db, id)).toMatchObject({
      sessionId,
      toolCallId: 'call',
      sourceIndex: index,
      imageModel: IMAGE_MODELS[0],
    })
    results.release(env.db, id, agentId)
    expect(results.readReleased(env.db, id)).toEqual(png)
  }
  results.deleteReleased(env.db, firstResultId(first))
  await expect(host.generate(request)).rejects.toThrow('deleted')
  expect(generate).toHaveBeenCalledTimes(1)
})

test.each([
  'allow',
  'deny',
  'approval_required',
])('generated file disclosure obeys %s without tool-result preview bypass', async (posture) => {
  vi.stubEnv('BAZILION_TEAM_POLICY_ENFORCEMENT', 'on')
  if (posture === 'deny') {
    env.db.raw.run(
      "DELETE FROM team_policy_edges WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
      [env.teamId, agentId],
    )
  } else {
    env.db.raw.run(
      "UPDATE team_policy_edges SET posture = ? WHERE team_id = ? AND source_kind = 'agent' AND source_id = ? AND target_kind = 'user'",
      [posture, env.teamId, agentId],
    )
  }
  const output = await host.generate(input())
  const file = output.files[0]
  if (!file) throw new Error('Missing generated image')
  const frame = {
    kind: 'event' as const,
    event: { type: 'file' as const, ...file, data: Buffer.from('forged bytes').toString('base64') },
  }
  if (posture === 'allow') {
    authorizeHttpChatFrame(env.db, agentId, 'image-request', 0, frame)
    expect(frame.event.data).toBe(png.toString('base64'))
    expect(results.getReleased(env.db, file.result.resultId)).not.toBeNull()
  } else {
    expect(() => authorizeHttpChatFrame(env.db, agentId, 'image-request', 0, frame)).toThrow()
    expect(results.getReleased(env.db, file.result.resultId)).toBeNull()
    expect(results.listReleased(env.db).total).toBe(0)
  }
})

test.each(
  OPENROUTER_IMAGE_MODELS,
)('real Pi adapter uses the fixed OpenRouter endpoint and one request, with no SDK retry (%s)', async (modelId) => {
  config.BAZILION_IMAGE_MODEL = modelId
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new Headers(init?.headers).get('authorization')).toBe(
      `Bearer ${config.OPENROUTER_API_KEY}`,
    )
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: modelId,
      modalities: modelId.startsWith('google/') ? ['image', 'text'] : ['image'],
    })
    return new Response(
      JSON.stringify({
        id: 'provider-id',
        choices: [
          {
            message: {
              images: [{ image_url: { url: `data:image/png;base64,${png.toString('base64')}` } }],
            },
          },
        ],
        usage: { prompt_tokens: 2, completion_tokens: 3 },
      }),
      { headers: { 'content-type': 'application/json' } },
    )
  })
  const piHost = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'pi-turn',
    signal: signal.signal,
    env: () => config,
    assertActive: () => {},
    source,
    fetch: fetcher,
  })
  const generated = await piHost.generate(input())
  expect(generated.files).toHaveLength(1)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(
    env.db.raw
      .query<{ response_id: string; usage_json: string }, []>(
        'SELECT response_id, usage_json FROM image_generations',
      )
      .get(),
  ).toMatchObject({
    response_id: 'provider-id',
    usage_json: expect.stringContaining('estimatedCost'),
  })
  fetcher.mockResolvedValue(
    new Response(JSON.stringify({ error: { message: 'private-key-echo', type: 'server_error' } }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    }),
  )
  await expect(piHost.generate(input('provider-500'))).rejects.toThrow(
    'Check OpenRouter access/quota',
  )
  expect(fetcher).toHaveBeenCalledTimes(2)
})

test('deadline aborts actual Pi transport without saving a result or retrying', async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const fetchSignal = init?.signal
    if (!fetchSignal) throw new Error('Missing cancellation signal')
    fetchSignal.throwIfAborted()
    return new Promise<Response>((_resolve, reject) =>
      fetchSignal.addEventListener('abort', () => reject(fetchSignal.reason), { once: true }),
    )
  })
  const piHost = createImageGenerationHost({
    db: env.db,
    agentId,
    teamId: env.teamId,
    turnId: 'deadline-turn',
    signal: signal.signal,
    env: () => config,
    assertActive: () => {},
    source,
    fetch: fetcher,
    deadlineMs: 50,
  })
  await expect(piHost.generate(input())).rejects.toThrow('timed out')
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(outcome()).toBe('uncertain')
  expect(operationsResultCount()).toBe(0)
})

test('rework creates distinct durable results and retains the original', async () => {
  const first = await host.generate(input())
  const next = await host.generate(input('rework', 'A blue bird'))
  expect(first.files[0]?.result).not.toEqual(next.files[0]?.result)
  expect(results.readCaptured(env.db, firstResultId(first))).toEqual(png)
  expect(generate).toHaveBeenCalledTimes(2)
})

test.each([
  ['off', { BAZILION_IMAGE_GENERATION: 'off' }],
  ['unknown model', { BAZILION_IMAGE_MODEL: 'gpt-image-pretend' }],
  ['missing credential', { OPENROUTER_API_KEY: '' }],
])('refuses %s before admission or network', async (_, values) => {
  Object.assign(config, values)
  await expect(host.generate(input())).rejects.toThrow()
  expect(generate).not.toHaveBeenCalled()
  expect(operationCount()).toBe(0)
})

test('refuses absent catalogue model, arbitrary IPC keys, altered prompt and old source', async () => {
  const request = input()
  await expect(host.generate({ ...request, prompt: 'different' })).rejects.toThrow('canonical')
  await expect(
    host.generate({ ...request, endpoint: 'https://attacker.invalid' } as ImageGenerationInput),
  ).rejects.toThrow()
  await expect(host.generate({ ...request, toolCallId: 'not-in-transcript' })).rejects.toThrow(
    'canonical transcript',
  )
  await expect(host.generate({ ...request, sessionId: 'other' })).rejects.toThrow('conversation')
  const laterSource = createTurnToolSource(
    env.paths,
    resolveAgent(env.db, env.paths, agentId),
    { id: sessionId, filename: `${sessionId}.jsonl` },
    'image_generate',
  )
  expect(() => laterSource(sessionId, request.toolCallId)).toThrow('canonical transcript')
  vi.spyOn(models, 'getModel').mockReturnValue(undefined)
  await expect(host.generate(request)).rejects.toThrow('no fallback')
  expect(generate).not.toHaveBeenCalled()
  expect(operationCount()).toBe(0)
})

test.each([
  '../escape',
  'bad\nname',
  '',
  'x'.repeat(121),
  'CON.png',
  'name.',
])('refuses unsafe display name %j', async (name) => {
  await expect(host.generate({ ...input(), name })).rejects.toThrow('filename')
  expect(operationCount()).toBe(0)
})

test('caps prompt bytes, requires live membership and obeys cancellation before admission', async () => {
  await expect(host.generate(input('large', 'é'.repeat(4097)))).rejects.toThrow('8 KiB')
  env.db.raw.run("UPDATE agents SET status = 'archived' WHERE id = ?", [agentId])
  await expect(host.generate(input())).rejects.toThrow('active')
  signal.abort()
  await expect(host.generate(input('cancelled'))).rejects.toThrow()
  expect(generate).not.toHaveBeenCalled()
})

test.each([
  ['empty', { output: [] }],
  ['text-only', { output: [{ type: 'text', text: 'No image' }] }],
  ['too many', { output: response(5).output }],
  [
    'MIME mismatch',
    { output: [{ type: 'image', mimeType: 'image/jpeg', data: png.toString('base64') }] },
  ],
  ['invalid base64', { output: [{ type: 'image', mimeType: 'image/png', data: '????' }] }],
  [
    'provider error',
    { stopReason: 'error', errorMessage: 'test-key-not-for-network private prompt' },
  ],
  ['aborted', { stopReason: 'aborted' }],
] satisfies [
  string,
  Partial<AssistantImages>,
][])('never saves success for %s and never automatically regenerates', async (_, patch) => {
  generate.mockResolvedValue({ ...response(), ...patch })
  const request = input()
  await expect(host.generate(request)).rejects.toThrow()
  await expect(host.generate(request)).rejects.toThrow('automatically regenerated')
  expect(operationsResultCount()).toBe(0)
  expect(generate).toHaveBeenCalledTimes(1)
})
function operationsResultCount() {
  return env.db.raw.query<{ n: number }, []>('SELECT count(*) AS n FROM agent_results').get()?.n
}

test('does not retain a credential echoed in provider response metadata', async () => {
  generate.mockResolvedValue({ ...response(), responseId: config.OPENROUTER_API_KEY })
  await host.generate(input())
  expect(
    env.db.raw
      .query<{ response_id: string | null }, []>('SELECT response_id FROM image_generations')
      .get()?.response_id,
  ).toBeNull()
})

test('does not leak arbitrary SDK exceptions or credentials', async () => {
  generate.mockRejectedValue(new Error('Image private data test-key-not-for-network'))
  await expect(host.generate(input())).rejects.toThrow(
    'Image generation failed; billing or account usage may have occurred',
  )
})

test('an uncertain request also blocks model-initiated retries with a fresh tool-call ID', async () => {
  generate.mockRejectedValue(new Error('Lost acknowledgement'))
  await expect(host.generate(input())).rejects.toThrow('billing or account usage may have occurred')
  await expect(host.generate(input('retry-with-new-id'))).rejects.toThrow(
    'blocked for the rest of this turn',
  )
  expect(generate).toHaveBeenCalledTimes(1)
  expect(operationCount()).toBe(1)
})

test('enforces the per-turn billable-call ceiling', async () => {
  for (let i = 0; i < 4; i++) await host.generate(input(`call-${i}`))
  await expect(host.generate(input('call-5'))).rejects.toThrow('four requests')
  expect(generate).toHaveBeenCalledTimes(4)
})

test('serializes home-wide generation and discards a cancelled late success', async () => {
  let finish!: (result: AssistantImages) => void
  generate.mockImplementation(
    () =>
      new Promise<AssistantImages>((resolve) => {
        finish = resolve
      }),
  )
  const pending = host.generate(input())
  await expect(host.generate(input('parallel'))).rejects.toThrow('busy')
  signal.abort()
  finish(response())
  await expect(pending).rejects.toThrow('cancelled')
  expect(outcome()).toBe('uncertain')
  expect(operationsResultCount()).toBe(0)
})

test('results and completion commit together, so a partial storage failure leaves no images', async () => {
  generate.mockResolvedValue(response(2))
  env.db.raw.exec(`CREATE TRIGGER image_disk_full BEFORE INSERT ON agent_results
    WHEN NEW.source_index = 1 BEGIN SELECT RAISE(ABORT, 'simulated disk full'); END`)
  await expect(host.generate(input())).rejects.toThrow()
  expect(outcome()).toBe('uncertain')
  expect(operationsResultCount()).toBe(0)
  env.db.raw.exec('DROP TRIGGER image_disk_full')
})

test('backup/reopen preserves bytes and uncertain operations cannot dispatch in a clone', async () => {
  const good = await host.generate(input())
  generate.mockRejectedValue(new Error('Connection lost after sending'))
  const uncertain = input('lost-ack')
  await expect(host.generate(uncertain)).rejects.toThrow()
  const snapshot = join(env.home, 'images-snapshot.db')
  await env.db.backupTo(snapshot)
  const restored = openDb(snapshot)
  try {
    expect(results.readCaptured(restored, firstResultId(good))).toEqual(png)
    const clone = createImageGenerationHost({
      db: restored,
      agentId,
      teamId: env.teamId,
      turnId: 'restored-turn',
      signal: new AbortController().signal,
      env: () => config,
      assertActive: () => {},
      source,
      models,
    })
    await expect(clone.generate(uncertain)).rejects.toThrow('uncertain')
    expect(generate).toHaveBeenCalledTimes(2)
  } finally {
    restored.close()
  }
})

test('tool details persist multiple opaque Results, never raw image preview bytes', async () => {
  generate.mockResolvedValue(response(2))
  const request = input()
  const tool = ourToolToPiTool(imageGenerateTool(host.generate, sessionId))
  const output = await tool.execute(
    'call',
    { prompt: request.prompt, name: request.name },
    undefined,
    undefined,
    {} as Parameters<typeof tool.execute>[4],
  )
  expect(output.content.every((part) => part.type === 'text')).toBe(true)
  expect(output.details).toMatchObject({
    results: [{ resultId: expect.any(String) }, { resultId: expect.any(String) }],
  })
  // 0.87.1 widened tool-result details to a conditional JSON representation;
  // the tool's runtime output here is JSON by construction.
  const history = piMessagesToProviderView([
    {
      role: 'toolResult',
      toolCallId: 'call',
      toolName: 'image_generate',
      content: output.content,
      details: output.details,
      isError: false,
      timestamp: Date.now(),
    } as unknown as Parameters<typeof piMessagesToProviderView>[0][number],
  ])
  expect(history[0]?.results).toHaveLength(2)
  expect(history[0]?.images).toBeUndefined()
  expect(JSON.stringify(output)).not.toContain(png.toString('base64'))
})

test('bounded transport refuses another origin/path, redirects, oversized headers and streaming growth', async () => {
  const fetcher = vi.fn<typeof fetch>(async () => new Response('small'))
  const bounded = boundedImageFetch(fetcher)
  await expect(bounded('https://attacker.invalid/')).rejects.toThrow('endpoint')
  expect(fetcher).not.toHaveBeenCalled()
  const endpoint = 'https://openrouter.ai/api/v1/chat/completions'
  expect(await (await bounded(endpoint)).text()).toBe('small')
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error')
  fetcher.mockResolvedValueOnce(
    new Response('small', { headers: { 'content-length': String(IMAGE_RESPONSE_BYTES + 1) } }),
  )
  await expect(bounded(endpoint)).rejects.toThrow('byte limit')
  let cancelled = false
  let chunks = 0
  fetcher.mockResolvedValueOnce(
    new Response(
      new ReadableStream({
        pull(controller) {
          controller.enqueue(new Uint8Array(1024 * 1024))
          chunks++
        },
        cancel() {
          cancelled = true
        },
      }),
    ),
  )
  await expect(bounded(endpoint)).rejects.toThrow('byte limit')
  expect(cancelled).toBe(true)
  expect(chunks).toBeLessThan(44)
})
