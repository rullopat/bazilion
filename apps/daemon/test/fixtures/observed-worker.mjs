import { spawn } from 'node:child_process'

process.stdin.once('data', (data) => {
  const mode = data.toString().trim()
  if (mode === 'fail') process.exit(1)
  if (mode === 'holder') {
    spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 250)'], {
      stdio: ['ignore', 'inherit', 'inherit'],
    }).unref()
  }
  process.exit(0)
})
process.stdin.resume()
