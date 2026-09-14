import { createLocalBashOperations } from '@earendil-works/pi-coding-agent'

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8'))
// Exercise Pi's actual detached host shell, with no provider or personal runtime state.
await createLocalBashOperations().exec(
  'printf "%s" "$$" > fixture-host-shell-pid; sleep 120',
  input.agent.team.path,
  { onData: () => {}, timeout: 125 },
)
process.disconnect?.()
