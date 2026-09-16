import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'

// A reviewer turn that reads the packet and stops without a conclusion. Used to observe that a turn which
// reviews nothing settles as a failure rather than as a review that found nothing.

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  review: { packetId: string; attemptId: string }
}

const call = createIpcClient({
  send: process.send
    ? (message, done) => process.send?.(message, undefined, undefined, done)
    : undefined,
  onMessage: (listener) => process.on('message', listener),
  onDisconnect: (listener) => process.on('disconnect', listener),
})

try {
  await call('reviewPacketRead', input.review)
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
  )
} finally {
  process.disconnect?.()
}
