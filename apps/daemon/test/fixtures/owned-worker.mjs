// Controlled process-ownership fixture. No model, credentials or daemon/tool capabilities.
import { spawn } from 'node:child_process'

let started = false
process.stdin.setEncoding('utf8')
process.stdin.on('data', (data) => {
  const command = data.trim()
  if (command === 'exit') process.exit(0)
  if (started) return
  started = true
  process.on('SIGTERM', () => process.exit(0))
  // The inherited output keeps the parent's close event pending after its exit. A bounded
  // natural lifetime also lets unknown-owner tests retire without signalling a guessed PID.
  spawn(
    process.execPath,
    [
      '-e',
      `
    process.on('SIGTERM', () => {})
    process.stdout.write(JSON.stringify({ ready: process.pid }) + '\\n')
    setTimeout(() => process.exit(0), 6000)
  `,
    ],
    { stdio: ['ignore', 'inherit', 'inherit'], env: {} },
  ).unref()
})
process.stdin.resume()
