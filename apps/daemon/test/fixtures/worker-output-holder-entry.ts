import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  detached: true,
  stdio: ['ignore', 1, 2],
})
if (!descendant.pid) throw new Error('Fixture descendant PID missing')
writeFileSync(join(input.paths.teamDir, 'fixture-descendant-pid'), String(descendant.pid))
process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`, () => process.exit(0))
