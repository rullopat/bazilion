import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Agent, ResultListResponse } from '@bazilion/api-types'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { type MockLlm, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

// CT-05/06 D-lane slice: image-once oracle around current text/concept approval.
// The canned model executes the recipe's sequence, so this proves the PLUMBING
// (image_generate only runs when the turn's model calls it; every call is
// counted; Results are retained per call) — not model judgment about approval.
// That judgment is observed in the L lane (BAZ-066). Nothing is published.
const recipe = join(import.meta.dirname, '../../../examples/content-team')
// Real Agent turns are Linux-only until BAZ-057 (safe_reads_unavailable).
const linux = process.platform === 'linux'
const roles = ['coordinator', 'researcher', 'writer', 'designer'] as const
const directory = mkdtempSync(join(tmpdir(), 'baz064-approval-'))
const callsFile = join(directory, 'image-calls.jsonl')

let mock: MockLlm
let server: TestServer
let coordinatorId = ''

interface ImageCall {
  route: string
  model: string
  prompt: string
}

function imageCalls(): ImageCall[] {
  try {
    return readFileSync(callsFile, 'utf8')
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as ImageCall)
  } catch {
    return []
  }
}

beforeAll(async () => {
  mock = await startLmStudioMock()
  server = await startTestServer({
    LMSTUDIO_URL: mock.url,
    BAZILION_TEAM_POLICY_ENFORCEMENT: 'on',
    BAZILION_SCHEDULER: 'off',
    BAZILION_IMAGE_GENERATION: undefined,
    BAZILION_IMAGE_MODEL: undefined,
    OPENROUTER_API_KEY: 'fixture-image-key',
    BAZILION_IMAGE_TEST_CALLS: callsFile,
    NODE_OPTIONS: `--import=${new URL('./fixtures/image-fetch.mjs', import.meta.url).href}`,
  })
  await server.cli(['skill', 'import', '--from', join(recipe, 'skills')])
  for (const role of roles) {
    const created = await server.cli([
      'profile',
      'create',
      `content-${role}`,
      '--model',
      'lmstudio:test-model',
      '--skills-mode',
      'selected',
      '--skills',
      'content-preparation',
      '--skip-bootstrap',
      '--soul-file',
      join(recipe, 'profiles', `${role}.md`),
      '--agents-file',
      join(recipe, 'operating-rules.md'),
      '--tools-file',
      join(recipe, 'tools.md'),
    ])
    expect(created.exitCode, created.stderr).toBe(0)
  }
  await server.cli(['team-template', 'import', join(recipe, 'team-template.json'), '--apply'])
  const spawned = await (async () => {
    const response = await fetch(`${server.url}/api/team-templates/content-preparation/spawn`, {
      method: 'POST',
      headers: { authorization: `Bearer ${server.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        templateExpectedRevision: 1,
        teamId: 'content-approval',
        mode: 'initialize',
      }),
    })
    expect(response.status).toBe(201)
    return (await response.json()) as { agents: Agent[] }
  })()
  coordinatorId = spawned.agents.find((a) => a.profileId === 'content-coordinator')?.id ?? ''
  expect(coordinatorId).toMatch(/^[0-9a-f-]{36}$/)

  const genOn = await server.cli(['config', 'set', 'BAZILION_IMAGE_GENERATION', 'on'])
  expect(genOn.exitCode).toBe(0)
  const model = await server.cli([
    'config',
    'set',
    'BAZILION_IMAGE_MODEL',
    'google/gemini-3.1-flash-image',
  ])
  expect(model.exitCode).toBe(0)
}, 60_000)

afterAll(async () => {
  await server.stop()
  await mock.stop()
  rmSync(directory, { recursive: true, force: true })
})

function toolCall(name: string, args: unknown) {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${name}-${Math.random().toString(36).slice(2, 6)}`,
              type: 'function',
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

function reply(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }],
  }
}

async function chat(message: string): Promise<string> {
  const result = await server.cli(['agent', 'chat', coordinatorId, '--message', message])
  expect(result.exitCode, result.stderr || result.stdout).toBe(0)
  return result.stdout
}

async function results(): Promise<ResultListResponse> {
  const response = await fetch(`${server.url}/api/results?teamId=content-approval`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(response.status).toBe(200)
  return (await response.json()) as ResultListResponse
}

test.skipIf(!linux)(
  'zero image calls while drafting; generation only on the approval turn',
  async () => {
    // Turn 1: draft text and visual concept only.
    mock.push([reply('DRAFT_V1: orchid-care post text plus a visual concept description.')])
    const draft = await chat('Here is the confirmed brief; draft the post.')
    expect(draft).toContain('DRAFT_V1')
    expect(imageCalls()).toEqual([])

    // Turn 2: the operator's approval message; the model generates exactly once.
    mock.push([
      toolCall('image_generate', { prompt: 'Orchid illustration v1', name: 'orchid-v1' }),
      reply('IMAGE_V1_GENERATED_AND_PRESENTED'),
    ])
    const generated = await chat('Text and concept approved as-is; generate the image.')
    expect(generated).toContain('IMAGE_V1_GENERATED')
    const calls = imageCalls()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ route: 'openrouter', model: 'google/gemini-3.1-flash-image' })
    expect(calls[0]?.prompt).toContain('Orchid illustration v1')

    const list = await results()
    expect(list.results).toHaveLength(1)
    const image = list.results[0]
    expect(image?.imageModel).toBeTruthy()
    expect(image?.mimeType).toBe('image/png')
    expect(image?.byteLength).toBeGreaterThan(0)
    expect(image?.sha256).toMatch(/^[0-9a-f]{64}$/)
  },
)

test.skipIf(!linux)(
  'text-only correction does not regenerate; explicit rework is a new retained Result',
  async () => {
    // Turn 3: text-only edit after the image exists.
    mock.push([reply('DRAFT_V2: corrected one claim; image unchanged.')])
    const edited = await chat('Small wording correction, keep the image.')
    expect(edited).toContain('DRAFT_V2')
    expect(imageCalls()).toHaveLength(1)

    // Turn 4: explicit rework approval; a new generation, new Result.
    mock.push([
      toolCall('image_generate', {
        prompt: 'Orchid illustration v2 with the requested rework',
        name: 'orchid-v2',
      }),
      reply('IMAGE_V2_GENERATED_AND_PRESENTED'),
    ])
    const reworked = await chat('Approved; rework the image with this change.')
    expect(reworked).toContain('IMAGE_V2_GENERATED')
    const calls = imageCalls()
    expect(calls).toHaveLength(2)
    expect(calls[1]?.prompt).toContain('v2')

    const list = await results()
    expect(list.results).toHaveLength(2)
    expect(list.results.map((result) => result.name).sort()).toEqual([
      'orchid-v1.png',
      'orchid-v2.png',
    ])
    // The fixture returns identical bytes, so equal hashes are expected; what
    // matters is that both generations were separately captured and retained.
    expect(list.results.every((result) => result.imageModel && result.byteLength > 0)).toBe(true)
  },
)

async function download(resultId: string): Promise<Buffer> {
  const response = await fetch(`${server.url}/api/results/${resultId}/download`, {
    headers: { authorization: `Bearer ${server.token}` },
  })
  expect(response.status).toBe(200)
  return Buffer.from(await response.arrayBuffer())
}

test.skipIf(!linux)(
  'manual handoff delivers the exact approved file through the authorizer',
  async () => {
    const handoff = [
      '# Mastodon handoff — cycle 1',
      '',
      'Copy-ready text (approved DRAFT_V2):',
      'Orchids thrive on neglect and indirect light. #orchids',
      '',
      'Image: orchid-v2 (approved rework) — attach from the saved Result.',
      'Alt text (verify visually before posting): potted orchid on a windowsill.',
      'Sources: operator-supplied facts; no external claims retained.',
      'Intended time: manually chosen by the operator; Bazilion does not post.',
      'Composer steps: open the server, paste text, attach image, fill alt text, review, then stop.',
    ].join('\n')
    mock.push([
      toolCall('write', { path: 'handoff-cycle-1.md', content: handoff }),
      reply('HANDOFF_WRITTEN'),
    ])
    const written = await chat('Write the handoff file.')
    expect(written).toContain('HANDOFF_WRITTEN')

    mock.push([
      toolCall('deliver_file', { path: 'handoff-cycle-1.md' }),
      reply('HANDOFF_DELIVERED'),
    ])
    const delivered = await chat('Deliver it to me.')
    expect(delivered).toContain('HANDOFF_DELIVERED')

    const list = await results()
    const handoffResult = list.results.find((result) => result.name === 'handoff-cycle-1.md')
    if (!handoffResult) throw new Error('handoff Result was not retained')
    const bytes = await download(handoffResult.id)
    expect(bytes.toString('utf8')).toBe(handoff)
    // The handoff flow itself made no image call; generation count stays at 2.
    expect(imageCalls()).toHaveLength(2)
  },
  30_000,
)

test.skipIf(!linux)(
  'CT-14: a selected route without credentials fails honestly with no billing fallback',
  async () => {
    // Switch the selection to the OpenAI API-key route; this daemon has no
    // OPENAI_API_KEY, so the request must fail before any provider call —
    // without falling back to the enabled OpenRouter route.
    const switched = await server.cli([
      'config',
      'set',
      'BAZILION_IMAGE_MODEL',
      'openai:gpt-image-2',
    ])
    expect(switched.exitCode).toBe(0)
    const before = imageCalls().length

    mock.push([
      toolCall('image_generate', {
        prompt: 'Orchid illustration via the wrong route',
        name: 'orchid-wrong-route',
      }),
      reply('ROUTE_FAILURE_SURFACED'),
    ])
    const failed = await chat('Approved; generate via the OpenAI route.')
    expect(failed).toContain('ROUTE_FAILURE_SURFACED')
    // The OpenRouter route must not have been used as a fallback.
    expect(imageCalls().length).toBe(before)

    // Restoring the selection makes the next approved generation work again.
    const restored = await server.cli([
      'config',
      'set',
      'BAZILION_IMAGE_MODEL',
      'google/gemini-3.1-flash-image',
    ])
    expect(restored.exitCode).toBe(0)
    mock.push([
      toolCall('image_generate', { prompt: 'Orchid illustration v3', name: 'orchid-v3' }),
      reply('IMAGE_V3_GENERATED'),
    ])
    const recovered = await chat('Approved; generate via the usual route.')
    expect(recovered).toContain('IMAGE_V3_GENERATED')
    expect(imageCalls().length).toBe(before + 1)
    expect(imageCalls().every((call) => call.route === 'openrouter')).toBe(true)
  },
  60_000,
)
