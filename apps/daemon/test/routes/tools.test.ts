import type { ServiceCard, ServiceFieldState, ToolsResponse } from '@bazilion/api-types'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import {
  openConfig,
  openSecrets,
  providerModelRepo,
  providerStateRepo,
} from '../../src/core/index.ts'
import { SERVICES } from '../../src/core/services.ts'
import { effectiveValue, normalizeSetting } from '../../src/lib/setting-fields.ts'
import { configRouter } from '../../src/routes/config.ts'
import { makeTestEnv, type TestEnv } from '../core/helpers.ts'

let env: TestEnv
vi.mock('../../src/lib/ctx.ts', () => ({
  getCtx: () => ({ db: env.db, paths: env.paths, authToken: 'test-only' }),
}))
// Docker is whatever the test says it is, not what this machine has.
const docker = vi.hoisted(() => ({
  check: vi.fn(async (): Promise<{ ok: true } | { ok: false; error: string }> => ({ ok: true })),
}))
vi.mock('../../src/runtime/shell/docker.ts', async (original) => ({
  ...(await original<typeof import('../../src/runtime/shell/docker.ts')>()),
  checkDockerImage: docker.check,
}))

const TOOL_SETTINGS = SERVICES.filter((service) => service.category === 'tool').flatMap((tool) =>
  tool.fields.map((field) => field.envVar),
)

beforeEach(() => {
  env = makeTestEnv()
  for (const name of [...TOOL_SETTINGS, 'OPENAI_API_KEY']) vi.stubEnv(name, undefined)
  docker.check.mockResolvedValue({ ok: true })
})
afterEach(() => {
  env.cleanup()
  vi.unstubAllEnvs()
})

const json = (method: string, body: unknown) => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})
const tools = async () => (await (await configRouter.request('/tools')).json()) as ToolsResponse
const tool = async (id: string) => {
  const found = (await tools()).tools.find((card) => card.id === id)
  if (!found) throw new Error(`no tool ${id}`)
  return found
}
const field = (card: ServiceCard, envVar: string) =>
  card.fields.find((entry) => entry.envVar === envVar) as ServiceFieldState
const save = (values: Record<string, string>) =>
  configRouter.request('/fields', json('PUT', { values }))
const set = (envVar: string, value: string) =>
  configRouter.request(`/fields/${envVar}`, json('PUT', { value }))
const optionNote = (card: ServiceCard, envVar: string, value: string) => {
  const input = field(card, envVar).input
  return input.type === 'choice'
    ? input.options.find((option) => option.value === value)?.note
    : undefined
}

test('four tools on a new home, each with what it is doing', async () => {
  const { tools: cards, functions } = await tools()
  expect(cards.map((card) => [card.id, card.displayName, card.state])).toEqual([
    // No key, no address and no OpenAI or ChatGPT model: nothing can search.
    ['web-search', 'Web search', { label: 'Nothing to search with', tone: 'warning' }],
    ['web-pages', 'Web pages', { label: 'Built-in reader', tone: 'on' }],
    ['browser', 'Browser', { label: 'On: a browser per Agent', tone: 'on' }],
    ['commands', 'Commands', { label: 'Runs on this computer', tone: 'on' }],
  ])
  expect(functions.map((card) => card.id)).toEqual(['image-generation', 'command-review'])
  // Nothing is stored, and every setting says what is in effect.
  const browser = cards.find((card) => card.id === 'browser') as ServiceCard
  expect(browser.fields.every((entry) => !entry.set)).toBe(true)
  expect(field(browser, 'BROWSER_ENABLED')).toMatchObject({
    input: { type: 'switch', on: 'true', off: 'false', default: true },
    effective: 'true',
  })
  // "Show the browser window" is the headless setting the other way round.
  expect(field(browser, 'BROWSER_HEADLESS')).toMatchObject({
    label: 'Show the browser window',
    input: { type: 'switch', on: 'false', off: 'true', default: false },
    effective: 'true',
    advanced: true,
  })
  expect(field(browser, 'BROWSER_IDLE_MS')).toMatchObject({
    input: { type: 'number', default: 900_000, unit: 'minutes', scale: 60_000 },
    effective: '900000',
  })
})

test('a value is checked before it is stored', async () => {
  const refused = async (envVar: string, value: string) => {
    const response = await set(envVar, value)
    expect(response.status, `${envVar}=${value}`).toBe(400)
    return ((await response.json()) as { error: string }).error
  }
  expect(await refused('BROWSER_ENABLED', 'maybe')).toBe('BROWSER_ENABLED must be true or false')
  expect(await refused('BAZILION_BASH_APPROVAL', 'true')).toBe(
    'BAZILION_BASH_APPROVAL must be one of: off, dangerous, review',
  )
  expect(await refused('BAZILION_WEB_SEARCH_ROUTE', 'google')).toBe(
    'BAZILION_WEB_SEARCH_ROUTE must be one of: auto, brave, searxng, tavily, exa, native, off',
  )
  expect(await refused('BROWSER_IDLE_MS', '15 minutes')).toBe(
    'BROWSER_IDLE_MS must be a whole number',
  )
  expect(await refused('BROWSER_IDLE_MS', '500')).toBe(
    'BROWSER_IDLE_MS must be from 60000 to 86400000',
  )
  expect(await refused('BROWSER_MAX_SESSIONS', '0')).toBe(
    'BROWSER_MAX_SESSIONS must be from 1 to 64',
  )
  expect(await refused('SEARXNG_URL', 'searx.example.com')).toContain('http:// or https://')
  expect(await refused('BROWSER_EXECUTABLE_PATH', 'chromium')).toContain('full path')
  expect(await refused('BAZILION_BASH_SANDBOX_IMAGE', 'debian bookworm')).toContain(
    'not a Docker image name',
  )
  expect(openConfig(env.db).getAll()).toEqual({})

  // Yes and no in their usual spellings are stored as true and false.
  expect(((await (await set('BROWSER_ENABLED', 'No')).json()) as ServiceFieldState).value).toBe(
    'false',
  )
  expect(((await (await set('BROWSER_ATTACH', 'yes')).json()) as ServiceFieldState).value).toBe(
    'true',
  )
  expect((await set('BROWSER_MAX_SESSIONS', '8')).status).toBe(200)
  expect((await set('SEARXNG_URL', ' https://searx.example.com ')).status).toBe(200)
  expect(openConfig(env.db).getAll()).toEqual({
    BROWSER_ENABLED: 'false',
    BROWSER_ATTACH: 'true',
    BROWSER_MAX_SESSIONS: '8',
    SEARXNG_URL: 'https://searx.example.com',
  })
  // An empty value clears a setting, back to its default.
  expect((await set('BROWSER_ENABLED', '')).status).toBe(200)
  expect(field(await tool('browser'), 'BROWSER_ENABLED')).toMatchObject({
    set: false,
    effective: 'true',
  })
})

test('a card is saved whole or not at all', async () => {
  const mixed = await save({
    BAZILION_WEB_SEARCH_ROUTE: 'brave',
    BRAVE_API_KEY: 'BSA-private-key-123',
    SEARXNG_URL: 'not an address',
    NOT_A_SETTING: 'x',
  })
  expect(mixed.status).toBe(400)
  expect(((await mixed.json()) as { errors: Record<string, string> }).errors).toEqual({
    SEARXNG_URL: 'SEARXNG_URL must be an address that starts with http:// or https://',
    NOT_A_SETTING: 'unknown setting: NOT_A_SETTING',
  })
  expect(openConfig(env.db).getAll()).toEqual({})
  expect(openSecrets(env.db, 'test-only').getAll()).toEqual({})
  expect((await configRouter.request('/fields', json('PUT', { values: ['x'] }))).status).toBe(400)

  const saved = await save({
    BAZILION_WEB_SEARCH_ROUTE: 'brave',
    BRAVE_API_KEY: ' BSA-private-key-123 ',
  })
  expect(saved.status).toBe(200)
  const body = JSON.stringify(await saved.json())
  expect(body).toContain('"preview":"BSA-pr…"')
  expect(body).not.toContain('BSA-private-key-123')
  expect(openSecrets(env.db, 'test-only').get('BRAVE_API_KEY')).toBe('BSA-private-key-123')
  expect(JSON.stringify(await tools())).not.toContain('BSA-private-key-123')
  expect((await tool('web-search')).state).toEqual({ label: 'Using Brave', tone: 'on' })
})

test('web search says what is in effect and what each choice would meet', async () => {
  let search = await tool('web-search')
  expect(optionNote(search, 'BAZILION_WEB_SEARCH_ROUTE', 'auto')).toMatchObject({
    tone: 'warning',
    text: expect.stringContaining('save a Brave, Tavily or Exa key or a SearXNG address'),
  })
  expect(optionNote(search, 'BAZILION_WEB_SEARCH_ROUTE', 'brave')).toEqual({
    text: 'No Brave API key is saved yet.',
    tone: 'warning',
  })
  expect(optionNote(search, 'BAZILION_WEB_SEARCH_ROUTE', 'off')).toBeUndefined()

  await save({ BAZILION_WEB_SEARCH_ROUTE: 'searxng' })
  expect((await tool('web-search')).state).toEqual({ label: 'Needs an address', tone: 'warning' })
  await save({ SEARXNG_URL: 'https://searx.example.com' })
  search = await tool('web-search')
  expect(search.state).toEqual({ label: 'Using SearXNG', tone: 'on' })
  expect(optionNote(search, 'BAZILION_WEB_SEARCH_ROUTE', 'searxng')).toBeUndefined()
  expect(optionNote(search, 'BAZILION_WEB_SEARCH_ROUTE', 'auto')).toEqual({
    text: 'Now: SearXNG.',
    tone: 'ok',
  })

  await save({ BAZILION_WEB_SEARCH_ROUTE: 'tavily' })
  expect((await tool('web-search')).state).toEqual({ label: 'Needs a Tavily key', tone: 'warning' })
  await save({ TAVILY_API_KEY: 'tvly-test' })
  expect((await tool('web-search')).state).toEqual({ label: 'Using Tavily', tone: 'on' })
  await save({ BAZILION_WEB_SEARCH_ROUTE: 'exa', EXA_API_KEY: 'exa-test' })
  expect((await tool('web-search')).state).toEqual({ label: 'Using Exa', tone: 'on' })

  await save({ BAZILION_WEB_SEARCH_ROUTE: 'off' })
  expect((await tool('web-search')).state).toEqual({ label: 'Off', tone: 'off' })

  // An OpenAI model in Chat brings its own search.
  await save({ BAZILION_WEB_SEARCH_ROUTE: 'native' })
  expect((await tool('web-search')).state?.tone).toBe('warning')
  openSecrets(env.db, 'test-only').set('OPENAI_API_KEY', 'sk-test')
  providerStateRepo.setEnabled(env.db, 'openai', true)
  providerModelRepo.replace(env.db, 'openai', ['gpt-6-luna'])
  expect((await tool('web-search')).state).toEqual({
    label: 'Using the model’s own search',
    tone: 'on',
  })
})

test('commands say where they run, and whether Docker is ready before it is chosen', async () => {
  docker.check.mockResolvedValue({
    ok: false,
    error: 'Error response from daemon: No such image: debian:bookworm-slim',
  })
  let commands = await tool('commands')
  // Still on this computer, so nothing is wrong; the Docker choice says what it would meet.
  expect(commands.state).toEqual({ label: 'Runs on this computer', tone: 'on' })
  expect(commands.note).toBeUndefined()
  expect(optionNote(commands, 'BAZILION_BASH_SANDBOX', 'docker')).toEqual({
    tone: 'warning',
    text: 'Docker is running but does not have the image debian:bookworm-slim. Bazilion never pulls one: run docker pull debian:bookworm-slim',
  })
  // Docker's other answers, in the same plain words.
  const meets = async (error: string) => {
    docker.check.mockResolvedValue({ ok: false, error })
    return optionNote(await tool('commands'), 'BAZILION_BASH_SANDBOX', 'docker')?.text
  }
  expect(await meets('Docker is not installed: no `docker` executable on PATH')).toBe(
    'Docker is not installed on this computer.',
  )
  expect(
    await meets(
      'Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?',
    ),
  ).toBe('Docker is installed but not running. Start it, then open this page again.')
  expect(await meets('permission denied')).toBe('Docker could not be used: permission denied')

  await save({ BAZILION_BASH_SANDBOX: 'docker', BAZILION_BASH_APPROVAL: 'dangerous' })
  commands = await tool('commands')
  expect(commands.state).toEqual({ label: 'Docker is not ready', tone: 'warning' })
  expect(commands.note).toBe('Agents cannot run commands until this is put right.')

  docker.check.mockResolvedValue({ ok: true })
  await save({ BAZILION_BASH_SANDBOX_IMAGE: 'node:26-slim' })
  commands = await tool('commands')
  expect(docker.check).toHaveBeenLastCalledWith('node:26-slim')
  expect(commands.state).toEqual({ label: 'Runs in Docker, asks first', tone: 'on' })
  expect(optionNote(commands, 'BAZILION_BASH_SANDBOX', 'docker')).toEqual({
    text: 'Docker is running and has the image node:26-slim.',
    tone: 'ok',
  })
})

test('the browser and page reader follow their settings', async () => {
  await save({
    BROWSER_ATTACH: 'true',
    BROWSER_IDLE_MS: '300000',
    FIRECRAWL_API_KEY: 'fc-key-12345',
  })
  const browser = await tool('browser')
  expect(browser.state).toEqual({ label: 'On: your running Chrome', tone: 'on' })
  expect(field(browser, 'BROWSER_IDLE_MS')).toMatchObject({ value: '300000', effective: '300000' })
  expect((await tool('web-pages')).state?.label).toBe('Built-in reader, then Firecrawl')
  await save({ BROWSER_ENABLED: 'false' })
  expect((await tool('browser')).state).toEqual({ label: 'Off', tone: 'off' })
})

test('the daemon’s environment wins over what is stored, and the page says so', async () => {
  await save({ BROWSER_HEADLESS: 'true', BAZILION_WEB_SEARCH_ROUTE: 'off' })
  vi.stubEnv('BROWSER_HEADLESS', 'no')
  vi.stubEnv('BAZILION_WEB_SEARCH_ROUTE', 'brave')
  vi.stubEnv('BRAVE_API_KEY', 'BSA-from-the-environment')
  const browser = await tool('browser')
  expect(field(browser, 'BROWSER_HEADLESS')).toMatchObject({
    value: 'true',
    effective: 'false',
    environment: true,
  })
  expect(field(browser, 'BROWSER_ENABLED').environment).toBeUndefined()
  const search = await tool('web-search')
  expect(search.state).toEqual({ label: 'Using Brave', tone: 'on' })
  expect(field(search, 'BRAVE_API_KEY')).toMatchObject({ set: false, environment: true })
  expect(JSON.stringify(search)).not.toContain('BSA-from-the-environment')
})

test('a value stored before values were checked is flagged when the daemon cannot use it', async () => {
  const config = openConfig(env.db)
  config.set('BROWSER_MAX_SESSIONS', 'abc')
  config.set('BROWSER_ENABLED', 'no')
  config.set('BROWSER_IDLE_MS', '30000')
  config.set('BAZILION_BASH_APPROVAL', 'Dangerous')
  const browser = await tool('browser')
  // Not a number: the default applies, and the page offers to replace it.
  expect(field(browser, 'BROWSER_MAX_SESSIONS')).toMatchObject({
    value: 'abc',
    effective: '4',
    unusable: true,
  })
  // Another spelling of "no", and a number below what the page offers: both are honoured.
  expect(field(browser, 'BROWSER_ENABLED')).toMatchObject({ value: 'no', effective: 'false' })
  expect(field(browser, 'BROWSER_ENABLED').unusable).toBeUndefined()
  expect(field(browser, 'BROWSER_IDLE_MS').unusable).toBeUndefined()
  // A mistyped mode stops every command: the card says so, and the setting is flagged.
  const commands = await tool('commands')
  expect(commands.state).toEqual({ label: 'Not usable', tone: 'warning' })
  expect(commands.note).toContain('BAZILION_BASH_APPROVAL')
  expect(commands.note).toContain('Save this card to replace it.')
  expect(field(commands, 'BAZILION_BASH_APPROVAL')).toMatchObject({
    effective: 'off',
    unusable: true,
  })
  await save({ BAZILION_BASH_APPROVAL: 'off' })
  expect((await tool('commands')).state).toEqual({ label: 'Runs on this computer', tone: 'on' })
})

test('a stored value is read the way the daemon reads it', () => {
  const yesNo = { type: 'switch', on: 'true', off: 'false', default: true } as const
  expect(effectiveValue(yesNo, '')).toBe('true')
  expect(effectiveValue(yesNo, 'OFF')).toBe('false')
  expect(effectiveValue(yesNo, 'anything else')).toBe('true')
  const approval = { type: 'switch', on: 'dangerous', off: 'off', default: false } as const
  expect(effectiveValue(approval, '')).toBe('off')
  expect(effectiveValue(approval, 'dangerous')).toBe('dangerous')
  const minutes = { type: 'number', default: 900_000, min: 60_000, max: 86_400_000 } as const
  expect(effectiveValue(minutes, 'soon')).toBe('900000')
  expect(effectiveValue(minutes, '0')).toBe('900000')
  // Smaller than the page offers, but stored before it was checked: it still counts.
  expect(effectiveValue(minutes, '30000')).toBe('30000')
  const hops = { type: 'number', default: 8, min: 0, max: 100 } as const
  expect(effectiveValue(hops, '0')).toBe('0')
  const route = {
    type: 'choice',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Automatic' },
      { value: 'off', label: 'Off' },
    ],
  } as const
  expect(effectiveValue(route, 'google')).toBe('auto')
  expect(normalizeSetting({ envVar: 'X', kind: 'secret' }, '  key \n')).toEqual({ value: 'key' })
})

test('every tool setting has a label people can read and a default that passes its own check', () => {
  for (const service of SERVICES.filter((entry) => entry.category === 'tool')) {
    expect(service.hint, service.id).toBeTruthy()
    for (const setting of service.fields) {
      expect(setting.label, setting.envVar).not.toMatch(/[A-Z]{3,}_/)
      const input = setting.input
      if (!input || input.type === 'text') continue
      const fallback = effectiveValue(input, '')
      expect(normalizeSetting(setting, fallback), setting.envVar).toEqual({ value: fallback })
      if (input.type === 'choice') {
        expect(input.options.map((option) => option.value)).toContain(input.default)
        for (const option of input.options) expect(option.label).toBeTruthy()
      }
    }
  }
})
