import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

let input = ''
for await (const chunk of process.stdin) input += chunk.toString()
if (input) {
  const spec = JSON.parse(input)
  if (spec.message === 'ignore-term') process.on('SIGTERM', () => {})
  writeFileSync(join(spec.agent.team.path, 'input-released'), 'trusted-controlled-input', {
    flag: 'wx',
  })
  process.stdout.write(
    `${JSON.stringify({ kind: 'event', event: { type: 'assistant_delta', delta: 'signal-guard-ready' } })}\n`,
  )
  await new Promise((resolve) => setTimeout(resolve, spec.message === 'ignore-term' ? 3500 : 250))
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
}
if (process.connected) process.disconnect()
