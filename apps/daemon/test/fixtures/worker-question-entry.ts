import { createProcessIpcClient } from '../../src/runtime/worker/ipc-client.ts'

for await (const _chunk of process.stdin) {
  // The worker input is not needed: this entry only asks one question.
}
const call = createProcessIpcClient()
try {
  // The daemon binds the Agent; a worker cannot pick another one.
  const args = {
    question: { prompt: 'Format?', choices: [{ label: 'Text' }, { label: 'JSON' }] },
    agentId: 'another-agent',
  }
  const result = await call('askUser', args)
  if (result.kind !== 'answer' || result.answer.kind !== 'choice' || result.answer.index !== 1) {
    throw new Error('Expected JSON')
  }
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ kind: 'fatal', error: String(error) })}\n`)
} finally {
  process.disconnect?.()
}
