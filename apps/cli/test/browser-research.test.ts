// T16 — deterministic daemon -> worker -> browser IPC research journey.
//
// OPT-IN because this lane launches the host's installed Chromium:
// BAZILION_TEST_BROWSER=1 pnpm vitest run apps/cli/test/browser-research.test.ts
// A canned model drives observed refs; this proves plumbing and fixture behavior,
// not live-model research judgment, real search-engine access or site reliability.

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { resolvePaths } from '../../daemon/src/core/paths.ts'
import { resolveBrowserExecutable } from '../../daemon/src/lib/browser/executable.ts'
import { ownedBrowserProcesses } from '../../daemon/test/fixtures/browser-managed.ts'
import type { CannedResponse, MockLlm } from './fixtures/mock-lmstudio.ts'
import { sseFromCanned, startLmStudioMock } from './fixtures/mock-lmstudio.ts'
import { startTestServer, type TestServer } from './server-fixture.ts'

const gated = process.env.BAZILION_TEST_BROWSER === '1'
const executable = resolveBrowserExecutable(process.env.BROWSER_EXECUTABLE_PATH)
if (gated && !executable.ok) {
  throw new Error(
    `BAZILION_TEST_BROWSER=1 requires a provisioned supported browser: ${executable.remedy}`,
  )
}
const browserExecutablePath = executable.ok && executable.candidate ? executable.candidate.path : ''
if (!gated)
  console.log('[browser-research] set BAZILION_TEST_BROWSER=1 to run installed-browser journey')

const run = gated ? describe : describe.skip
const searchCounts = new Map<string, number>()
const searchRequestUrls: URL[] = []
const plantedSecret = 'BAZILION_TEST_SEARCH_KEY=never-reach-browser'
let uncertainHits = 0
let fixture: ReturnType<typeof createServer>
let fixtureUrl = ''
let mock: MockLlm
let server: TestServer
let agentId = ''
let callId = 0

const searchHtml = `<!doctype html><html><body>
  <main><h1>Research search</h1>
    <form action="/results" method="get">
      <label for="q">Search terms</label><input id="q" name="q">
      <button type="submit">Search</button>
    </form>
  </main>
</body></html>`
const changedSearchHtml = `<!doctype html><html><body>
  <header><h1>Source finder</h1></header>
  <aside><section><form action="/results" method="get">
    <fieldset><legend>Find sources</legend><input aria-label="Research phrase" name="q">
      <button type="submit">Find sources</button></fieldset>
  </form></section></aside>
</body></html>`

function response(tool: string, args: Record<string, unknown>): CannedResponse {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: `call-${tool}-${++callId}`,
              type: 'function',
              function: { name: tool, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  }
}

function final(content: string): CannedResponse {
  return { choices: [{ message: { role: 'assistant', content }, finish_reason: 'stop' }] }
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map((part) => (part && typeof part === 'object' && 'text' in part ? String(part.text) : ''))
      .join('\n')
  }
  return ''
}

function lastToolResult(messages: Array<Record<string, unknown>>): string {
  const tool = messages.filter((message) => message.role === 'tool').at(-1)
  return extractText(tool?.content)
}

function observationId(text: string): string {
  const id = text.match(/Observation: ([^\s]+)/)?.[1]
  if (!id)
    throw new Error(`mock model could not find observationId in tool result: ${text.slice(0, 500)}`)
  return id
}

function refFor(text: string, expression: RegExp): string {
  const ref = text.match(expression)?.[1]
  if (!ref)
    throw new Error(`mock model could not find observed ref in tool result: ${text.slice(0, 700)}`)
  return ref
}

function answerResearch(req: IncomingMessage, res: ServerResponse): void {
  void (async () => {
    let raw = ''
    for await (const chunk of req) raw += String(chunk)
    const body = JSON.parse(raw) as { messages?: Array<Record<string, unknown>> }
    const messages = body.messages ?? []
    const latestUser = [...messages].reverse().find((message) => message.role === 'user')
    const prompt = extractText(latestUser?.content)
    const scenario = prompt.match(/SCENARIO:([a-z-]+)/)?.[1] ?? 'unknown'
    const step = routeSteps.get(scenario) ?? 0
    routeSteps.set(scenario, step + 1)
    const previous = lastToolResult(messages)
    let answer: CannedResponse

    if (step === 0) {
      answer = response('browser_status', {})
    } else if (step === 1) {
      answer = response('browser_navigate', { url: `${fixtureUrl}/search?scenario=${scenario}` })
    } else if (step === 2) {
      const ref = refFor(previous, /textbox[^\n]*\[ref=(e\d+)\]/i)
      const query = scenario === 'changed-layout' ? 'layout research' : scenario
      answer = response('browser_type', {
        ref,
        observationId: observationId(previous),
        text: query,
        submit: true,
      })
    } else if (step === 3) {
      if (/CAPTCHA|unusual traffic|challenge detected/i.test(previous)) {
        answer = final(
          'The search page presented a blocker, so I stopped without retrying or bypassing it.',
        )
      } else {
        const ref = refFor(previous, /link [^\n]*\[ref=(e\d+)\]/i)
        answer = response('browser_click', { ref, observationId: observationId(previous) })
      }
    } else if (scenario === 'uncertain' && step === 4) {
      expect(previous).toContain('The action may or may not have taken effect')
      // Verify by observing, never replay the navigation after its timeout.
      answer = response('browser_snapshot', {})
    } else if (scenario === 'uncertain' && step === 5) {
      answer = final('The source navigation was uncertain; I did not repeat the action.')
    } else if (step === 4) {
      expect(previous).toContain('Orchid source article')
      answer = response('browser_tabs', { op: 'new', url: `${fixtureUrl}/article?page=1` })
    } else if (step === 5) {
      answer = response('browser_tabs', { op: 'list' })
    } else if (step === 6) {
      expect(previous).toContain('tab-2')
      const tabId = previous.match(/\b(tab-\d+)\b(?=\s+http[^\n]*\/article)/)?.[1]
      if (!tabId) throw new Error(`mock model could not find article tab in: ${previous}`)
      answer = response('browser_tabs', { op: 'select', tabId })
    } else if (step === 7) {
      const ref = refFor(previous, /link "Next page"[^\n]*\[ref=(e\d+)\]/i)
      answer = response('browser_click', { ref, observationId: observationId(previous) })
    } else if (step === 8) {
      expect(previous).toContain('Page two: orchid roots need to dry between waterings.')
      answer = final(
        `Orchid roots should dry between waterings, and the guide recommends indirect light. Source: ${fixtureUrl}/article?page=2`,
      )
    } else {
      answer = final(`Stopped after ${scenario}; no further browser action was issued.`)
    }
    sseFromCanned(res, answer)
  })().catch((error) => {
    res.writeHead(500).end(error instanceof Error ? error.message : String(error))
  })
}

const routeSteps = new Map<string, number>()

async function spawnBrowserAgent(): Promise<string> {
  const profile = await server.cli([
    'profile',
    'create',
    'browser-research',
    '--model',
    'lmstudio:test-model',
  ])
  expect(profile.exitCode, profile.stderr).toBe(0)
  const spawned = await server.cli(['agent', 'spawn', '--profile', 'browser-research'])
  expect(spawned.exitCode, spawned.stderr).toBe(0)
  const id = spawned.stdout.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0]
  expect(id, spawned.stdout).toBeTruthy()
  return id as string
}

run('offline managed-browser research journey (T16)', () => {
  beforeAll(async () => {
    mock = await startLmStudioMock()
    fixture = createServer((req, res) => {
      const url = new URL(req.url ?? '/', fixtureUrl || 'http://127.0.0.1')
      if (url.pathname === '/search') {
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            url.searchParams.get('scenario') === 'changed-layout' ? changedSearchHtml : searchHtml,
          )
        return
      }
      if (url.pathname === '/results') {
        const q = url.searchParams.get('q') ?? ''
        searchRequestUrls.push(url)
        searchCounts.set(q, (searchCounts.get(q) ?? 0) + 1)
        if (q === 'blocker') {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end(
              '<main><h1>Unusual traffic</h1><p>Challenge detected. CAPTCHA required.</p></main>',
            )
          return
        }
        if (q === 'uncertain') {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end(
              `<main><h1>Search results</h1><a href="${fixtureUrl}/uncertain">Open uncertain source</a></main>`,
            )
          return
        }
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(
            `<main><h1>Search results for ${q}</h1><p>Unverified snippet: water the orchid hourly.</p><a href="${fixtureUrl}/article?page=1">Orchid source article</a></main>`,
          )
        return
      }
      if (url.pathname === '/article') {
        const page = url.searchParams.get('page') ?? '1'
        if (page === '2') {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end(
              '<main><h1>Orchid source article</h1><p>Page two: orchid roots need to dry between waterings.</p><a href="/article?page=1">Previous page</a></main>',
            )
        } else {
          res
            .writeHead(200, { 'content-type': 'text/html' })
            .end(
              '<main><h1>Orchid source article</h1><p>Page one: orchids prefer bright indirect light.</p><p>Read the full guide before summarizing.</p><a href="/article?page=2">Next page</a></main>',
            )
        }
        return
      }
      if (url.pathname === '/uncertain') {
        uncertainHits++
        // The endpoint observed the request but never completes the response.
        // Playwright's click times out; the page may nevertheless have acted.
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<!doctype html><main><h1>Request received</h1><p>Waiting for confirmation…</p>')
        const release = setTimeout(() => res.end('</main>'), 35_000)
        res.on('close', () => clearTimeout(release))
        return
      }
      res.writeHead(404).end('not found')
    })
    await new Promise<void>((resolve) => fixture.listen(0, '127.0.0.1', resolve))
    fixtureUrl = `http://127.0.0.1:${(fixture.address() as { port: number }).port}`
    server = await startTestServer({
      LMSTUDIO_URL: mock.url,
      BROWSER_ENABLED: 'true',
      BROWSER_HEADLESS: 'true',
      BROWSER_EXECUTABLE_PATH: browserExecutablePath,
      BROWSER_ALLOW_PRIVATE_NETWORK: undefined,
      BAZILION_TEST_SEARCH_KEY: 'never-reach-browser',
    })
    agentId = await spawnBrowserAgent()
  }, 120_000)

  afterAll(async () => {
    if (agentId) await server.cli(['agent', 'browser', 'stop', agentId]).catch(() => {})
    await server?.stop()
    await mock?.stop()
    await new Promise<void>((resolve) => fixture?.close(() => resolve()))
  }, 60_000)

  test('uses the real proxy, then researches through refs/tabs and stops at blockers or uncertainty', async () => {
    // First launch with the default private-network denial. The call only opens
    // an empty tab; inspect Chromium's real process arguments to prove the
    // production validating proxy is active without making an external request.
    mock.push([response('browser_tabs', { op: 'new' }), final('The empty tab is ready.')])
    const proxyTurn = await server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      'SCENARIO:proxy Open an empty managed browser tab.',
    ])
    expect(proxyTurn.exitCode, proxyTurn.stderr).toBe(0)
    const paths = resolvePaths(server.home)
    const profileDir = `${paths.browserDir(agentId)}/user-data`
    const processes = ownedBrowserProcesses(profileDir)
    const root = processes.find((process) => process.kind === 'root')
    expect(root, 'managed Chromium root process').toBeTruthy()
    expect(root?.argv.some((arg) => arg.startsWith('--proxy-server=http://127.0.0.1:'))).toBe(true)
    expect(root?.argv).toContain('--proxy-bypass-list=<-loopback>')
    expect(root?.environ.join('\n')).not.toContain(plantedSecret)

    const stopped = await server.cli(['agent', 'browser', 'stop', agentId])
    expect(stopped.exitCode, stopped.stderr).toBe(0)
    const privateConfig = await server.cli([
      'config',
      'set',
      'BROWSER_ALLOW_PRIVATE_NETWORK',
      'true',
    ])
    expect(privateConfig.exitCode, privateConfig.stderr).toBe(0)

    mock.setFallback(answerResearch)
    const successful = await server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      `SCENARIO:baseline Search for orchids at ${fixtureUrl}/search?scenario=baseline, open the source in a new tab, select it, read every page and cite only the article URL.`,
    ])
    expect(successful.exitCode, successful.stderr).toBe(0)
    expect(successful.stdout).toContain('Orchid roots should dry between waterings')
    expect(successful.stdout).toContain(`${fixtureUrl}/article?page=2`)
    expect(successful.stdout).not.toContain('water the orchid hourly')
    expect(searchCounts.get('baseline')).toBe(1)

    const changed = await server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      `SCENARIO:changed-layout Search for changed layout at ${fixtureUrl}/search?scenario=changed-layout and cite the source after reading it.`,
    ])
    expect(changed.exitCode, changed.stderr).toBe(0)
    expect(changed.stdout).toContain(`${fixtureUrl}/article?page=2`)
    expect(searchCounts.get('layout research')).toBe(1)

    const blocked = await server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      `SCENARIO:blocker Search for blocker at ${fixtureUrl}/search?scenario=blocker. Stop if challenged; do not retry or bypass.`,
    ])
    expect(blocked.exitCode, blocked.stderr).toBe(0)
    expect(blocked.stdout).toContain('stopped without retrying')
    expect(searchCounts.get('blocker')).toBe(1)

    const uncertain = await server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      `SCENARIO:uncertain Search for uncertain at ${fixtureUrl}/search?scenario=uncertain. If navigation is uncertain, observe and do not repeat it.`,
    ])
    expect(uncertain.exitCode, uncertain.stderr).toBe(0)
    expect(uncertain.stdout).toContain('did not repeat the action')
    expect(searchCounts.get('uncertain')).toBe(1)
    expect(uncertainHits, uncertain.stdout).toBe(1)
    expect(searchRequestUrls.length).toBe(4)
    for (const url of searchRequestUrls) {
      expect([...url.searchParams.keys()]).toEqual(['q'])
      expect(url.searchParams.has('key')).toBe(false)
      expect(url.searchParams.has('api_key')).toBe(false)
    }
  }, 180_000)

  test('cancellation settles a worker while its provider request is pending', async () => {
    let signalRequest!: () => void
    const providerStarted = new Promise<void>((resolve) => {
      signalRequest = resolve
    })
    mock.setFallback((_req: IncomingMessage, _res: ServerResponse) => {
      signalRequest()
      // Leave the provider response open until the worker's AbortSignal fires.
    })
    const chatPromise = server.cli([
      'agent',
      'chat',
      agentId,
      '--message',
      'SCENARIO:cancel wait for the pending response.',
    ])
    await Promise.race([
      providerStarted,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('worker did not reach the provider request')), 15_000),
      ),
    ])
    const cancel = await server.cli(['agent', 'cancel', agentId])
    expect(cancel.exitCode, cancel.stderr).toBe(0)
    const chat = await Promise.race([
      chatPromise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error('cancelled browser-research turn did not settle')),
          10_000,
        ),
      ),
    ])
    expect(chat.stdout + chat.stderr).toMatch(/cancelled|aborted/i)
  }, 30_000)
})
