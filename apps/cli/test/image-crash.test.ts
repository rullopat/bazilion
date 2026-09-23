import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from 'vitest'
import { openDb } from '../../daemon/src/core/db/client.ts'
import * as operations from '../../daemon/src/core/repos/image-generations.ts'
import * as results from '../../daemon/src/core/repos/results.ts'
import { extractAgentId } from './helpers.ts'
import { restartTestServer, startTestServer, type TestServer } from './server-fixture.ts'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII=',
  'base64',
)
async function until(check: () => boolean) {
  const deadline = Date.now() + 15000
  while (!check()) {
    if (Date.now() > deadline) throw new Error('Image crash barrier was not reached')
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
}

test.each([
  'before_provider_ack',
  'after_capture',
] as const)('real daemon SIGKILL at %s preserves image intent without replay or private disclosure', async (window) => {
  const directory = mkdtempSync(join(tmpdir(), 'baz059-crash-'))
  const marker = join(directory, 'committed.json')
  let imageRequests = 0
  const errors: string[] = []
  const fake = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const bytes of request) raw += bytes
      const body = JSON.parse(raw)
      if (request.url === '/image') {
        expect(request.headers.authorization).toBe('Bearer crash-fixture-key')
        expect(body.model).toBe('gpt-image-2')
        expect(body.prompt).toBe('Crash boundary illustration')
        imageRequests++ // External side-effect oracle survives the daemon's death.
        if (window === 'before_provider_ack') return
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }))
        return
      }
      const afterTool = body.messages.some((message: { role: string }) => message.role === 'tool')
      const delta = afterTool
        ? { role: 'assistant', content: 'Stopped after interrupted image operation.' }
        : {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'crash-image-call',
                type: 'function',
                function: {
                  name: 'image_generate',
                  arguments: JSON.stringify({
                    prompt: 'Crash boundary illustration',
                    name: 'crash-image',
                  }),
                },
              },
            ],
          }
      response.writeHead(200, { 'content-type': 'text/event-stream' })
      response.end(
        `data: ${JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: afterTool ? 'stop' : 'tool_calls' }] })}\n\ndata: [DONE]\n\n`,
      )
    } catch (error) {
      errors.push(String(error))
      response.writeHead(500)
      response.end('fixture failed')
    }
  })
  let server: TestServer | undefined
  try {
    await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve))
    const address = fake.address()
    if (!address || typeof address === 'string') throw new Error('Missing fixture port')
    const daemonEnv = {
      LMSTUDIO_URL: `http://127.0.0.1:${address.port}/v1`,
      OPENAI_API_KEY: 'crash-fixture-key',
      BAZILION_IMAGE_GENERATION: 'on',
      BAZILION_IMAGE_MODEL: 'openai:gpt-image-2',
      BAZILION_IMAGE_CRASH_UPSTREAM: `http://127.0.0.1:${address.port}/image`,
      BAZILION_IMAGE_CRASH_WINDOW: window,
      BAZILION_IMAGE_CRASH_MARKER: marker,
      NODE_OPTIONS: `--import=${new URL('./fixtures/image-crash-fetch.mjs', import.meta.url).href}`,
      BAZILION_BASH_SANDBOX: 'off',
      BAZILION_SCHEDULER: 'off',
      BAZILION_PUBLIC_ORIGIN: '',
      TELEGRAM_BOT_TOKEN: '',
    }
    server = await startTestServer(daemonEnv)
    const profile = await server.cli([
      'profile',
      'create',
      'crash',
      '--model',
      'lmstudio:test-model',
    ])
    expect(profile.exitCode).toBe(0)
    const agent = extractAgentId(
      (await server.cli(['agent', 'spawn', '--profile', 'crash'])).stdout,
    )
    const chat = promisify(execFile)(
      process.execPath,
      [
        '--import',
        import.meta.resolve('tsx/esm'),
        fileURLToPath(new URL('../src/index.ts', import.meta.url)),
        'agent',
        'chat',
        agent,
        '--message',
        'Generate one illustration.',
      ],
      {
        cwd: directory,
        env: {
          ...process.env,
          BAZILION_HOME: server.home,
          BAZILION_SERVER: server.url,
          BAZILION_TOKEN: server.token,
        },
      },
    ).catch((error: { stdout?: string; stderr?: string }) => ({
      stdout: error.stdout ?? '',
      stderr: error.stderr ?? '',
    }))
    await until(() => (window === 'before_provider_ack' ? imageRequests === 1 : existsSync(marker)))
    await server.stop({ signal: 'SIGKILL', keepHome: true })
    const interrupted = await chat
    expect(interrupted.stdout).not.toContain('Saved 1 image')
    expect(errors).toEqual([])
    expect(imageRequests).toBe(1)

    let db = openDb(join(server.home, 'bazilion.db'))
    let operation: operations.ImageOperation
    let resultId: string | undefined
    try {
      const row = db.raw
        .query<operations.ImageOperation & { outcome: string }, []>(
          `SELECT agent_id AS agentId, team_id AS teamId, session_id AS sessionId, tool_call_id AS toolCallId, turn_id AS turnId, request_sha256 AS requestSha256, model, outcome FROM image_generations`,
        )
        .get()
      if (!row) throw new Error('Durable intent missing after SIGKILL')
      operation = row
      expect(row.outcome).toBe(window === 'after_capture' ? 'completed' : 'uncertain')
      const ids = operations.resultIds(db, row)
      expect(ids).toHaveLength(window === 'after_capture' ? 1 : 0)
      resultId = ids[0]
      if (resultId) {
        expect(results.readCaptured(db, resultId)).toEqual(png)
        expect(results.getReceipt(db, resultId)?.releasedAt).toBeNull()
      }
    } finally {
      db.close()
    }

    server = await restartTestServer(server, daemonEnv)
    // Boot/recovery must not create a new provider operation or invent a delivery.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(imageRequests).toBe(1)
    db = openDb(join(server.home, 'bazilion.db'))
    try {
      if (window === 'before_provider_ack') {
        expect(() => operations.admit(db, operation)).toThrow(
          'will not be automatically regenerated',
        )
      } else {
        expect(operations.admit(db, operation)).toBe('completed')
        if (!resultId) throw new Error('Missing capture id')
        // Existing Results retention reclaims abandoned, never-authorized bytes; tombstones prevent regeneration.
        expect(results.getReceipt(db, resultId)).toMatchObject({ id: resultId, releasedAt: null })
        expect(typeof results.getReceipt(db, resultId)?.deletedAt).toBe('number')
        expect(() => results.readCaptured(db, resultId)).toThrow('unavailable')
        const preview = await fetch(`${server.url}/api/results/${resultId}/preview`, {
          headers: { authorization: `Bearer ${server.token}` },
        })
        expect(preview.status).toBe(404)
      }
      expect(results.listReleased(db).total).toBe(0)
    } finally {
      db.close()
    }
    expect(imageRequests).toBe(1)
  } finally {
    await server?.stop()
    fake.closeAllConnections()
    await new Promise<void>((resolve) => fake.close(() => resolve()))
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)
