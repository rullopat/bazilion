import { type ChildProcess, spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  restartTestServer,
  startTestServer,
  type TestServer,
  waitForFixtureServer,
} from './server-fixture.ts'

const children: { proc: ChildProcess; closed: Promise<void> }[] = []
function child(code: string): ChildProcess {
  const proc = spawn(process.execPath, ['-e', code], { stdio: ['ignore', 'pipe', 'ignore'] })
  children.push({ proc, closed: new Promise((resolve) => proc.once('close', () => resolve())) })
  return proc
}

afterEach(async () => {
  for (const { proc, closed } of children.splice(0)) {
    if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGTERM')
    const timer = setTimeout(() => {
      if (proc.exitCode === null && proc.signalCode === null) proc.kill('SIGKILL')
    }, 2_000)
    try {
      await closed
    } finally {
      clearTimeout(timer)
    }
  }
})

function responder(status: number, principal = 'bootstrap', fragmented = false): ChildProcess {
  return child(`
    const http = require('node:http')
    const server = http.createServer((req, res) => {
      res.setHeader('content-type', 'application/json')
      if (req.url === '/api/health') return res.end(JSON.stringify({ok: true}))
      res.statusCode = ${status}
      res.end(JSON.stringify({authenticated: true, principal: {kind: ${JSON.stringify(principal)}}, pid: process.pid}))
    })
    server.listen(0, '127.0.0.1', () => {
      const line = 'bazilion daemon listening at http://127.0.0.1:' + server.address().port + '\\n'
      if (${fragmented}) {
        process.stdout.write(line.slice(0, -3))
        setTimeout(() => process.stdout.write(line.slice(-3)), 50)
      } else process.stdout.write(line)
    })
  `)
}

test('public health cannot substitute for authenticated fixture-owner readiness', async () => {
  await expect(waitForFixtureServer(responder(401), 'fixture-token')).rejects.toThrow(
    'fixture owner authentication failed: HTTP 401',
  )
})

test('a successful HTTP response with the wrong principal is refused', async () => {
  await expect(waitForFixtureServer(responder(200, 'device'), 'fixture-token')).rejects.toThrow(
    'unexpected principal',
  )
})

test('only a complete owned listener line is used, including fragmented port output', async () => {
  const proc = responder(200, 'bootstrap', true)
  const url = await waitForFixtureServer(proc, 'fixture-token')
  const response = await fetch(`${url}/marker`)
  const marker = (await response.json()) as { pid: number }
  expect(marker.pid).toBe(proc.pid)
})

test('an exited child cannot be replaced by an unrelated HTTP listener', async () => {
  await expect(waitForFixtureServer(child('process.exit(7)'), 'fixture-token')).rejects.toThrow(
    'fixture exited before publishing its listener',
  )
})

test('parallel real daemons and a retained-home restart keep distinct authenticated owners', async () => {
  const servers: TestServer[] = []
  const env = { BAZILION_SCHEDULER: 'off', BAZILION_IMAGE_GENERATION: 'off' }
  try {
    const started = await Promise.allSettled(
      [0, 1].map(async () => {
        const server = await startTestServer(env)
        servers.push(server)
        return server
      }),
    )
    for (const result of started) if (result.status === 'rejected') throw result.reason
    const a = servers[0]
    const b = servers[1]
    if (!a || !b) throw new Error('missing parallel fixtures')
    expect(a.url).not.toBe(b.url)
    expect(a.token).not.toBe(b.token)
    const foreign = await fetch(`${b.url}/api/auth/whoami`, {
      headers: { authorization: `Bearer ${a.token}` },
    })
    expect(foreign.status).toBe(401)
    const originalAuth = readFileSync(join(a.home, 'auth.json'))
    await a.stop({ keepHome: true })
    servers.splice(servers.indexOf(a), 1)
    const restarted = await restartTestServer(a, env)
    servers.push(restarted)
    expect(restarted.home).toBe(a.home)
    expect(restarted.token).toBe(a.token)
    expect(restarted.url).not.toBe(b.url)
    expect(readFileSync(join(restarted.home, 'auth.json'))).toEqual(originalAuth)
  } finally {
    for (const server of servers) await server.stop()
  }
}, 30_000)
