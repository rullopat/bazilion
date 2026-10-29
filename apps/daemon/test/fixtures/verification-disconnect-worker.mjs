import { existsSync, watch, writeFileSync } from 'node:fs'
import { dirname, isAbsolute } from 'node:path'

// Controlled trusted transport child, not a replacement for real Pi-worker qualification.
// Marker observations never confer process-signalling authority.
let termMarker
process.once('SIGTERM', () => {
  if (termMarker) writeFileSync(termMarker, String(Date.now()))
  process.exit(0)
})
let body = ''
for await (const bytes of process.stdin) body += bytes.toString()
const input = JSON.parse(body)
if (input.kind !== 'specialist_verification' || !input.verification)
  throw new Error('wrong worker kind')
let next = 0
const pending = new Map()
process.on('message', (message) => {
  if (message?.type !== 'rpc-reply') return
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  if (message.ok) entry.resolve(message.result)
  else entry.reject(new Error('controlled RPC refusal'))
})
function call(method, args) {
  return new Promise((resolve, reject) => {
    const id = `verification-lifecycle-${++next}`
    pending.set(id, { resolve, reject })
    process.send({ type: 'rpc', id, method, args })
  })
}
const identity = input.verification
const brief = await call('verificationRead', identity)
const control = JSON.parse(brief.summary)
if (
  control.fixture !== 'native-verification-lifecycle' ||
  !isAbsolute(control.marker) ||
  !isAbsolute(control.workerTermMarker) ||
  !['disconnect', 'cancel'].includes(control.mode)
)
  throw new Error('wrong controlled observation')
termMarker = control.workerTermMarker
const observed = new Promise((resolve, reject) => {
  let done = false
  const finish = () => {
    if (done || !existsSync(control.marker)) return
    done = true
    clearTimeout(timer)
    watcher.close()
    resolve()
  }
  const watcher = watch(dirname(control.marker), { persistent: false }, finish)
  const timer = setTimeout(() => {
    if (done) return
    done = true
    watcher.close()
    reject(new Error('controlled check did not start'))
  }, 8000)
  finish()
})
const running = call('verificationRun', { ...identity, ordinal: 0 })
void running.catch(() => {})
await observed
// Stay live until the daemon retires the original owned child. A clean spontaneous exit cannot pass.
setInterval(() => {}, 1000)
if (control.mode === 'disconnect') process.disconnect()
else await running
