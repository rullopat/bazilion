import type { RepositoryContextReport } from '@bazilion/api-types'
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
  const result = await call<RepositoryContextReport>('repositoryContext', {
    target: 'nested/new.ts',
    ...(input.message === 'forged' ? { teamId: 'other-team', root: '/private' } : {}),
  })
  process.stdout.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'assistant_message', text: JSON.stringify(result) } })}\n`,
  )
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'fatal', error: String(error) })}\n`)
} finally {
  process.disconnect?.()
}
