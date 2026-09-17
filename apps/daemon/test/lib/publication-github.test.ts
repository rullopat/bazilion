import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, beforeEach, expect, test } from 'vitest'
import { createGitHubAdapter } from '../../src/lib/publication/host/github.ts'

// BAZ-046: the GitHub adapter, observed against a stand-in API.
//
// Two rules are the point of this file, and both are about not inferring:
//
//   1. **The remote comes from configuration.** A Team repository whose own `origin` points somewhere is
//      not evidence of where a publication should go, so the URL is built from the configured repository.
//   2. **A pull request is reported only if GitHub said so.** The number and URL are read from the
//      response; a 201 without a URL records none, and a refusal records the refusal.

interface Recorded {
  method: string
  url: string
  headers: Record<string, string | string[] | undefined>
  body: string
}

let server: Server
let base: string
let requests: Recorded[]
let respond: { status: number; body: string }

beforeEach(async () => {
  requests = []
  respond = {
    status: 201,
    body: JSON.stringify({ number: 7, html_url: 'https://example.test/pr/7' }),
  }
  server = createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      res.writeHead(respond.status, { 'content-type': 'application/json' })
      res.end(respond.body)
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()))
})

const target = {
  host: 'github' as const,
  repository: 'rullopat/bazilion',
  baseBranch: 'main',
  headBranch: 'bazilion/review-1234abcd',
  commitMessage: 'Reviewed change',
  title: 'Reviewed change',
  body: 'Published by Bazilion.',
}

test('the remote is built from configuration, never from a repository that is on the machine', () => {
  const adapter = createGitHubAdapter({ credential: 'token-value' })
  const remote = adapter.remoteUrl(target)
  expect(remote).toEqual({ ok: true, url: 'https://github.com/rullopat/bazilion.git' })

  // A repository that is not owner/name is refused here rather than producing a guess.
  const bad = adapter.remoteUrl({ ...target, repository: 'file:///tmp/somewhere' })
  expect(bad).toMatchObject({ ok: false, reason: 'origin_not_configured' })
  const dash = adapter.remoteUrl({ ...target, repository: '../escape' })
  expect(dash).toMatchObject({ ok: false, reason: 'origin_not_configured' })
})

test('a pull request is reported only when the host returned one', async () => {
  const adapter = createGitHubAdapter({ credential: 'token-value', apiBaseUrl: base })
  const result = await adapter.openPullRequest(target)
  expect(result).toEqual({
    ok: true,
    outcome: { pullRequestNumber: 7, pullRequestUrl: 'https://example.test/pr/7' },
  })
  // The request named the branch and the base, and carried the credential as a header — not in the URL.
  const request = requests[0]
  expect(request?.method).toBe('POST')
  expect(request?.url).toBe('/repos/rullopat/bazilion/pulls')
  expect(request?.headers.authorization).toBe('Bearer token-value')
  expect(JSON.stringify(request?.headers)).not.toContain('token-value@')
  expect(JSON.parse(request?.body ?? '{}')).toMatchObject({
    head: 'bazilion/review-1234abcd',
    base: 'main',
  })

  // A 201 with no URL is not evidence of a pull request.
  respond = { status: 201, body: JSON.stringify({ number: 8 }) }
  const partial = await adapter.openPullRequest(target)
  expect(partial).toEqual({
    ok: true,
    outcome: { pullRequestNumber: 8, pullRequestUrl: null },
  })
})

test('a refused or unreachable host is reported as such, never as a pull request', async () => {
  const adapter = createGitHubAdapter({ credential: 'token-value', apiBaseUrl: base })
  respond = {
    status: 403,
    body: JSON.stringify({ message: 'Resource not accessible by integration' }),
  }
  const refused = await adapter.openPullRequest(target)
  expect(refused).toMatchObject({ ok: false, reason: 'host_refused' })
  if (!refused.ok) expect(refused.detail).toContain('403')

  // A transport failure says whether a pull request exists is unknown — not that one does not.
  const unreachable = createGitHubAdapter({
    credential: 'token-value',
    apiBaseUrl: 'http://127.0.0.1:1',
  })
  const failed = await unreachable.openPullRequest(target)
  expect(failed).toMatchObject({ ok: false, reason: 'host_unavailable' })
  if (!failed.ok) expect(failed.detail).toContain('unknown')
})
