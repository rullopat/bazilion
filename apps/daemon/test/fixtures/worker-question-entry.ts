import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message: string }
const call = createIpcClient({
  send: process.send
    ? (message, done) => process.send?.(message, undefined, undefined, done)
    : undefined,
  onMessage: (listener) => process.on('message', listener),
  onDisconnect: (listener) => process.on('disconnect', listener),
})
try {
  const args = {
    toolCallId: 'actual-tool-call',
    question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    ...(input.message === 'forged' ? { agentId: 'another-agent' } : {}),
  }
  const result = await call<{ kind: string; questionId: string }>('askUser', args)
  if (result.kind !== 'answer') throw new Error('Expected answer')
  await call('questionConsumed', {
    questionId: result.questionId,
    toolCallId: 'actual-tool-call',
  })
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'fatal', error: String(error) })}\n`)
} finally {
  process.disconnect?.()
}
