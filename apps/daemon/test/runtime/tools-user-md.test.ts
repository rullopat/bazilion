import { createHash } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { createToolRegistry } from '../../src/runtime/tools/registry.ts'
import { userMdTools } from '../../src/runtime/tools/user-md.ts'
import type {
  UserMdGetResult,
  UserMdHost,
  UserMdWriteResult,
} from '../../src/runtime/worker/ipc-protocol.ts'

function etag(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex').slice(0, 16)
}

interface InMemoryStore {
  current: Record<string, string>
}

function makeInMemoryHost(initial: Record<string, string> = {}): {
  host: UserMdHost
  store: InMemoryStore
} {
  const store: InMemoryStore = { current: { ...initial } }
  const host: UserMdHost = {
    get(teamId): UserMdGetResult {
      const content = store.current[teamId] ?? ''
      return { content, etag: etag(content) }
    },
    write(teamId, content, ifMatch): UserMdWriteResult {
      const prev = store.current[teamId] ?? ''
      if (etag(prev) !== ifMatch) {
        throw new Error(`etag mismatch — current is ${etag(prev)}, you passed ${ifMatch}`)
      }
      store.current[teamId] = content
      return { etag: etag(content), totalBytes: Buffer.byteLength(content, 'utf8') }
    },
  }
  return { host, store }
}

describe('user_md_get + user_md_write', () => {
  test('get returns content + etag on a fresh team', async () => {
    const { host } = makeInMemoryHost()
    const tools = createToolRegistry(userMdTools(host, 'g1'))
    const out = await tools.invoke('user_md_get', '{}')
    expect(out).toContain('(USER.md is empty)')
    expect(out).toMatch(/etag: [a-f0-9]{16}/)
  })

  test('get returns existing content + matching etag', async () => {
    const { host } = makeInMemoryHost({ g1: 'Patrizio prefers Italian.' })
    const tools = createToolRegistry(userMdTools(host, 'g1'))
    const out = await tools.invoke('user_md_get', '{}')
    expect(out).toContain('Patrizio prefers Italian.')
    expect(out).toContain(`etag: ${etag('Patrizio prefers Italian.')}`)
  })

  test('write succeeds when if_match equals the current etag', async () => {
    const { host, store } = makeInMemoryHost({ g1: 'old' })
    const tools = createToolRegistry(userMdTools(host, 'g1'))
    const result = await tools.invoke(
      'user_md_write',
      JSON.stringify({ content: 'new content', if_match: etag('old') }),
    )
    expect(result).toContain('wrote USER.md')
    expect(store.current.g1).toBe('new content')
  })

  test('write fails with a conflict when if_match is stale', async () => {
    const { host, store } = makeInMemoryHost({ g1: 'fresh' })
    const tools = createToolRegistry(userMdTools(host, 'g1'))
    await expect(
      tools.invoke(
        'user_md_write',
        JSON.stringify({ content: 'replacement', if_match: etag('stale-version') }),
      ),
    ).rejects.toThrow(/etag mismatch/i)
    // Prior content untouched.
    expect(store.current.g1).toBe('fresh')
  })

  test('write rejects when if_match is missing', async () => {
    const { host } = makeInMemoryHost()
    const tools = createToolRegistry(userMdTools(host, 'g1'))
    await expect(tools.invoke('user_md_write', JSON.stringify({ content: 'x' }))).rejects.toThrow(
      /if_match/i,
    )
  })

  test('two-agent read-modify-write: second agent must re-read after conflict', async () => {
    const { host } = makeInMemoryHost({ g1: 'shared' })
    const toolsA = createToolRegistry(userMdTools(host, 'g1'))
    const toolsB = createToolRegistry(userMdTools(host, 'g1'))

    // Both read at the same etag.
    const etagShared = etag('shared')

    // A writes first — succeeds.
    await toolsA.invoke(
      'user_md_write',
      JSON.stringify({ content: 'shared\nfrom A', if_match: etagShared }),
    )

    // B writes with the now-stale etag — fails.
    await expect(
      toolsB.invoke(
        'user_md_write',
        JSON.stringify({ content: 'shared\nfrom B', if_match: etagShared }),
      ),
    ).rejects.toThrow(/etag mismatch/i)

    // B re-reads and retries — succeeds.
    const out2 = (await toolsB.invoke('user_md_get', '{}')) as string
    const newEtagMatch = out2.match(/etag: ([a-f0-9]{16})/)
    expect(newEtagMatch).toBeTruthy()
    const newEtag = newEtagMatch?.[1] ?? ''
    await toolsB.invoke(
      'user_md_write',
      JSON.stringify({ content: 'shared\nfrom A and B', if_match: newEtag }),
    )
  })
})
