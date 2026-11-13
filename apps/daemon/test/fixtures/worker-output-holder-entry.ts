import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
const forever = ['-e', 'setInterval(() => {}, 1000)']
// Left in the worker's process group: the daemon ends it once the worker exits.
const groupChild = spawn(process.execPath, forever, { stdio: 'ignore' })
// Its own process group, holding the worker's stdout and stderr open after the worker exits.
const descendant = spawn(process.execPath, forever, { detached: true, stdio: ['ignore', 1, 2] })
if (!groupChild.pid || !descendant.pid) throw new Error('Fixture child PID missing')
writeFileSync(join(input.agent.team.path, 'fixture-group-child-pid'), String(groupChild.pid))
writeFileSync(join(input.agent.team.path, 'fixture-descendant-pid'), String(descendant.pid))
process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`, () => process.exit(0))
