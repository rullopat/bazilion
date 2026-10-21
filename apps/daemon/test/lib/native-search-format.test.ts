import { describe, expect, test, vi } from 'vitest'
import { NativeSearchError, nativeSearch } from '../../src/lib/native-search.ts'
import {
  classifyNativeBodyPrefix,
  classifyNativeMediaType,
  NATIVE_BODY_PREFIX_CHARS,
} from '../../src/lib/native-search-format.ts'

const SECRET = 'private-fixture-credential-never-disclose'
const terminal = `data: ${JSON.stringify({
  type: 'response.completed',
  response: {
    id: 'resp_fixture',
    model: 'gpt-6.1-sol',
    status: 'completed',
    output: [],
  },
})}\n\n`
const search = (fetchImpl: typeof fetch) =>
  nativeSearch({
    provider: 'openai',
    model: 'gpt-6.1-sol',
    mode: 'cached',
    args: { query: 'OFFLINE FIXTURE' },
    credential: async () => SECRET,
    secrets: () => [SECRET],
    signal: new AbortController().signal,
    assertActive: () => {},
    fetchImpl,
  })

describe('native search response format hints', () => {
  test('media categories are closed and bounded, never raw header values', () => {
    for (const [value, expected] of [
      [null, 'missing'],
      ['', 'missing'],
      [' \t', 'missing'],
      ['Text/Event-Stream; charset=UTF-8', 'sse'],
      ['Application/JSON', 'json'],
      ['text/html', 'html'],
      ['application/xhtml+xml', 'html'],
      ['text/plain', 'text'],
      ['application/octet-stream', 'binary'],
      ['application/vendor+json', 'other'],
      [SECRET, 'other'],
      ['text/event-stream-impostor', 'other'],
      [`${' '.repeat(256)}text/html`, 'other'],
      [`text/plain;${SECRET.repeat(10000)}`, 'text'],
    ] as const)
      expect(classifyNativeMediaType(value)).toBe(expected)
  })
  test('body hints inspect only a bounded prefix, without parsing or copying content', () => {
    for (const [value, expected] of [
      ['', 'empty'],
      [' \uFEFF\n{"private":"fixture"}', 'json_like'],
      ['[not JSON', 'json_like'],
      ['<!DOCTYPE html><html><body>private page</body>', 'html_like'],
      ['<HTML lang="en">private page', 'html_like'],
      ['<html-impostor>', 'other'],
      ['data: private fixture\n\n', 'sse_like'],
      [':heartbeat\n\ndata: private fixture\n\n', 'sse_like'],
      ['event: private_fixture\n', 'sse_like'],
      ['untrusted prose\ndata: private fixture', 'other'],
      [`${' '.repeat(NATIVE_BODY_PREFIX_CHARS)}<html>`, 'unknown'],
      [`${':'.repeat(NATIVE_BODY_PREFIX_CHARS)}\ndata: fixture`, 'unknown'],
      [`${'x'.repeat(NATIVE_BODY_PREFIX_CHARS)}<html>`, 'other'],
    ] as const)
      expect(classifyNativeBodyPrefix(value)).toBe(expected)
  })
  test('HTML and mislabeled SSE are distinguishable refusals, never successful search or fallback', async () => {
    for (const [type, body, expected] of [
      ['text/html', '<!doctype html><html>private diagnostic page</html>', 'html_like'],
      ['text/plain', terminal, 'sse_like'],
      ['application/json', '{invalid private JSON}', 'json_like'],
      ['text/plain', '', 'empty'],
    ]) {
      const fetcher = vi.fn(
        async () =>
          new Response(body, {
            headers: { 'content-type': type ?? '' },
          }),
      )
      const error = await search(fetcher).catch((error: unknown) => error)
      expect(error).toBeInstanceOf(NativeSearchError)
      expect((error as NativeSearchError).diagnostic?.phase).toBe('decode')
      expect((error as NativeSearchError).diagnostic?.bodyFormat).toBe(expected)
      expect((error as Error).message).not.toMatch(
        /private diagnostic|invalid private JSON|resp_fixture/,
      )
      expect(fetcher).toHaveBeenCalledTimes(1)
    }
  })
  test('secret filtering precedes body-format disclosure and hostile HTML is never executed', async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          `<!doctype html><html><script>throw new Error('execute fixture')</script>${SECRET}</html>`,
          { headers: { 'content-type': 'text/html' } },
        ),
    )
    const error = await search(fetcher).catch((error: unknown) => error)
    expect((error as NativeSearchError).diagnostic).toMatchObject({
      phase: 'disclosure',
      mediaType: 'html',
      bodyFormat: 'unknown',
    })
    expect((error as Error).message).not.toMatch(/private-fixture|execute fixture|<html/)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
  test('format hints do not replace execution, citation, framing or model evidence checks', async () => {
    const error = await search(
      async () =>
        new Response(terminal, {
          headers: { 'content-type': 'text/event-stream' },
        }),
    ).catch((error: unknown) => error)
    expect((error as NativeSearchError).diagnostic).toMatchObject({
      phase: 'evidence',
      mediaType: 'sse',
      bodyFormat: 'sse_like',
    })
    expect((error as Error).message).toMatch(/execution evidence/)
    // A bounded media hint cannot alter the established exact-MIME decoder rule.
    const longType = `text/event-stream${' '.repeat(300)}; charset=UTF-8`
    const long = await search(
      async () =>
        new Response(terminal, {
          headers: { 'content-type': longType },
        }),
    ).catch((error: unknown) => error)
    expect((long as NativeSearchError).diagnostic?.phase).toBe('evidence')
    expect((long as NativeSearchError).diagnostic?.mediaType).toBe('other')
  })
})
