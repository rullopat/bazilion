// Deterministic worker/IPC/tool composition only; no provider/browser/public network.
import type { WebSearchOutput } from '@bazilion/api-types'
import { ourToolToPiTool } from '../../src/runtime/pi/tools.ts'
import { ordinaryWebSearchTool, webTools } from '../../src/runtime/tools/web.ts'
import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'
import { parseWorkerInput } from '../../src/runtime/worker/runtime.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = parseWorkerInput(JSON.parse(Buffer.concat(chunks).toString('utf8')))
const call = createIpcClient({
  send: process.send
    ? (message, done) => process.send?.(message, undefined, undefined, done)
    : undefined,
  onMessage: (listener) => process.on('message', listener),
  onDisconnect: (listener) => process.on('disconnect', listener),
})
try {
  const args =
    input.message === 'forged'
      ? { query: 'NASA', model: 'other', endpoint: 'https://evil.test' }
      : { query: 'NASA', allowedDomains: ['nasa.gov'] }
  const search = ourToolToPiTool(
    ordinaryWebSearchTool({ search: (request) => call<WebSearchOutput>('webSearch', request) }),
  )
  const output = await search.execute(
    'search-call',
    args,
    undefined,
    undefined,
    {} as Parameters<typeof search.execute>[4],
  )
  let first = true
  const source = webTools({
    sourceReceipt: true,
    env: {},
    allowPrivate: true,
    fetchImpl: async () => {
      if (first) {
        first = false
        return new Response(null, {
          status: 302,
          headers: { location: 'https://www.nasa.gov/mission/artemis-ii/' },
        })
      }
      return new Response('OFFLINE NASA FIXTURE: Artemis II is a crewed mission.', {
        headers: { 'content-type': 'text/plain' },
      })
    },
  }).find((tool) => tool.def.name === 'web_fetch')
  if (!source) throw new Error('missing fixture fetch tool')
  const fetchTool = ourToolToPiTool(source)
  const read = await fetchTool.execute(
    'fetch-call',
    { url: 'https://www.nasa.gov/old-artemis-ii' },
    undefined,
    undefined,
    {} as Parameters<typeof fetchTool.execute>[4],
  )
  process.stdout.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'tool_result', name: 'web_search', result: JSON.stringify(output.details) } })}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'tool_result', name: 'web_fetch', result: JSON.stringify(read.details) } })}\n`,
  )
  process.stdout.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'assistant_message', text: 'Offline fixture source read: https://www.nasa.gov/mission/artemis-ii/' } })}\n`,
  )
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'fatal', error: String(error) })}\n`)
} finally {
  process.disconnect?.()
}
