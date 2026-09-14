import { expect, test } from 'vitest'
import {
  CODING_LOG_PAGE_BYTES,
  fetchRetainedCodingLog,
} from '../src/lib/coding-log.ts'

const reference = { commandId: 'command-1', teamId: 'team-1' }

function response(status: number, body?: unknown): typeof fetch {
  return (async () =>
    ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    }) as Response) as unknown as typeof fetch
}

const view = {
  commandId: 'command-1',
  teamId: 'team-1',
  availability: 'available',
  byteLength: 12,
}

test('returns the bounded first page for a released log', async () => {
  const page = { commandId: 'command-1', availability: 'available', offset: 0, text: 'hello', hasMore: false, byteLength: 5 }
  const result = await fetchRetainedCodingLog(reference, response(200, { view, page }))
  expect(result).toEqual({ status: 'available', page, view })
})

test('requests the opaque team/command path with a bounded page size', async () => {
  let seen = ''
  const impl = (async (url: string) => {
    seen = url
    return { status: 403, ok: false, json: async () => ({}) } as Response
  }) as unknown as typeof fetch
  await fetchRetainedCodingLog({ commandId: 'a/b', teamId: 't 1' }, impl)
  expect(seen).toBe(`/api/teams/t%201/coding-commands/a%2Fb/log?limit=${CODING_LOG_PAGE_BYTES}`)
})

test('a held log is not-shared, never an empty page', async () => {
  expect(await fetchRetainedCodingLog(reference, response(403, { error: 'Coding log has not been shared' }))).toEqual({ status: 'not-shared' })
  expect(await fetchRetainedCodingLog(reference, response(200, { view, page: null }))).toEqual({ status: 'not-shared' })
})

test('a command outside the team is missing', async () => {
  expect(await fetchRetainedCodingLog(reference, response(404, { error: 'Coding command not found' }))).toEqual({ status: 'missing' })
})

test('malformed payloads and transport errors stay unavailable', async () => {
  expect((await fetchRetainedCodingLog(reference, response(500, {}))).status).toBe('unavailable')
  expect((await fetchRetainedCodingLog(reference, response(200, { view, page: { text: 1 } }))).status).toBe('unavailable')
  expect((await fetchRetainedCodingLog(reference, response(200, { hello: 'world' }))).status).toBe('unavailable')
  const boom = (async () => {
    throw new Error('offline')
  }) as unknown as typeof fetch
  expect((await fetchRetainedCodingLog(reference, boom)).status).toBe('unavailable')
})
