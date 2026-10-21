import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

if (process.argv[2]) {
  const child = spawn(
    process.execPath,
    [
      '-e',
      "process.on('SIGTERM',()=>{});process.send('ready');process.disconnect();setInterval(()=>{},1000)",
    ],
    { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] },
  )
  await new Promise((resolve) => child.once('message', resolve))
  writeFileSync(process.argv[2], String(child.pid))
}
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`)
const rl = createInterface({ input: process.stdin })
rl.on('line', (line) => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  let result = {}
  if (message.method === 'initialize')
    result = {
      protocolVersion: message.params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: 'local-fixture', version: '1' },
    }
  if (message.method === 'tools/list')
    result = { tools: [{ name: 'foo', inputSchema: { type: 'object', properties: {} } }] }
  if (message.method === 'tools/call')
    result = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            pid: process.pid,
            provided: process.env.MCP_FIXTURE_SECRET,
            ambient: process.env.MCP_FIXTURE_AMBIENT ?? null,
          }),
        },
      ],
    }
  send({ jsonrpc: '2.0', id: message.id, result })
})
rl.on('close', () => process.exit(0))
