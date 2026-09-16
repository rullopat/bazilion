import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'

// A stand-in for the specialist's turn in the dispatcher integration test. It performs exactly what
// the capability allows — read the request, then run each declared check — and nothing else, so the
// test observes the real path from claim to receipt without a model in the loop.

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  verification: { requestId: string; attemptId: string }
  message: string
}

const call = createIpcClient({
  send: process.send
    ? (message, done) => process.send?.(message, undefined, undefined, done)
    : undefined,
  onMessage: (listener) => process.on('message', listener),
  onDisconnect: (listener) => process.on('disconnect', listener),
})

try {
  const identity = input.verification
  const brief = await call<{ checks: Array<{ ordinal: number }> }>('verificationRead', identity)
  for (const check of brief.checks) {
    await call('verificationRun', { ...identity, ordinal: check.ordinal })
  }
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
  )
} finally {
  process.disconnect?.()
}
