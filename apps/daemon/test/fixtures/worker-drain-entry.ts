// Synthetic protocol fixture: real pipe backpressure and a deliberately live
// handle, but no model, browser, credentials or daemon state.
import { WorkerOutput } from '../../src/runtime/worker/output.ts'

const output = new WorkerOutput(process.stdout)
const mode = process.argv[2] ?? 'done'
const content = '日本語🌍'.repeat(160_000)
setInterval(() => {}, 60_000)

async function finish(code: number, timeoutMs?: number) {
  process.exit((await output.finish(timeoutMs)) ? code : 1)
}

if (mode === 'cancel') {
  output.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'assistant_delta', delta: content } })}\n`,
  )
  process.on('SIGTERM', () => {
    output.write(
      `${JSON.stringify({ kind: 'event', event: { type: 'error', error: 'cancelled' } })}\n`,
    )
    void finish(0)
  })
  process.stderr.write('ready\n')
} else if (mode === 'fatal') {
  output.write(`${JSON.stringify({ kind: 'fatal', error: content })}\n`)
  process.stderr.write('ready\n')
  await finish(1)
} else {
  output.write(`${JSON.stringify({ kind: 'done', messages: [{ role: 'assistant', content }] })}\n`)
  process.stderr.write('ready\n')
  await finish(0, mode === 'blocked' ? 100 : undefined)
}
