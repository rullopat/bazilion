// Test-process preload only. Production exposes no endpoint override or image-generator test switch.
import { appendFileSync } from 'node:fs'

const originalFetch = globalThis.fetch
const data =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhK0AAAAASUVORK5CYII='
const fixtures = {
  'https://openrouter.ai/api/v1/chat/completions': ['openrouter', 'fixture-image-key'],
  'https://api.openai.com/v1/images/generations': ['openai', 'fixture-openai-key'],
  'https://chatgpt.com/backend-api/codex/responses': ['openai-codex', 'fixture-codex-key'],
}
globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (!['openrouter.ai', 'api.openai.com', 'chatgpt.com', 'auth.openai.com'].includes(url.hostname))
    return originalFetch(input, init)
  const fixture = fixtures[url.href]
  if (
    !fixture ||
    new Headers(init?.headers).get('authorization') !== `Bearer ${fixture[1]}` ||
    !process.env.BAZILION_IMAGE_TEST_CALLS
  )
    throw new Error('Unexpected image fixture request')
  const [route] = fixture
  const body = JSON.parse(String(init.body))
  const prompt =
    route === 'openrouter'
      ? body.messages[0].content[0].text
      : route === 'openai'
        ? body.prompt
        : body.input[0].content[0].text
  appendFileSync(
    process.env.BAZILION_IMAGE_TEST_CALLS,
    `${JSON.stringify({ route, model: body.model, prompt })}\n`,
  )
  if (route === 'openai') return Response.json({ data: [{ b64_json: data }] })
  if (route === 'openai-codex')
    return new Response(
      `data: ${JSON.stringify({ type: 'response.completed', response: { id: 'codex-fixture', status: 'completed', output: [{ type: 'image_generation_call', id: 'ig-fixture', status: 'completed', result: data }] } })}\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    )
  return Response.json({
    id: 'image-fixture',
    choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${data}` } }] } }],
  })
}
