// Test-only transport preload for the REAL worker entry / Pi Agent loop.
// Every HTTP request is replaced in memory; unexpected endpoints fail. No sockets/provider calls.
import dns from 'node:dns'
import { createRequire, syncBuiltinESMExports } from 'node:module'

const require = createRequire(new URL('../../src/runtime/worker/entry.ts', import.meta.url))
const undici = require('undici')
dns.lookup = (host, options, callback) => {
  if (typeof options === 'function') callback = options
  if (host !== 'www.nasa.gov') throw new Error('unexpected fixture DNS host')
  const address = { address: '93.184.216.34', family: 4 }
  callback(null, options?.all ? [address] : address.address, 4)
}
let promiseLookups = 0
dns.promises.lookup = async (host, options) => {
  if (host !== 'www.nasa.gov') throw new Error('unexpected fixture promise DNS host')
  promiseLookups++
  const address = { address: '93.184.216.34', family: 4 }
  return options?.all ? [address] : address
}
syncBuiltinESMExports()
let turn = 0
let source = 0
const text =
  'Artemis II is a crewed mission. Source actually read: https://www.nasa.gov/mission/artemis-ii/'
const searchArgs = { query: 'NASA Artemis II', allowedDomains: ['nasa.gov'] }
function streamResponse(item) {
  const id = `resp_loop_${turn}`
  const events = [
    {
      type: 'response.created',
      response: { id, model: 'gpt-6.1-sol', status: 'in_progress', output: [] },
    },
    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { ...item, arguments: '', content: [] },
    },
  ]
  if (item.type === 'function_call')
    events.push({
      type: 'response.function_call_arguments.delta',
      output_index: 0,
      item_id: item.id,
      delta: item.arguments,
    })
  else
    events.push(
      {
        type: 'response.content_part.added',
        output_index: 0,
        content_index: 0,
        part: { type: 'output_text', text: '', annotations: [] },
      },
      { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: text },
    )
  events.push(
    { type: 'response.output_item.done', output_index: 0, item },
    {
      type: 'response.completed',
      response: {
        id,
        model: 'gpt-6.1-sol',
        status: 'completed',
        output: [item],
        usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
      },
    },
  )
  return new Response(
    events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  )
}
async function fakeFetch(input, options) {
  const url = String(input)
  if (url === 'https://api.openai.com/v1/responses') {
    const payload = JSON.parse(options.body)
    if (payload.model !== 'gpt-6.1-sol') throw new Error('fixture model changed')
    if (
      payload.tools?.some(
        (tool) => ['codemode', 'tool_search'].includes(tool.name) || tool.name?.startsWith('mcp__'),
      )
    )
      throw new Error('unadmitted Pi discovery or MCP tool was declared')
    turn++
    if (turn > 3) throw new Error('unexpected fixture provider retry')
    if (turn === 2 && !JSON.stringify(payload.input).includes('ws_fixture_loop'))
      throw new Error('search receipt did not reach parent model')
    if (turn === 3 && !JSON.stringify(payload.input).includes('OFFLINE NASA FIXTURE'))
      throw new Error('source bytes did not reach parent model')
    if (turn === 3 && (promiseLookups !== 2 || source !== 2))
      throw new Error('guarded source and redirect must use the synthetic promise resolver')
    return streamResponse(
      turn < 3
        ? {
            type: 'function_call',
            id: `fc_${turn}`,
            call_id: `call_${turn}`,
            name: turn === 1 ? 'web_search' : 'web_fetch',
            arguments: JSON.stringify(
              turn === 1 ? searchArgs : { url: 'https://www.nasa.gov/old-artemis-ii' },
            ),
            status: 'completed',
          }
        : {
            type: 'message',
            id: 'msg_final',
            role: 'assistant',
            status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
          },
    )
  }
  if (url.startsWith('https://www.nasa.gov/') && promiseLookups !== source + 1)
    throw new Error('source fetch bypassed the synthetic promise resolver')
  if (url === 'https://www.nasa.gov/old-artemis-ii' && source++ === 0)
    return new Response(null, {
      status: 302,
      headers: { location: 'https://www.nasa.gov/mission/artemis-ii/' },
    })
  if (url === 'https://www.nasa.gov/mission/artemis-ii/' && source++ === 1)
    return new Response('OFFLINE NASA FIXTURE: Artemis II is a crewed mission.', {
      headers: { 'content-type': 'text/plain' },
    })
  throw new Error(`unexpected fixture endpoint: ${url}`)
}
globalThis.fetch = fakeFetch
undici.fetch = fakeFetch
