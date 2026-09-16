import { expect, test } from 'vitest'
import {
  type VerificationBrief,
  VerificationCapabilityError,
  type VerificationCapabilityHost,
  type VerificationRequestHost,
  verificationRequestTool,
  verificationTools,
} from '../../src/runtime/tools/verification.ts'

// BAZ-044 slice 5: the specialist's capability is two tools and cannot be widened.
//
// The property that matters is negative: there is no way to express a command, a cwd, an
// environment change, or a second run of a settled check.

function brief(overrides: Partial<VerificationBrief> = {}): VerificationBrief {
  return {
    requestId: 'req-1',
    summary: 'verify the fix',
    snapshot: { id: 'snap-1', complete: true, head: 'head', baseOid: 'base-oid-abcdef' },
    environment: { image: 'debian:bookworm-slim', sandbox: 'docker', cwd: '/workspace' },
    writablePaths: ['dist'],
    checks: [
      {
        ordinal: 0,
        command: 'pnpm test',
        cwd: '/workspace',
        purpose: 'unit suite',
        timeoutMs: 120_000,
        state: 'not_executed',
        commandId: null,
        exitCode: null,
      },
      {
        ordinal: 1,
        command: 'pnpm test failing',
        cwd: '/workspace',
        purpose: 'expected failure',
        timeoutMs: 60_000,
        state: 'not_executed',
        commandId: null,
        exitCode: null,
      },
    ],
    applicability: 'identical',
    ...overrides,
  }
}

function host(overrides: Partial<VerificationCapabilityHost> = {}) {
  const invoked: number[] = []
  const value: VerificationCapabilityHost = {
    read: async () => brief(),
    invoke: async (ordinal) => {
      invoked.push(ordinal)
      return {
        ordinal,
        state: 'failed',
        commandId: `cmd-${ordinal}`,
        exitCode: 1,
        output: 'boom',
        truncated: false,
      }
    },
    ...overrides,
  }
  return { value, invoked }
}

test('the capability is exactly two tools and neither accepts a command', () => {
  const tools = verificationTools(host().value)
  expect(tools.map((tool) => tool.def.name)).toEqual(['verification_request', 'verification_check'])
  const [read, run] = tools.map((tool) => tool.def.parameters) as Array<{
    properties: Record<string, unknown>
    required?: string[]
    additionalProperties: boolean
  }>
  // The read tool takes no arguments at all.
  expect(read?.properties).toEqual({})
  // The run tool takes an ordinal and nothing else: no command, cwd, timeout or env.
  expect(Object.keys(run?.properties ?? {})).toEqual(['ordinal'])
  expect(run?.required).toEqual(['ordinal'])
  expect(run?.additionalProperties).toBe(false)
  for (const forbidden of ['command', 'cwd', 'timeoutMs', 'timeoutSeconds', 'env', 'shell']) {
    expect(Object.keys(run?.properties ?? {})).not.toContain(forbidden)
  }
})

test('the brief renders captured facts, not invented ones', async () => {
  const tools = verificationTools(host().value)
  const text = String(await tools[0]?.invoke({}, { toolCallId: 't' }))
  expect(text).toContain('snapshot snap-1')
  expect(text).toContain('image debian:bookworm-slim')
  expect(text).toContain('[1] pnpm test failing')
  expect(text).toContain('not run yet')
  // An incomplete capture is labelled, never quietly treated as exact.
  const incomplete = verificationTools(
    host({
      read: async () => brief({ snapshot: { id: 's', complete: false, head: null, baseOid: 'b' } }),
    }).value,
  )
  expect(String(await incomplete[0]?.invoke({}, { toolCallId: 't' }))).toContain(
    'INCOMPLETE COVERAGE',
  )
})

test('only a declared ordinal runs, and only once', async () => {
  const { value, invoked } = host()
  const [, run] = verificationTools(value)
  if (!run) throw new Error('missing tool')

  await expect(run.invoke({ ordinal: 1 }, { toolCallId: 't' })).resolves.toContain(
    'failed (exit 1)',
  )
  // The same check cannot run twice, and the host is not asked to try. This instance knows the
  // check is in flight or done, so it refuses before the round trip; a reloaded instance instead
  // refuses from the settled state recorded on the request (asserted below).
  await expect(run.invoke({ ordinal: 1 }, { toolCallId: 't' })).rejects.toThrow(/already running/)
  expect(invoked).toEqual([1])

  // An ordinal that was never captured is refused before the host is consulted.
  await expect(run.invoke({ ordinal: 7 }, { toolCallId: 't' })).rejects.toThrow(
    VerificationCapabilityError,
  )
  expect(invoked).toEqual([1])
})

test('the argument shape is closed: no extra keys, no substitution through the ordinal', async () => {
  const { value, invoked } = host()
  const [, run] = verificationTools(value)
  if (!run) throw new Error('missing tool')
  for (const args of [
    { ordinal: 0, command: 'rm -rf /' },
    { ordinal: 0, cwd: '/elsewhere' },
    { command: 'pnpm test' },
    { ordinal: '0' },
    { ordinal: 0.5 },
    { ordinal: -1 },
    {},
  ]) {
    await expect(run.invoke(args as never, { toolCallId: 't' })).rejects.toThrow(
      VerificationCapabilityError,
    )
  }
  // Nothing reached the executor: a widened request is refused, not trimmed.
  expect(invoked).toEqual([])
})

test('a check that already reported in the request is not runnable again after a reload', async () => {
  const settled = brief({
    checks: [
      {
        ordinal: 0,
        command: 'pnpm test',
        cwd: '.',
        purpose: 'suite',
        timeoutMs: 1_000,
        state: 'succeeded',
        commandId: 'cmd-0',
        exitCode: 0,
      },
    ],
  })
  const { value, invoked } = host({ read: async () => settled })
  const [, run] = verificationTools(value)
  if (!run) throw new Error('missing tool')
  await expect(run.invoke({ ordinal: 0 }, { toolCallId: 't' })).rejects.toThrow(
    /already reported 'succeeded'/,
  )
  expect(invoked).toEqual([])
})

test('a refused invocation stays runnable, because nothing executed', async () => {
  let attempts = 0
  const { value } = host({
    invoke: async (ordinal) => {
      attempts++
      if (attempts === 1) throw new Error('missing toolchain: pnpm is unavailable')
      return {
        ordinal,
        state: 'succeeded',
        commandId: 'cmd-0',
        exitCode: 0,
        output: '',
        truncated: false,
      }
    },
  })
  const [, run] = verificationTools(value)
  if (!run) throw new Error('missing tool')
  await expect(run.invoke({ ordinal: 0 }, { toolCallId: 't' })).rejects.toThrow('missing toolchain')
  await expect(run.invoke({ ordinal: 0 }, { toolCallId: 't' })).resolves.toContain('succeeded')
  expect(attempts).toBe(2)
})

// ---------------------------------------------------------------------------------------------
// The requester's half. It asks for verification and can do nothing else: no approval, no execution,
// and no way to name a different requester.
// ---------------------------------------------------------------------------------------------

function requestHost(): { host: VerificationRequestHost; seen: unknown[] } {
  const seen: unknown[] = []
  return {
    seen,
    host: {
      capture: async (intent) => {
        seen.push(intent)
        return {
          requestId: 'req-1',
          snapshotId: 'snap-1',
          specialist: intent.specialist,
          state: 'pending',
          checks: intent.checks.map((check, ordinal) => ({
            ordinal,
            command: check.command,
            cwd: check.cwd ?? '.',
            timeoutMs: (check.timeoutSeconds ?? 120) * 1000,
          })),
        }
      },
    },
  }
}

test('the requester tool asks for verification and offers nothing else', () => {
  const { host } = requestHost()
  const tool = verificationRequestTool(host)
  expect(tool.def.name).toBe('request_verification')
  const parameters = tool.def.parameters as {
    additionalProperties?: boolean
    required?: string[]
    properties: Record<string, unknown>
  }
  // No snapshot to choose, no requester to claim, no publish or approve action: the daemon captures
  // the change and binds the identity, the model supplies only what to check and who should check it.
  expect(parameters.additionalProperties).toBe(false)
  expect(parameters.required).toEqual(['specialist', 'checks'])
  expect(Object.keys(parameters.properties).sort()).toEqual([
    'checks',
    'specialist',
    'summary',
    'writablePaths',
  ])
})

test('a malformed request is refused before the daemon is asked', async () => {
  const { host, seen } = requestHost()
  const tool = verificationRequestTool(host)
  for (const args of [
    { specialist: '', checks: [{ command: 'x', purpose: 'y' }] },
    { specialist: 'tester', checks: [] },
    { specialist: 'tester', checks: [{ command: '', purpose: 'y' }] },
    { specialist: 'tester', checks: [{ command: 'x', purpose: '' }] },
    {
      specialist: 'tester',
      checks: Array.from({ length: 9 }, () => ({ command: 'x', purpose: 'y' })),
    },
  ]) {
    await expect(tool.invoke(args, { toolCallId: 't' })).rejects.toThrow(
      /request_verification|check \d/,
    )
  }
  expect(seen).toEqual([])
})

test('a valid request is handed over as intent, and the receipt names what to wait on', async () => {
  const { host, seen } = requestHost()
  const tool = verificationRequestTool(host)
  const rendered = await tool.invoke(
    {
      specialist: 'tester',
      checks: [
        { command: 'pnpm test', purpose: 'unit suite' },
        { command: 'pnpm build', purpose: 'build', cwd: 'app', timeoutSeconds: 30 },
      ],
      summary: 'the fix should be verified',
      writablePaths: ['dist'],
    },
    { toolCallId: 't' },
  )
  expect(seen).toEqual([
    {
      specialist: 'tester',
      checks: [
        { command: 'pnpm test', purpose: 'unit suite' },
        { command: 'pnpm build', purpose: 'build', cwd: 'app', timeoutSeconds: 30 },
      ],
      summary: 'the fix should be verified',
      writablePaths: ['dist'],
    },
  ])
  const text =
    typeof rendered === 'string'
      ? rendered
      : (Array.isArray(rendered) ? rendered : rendered.content)
          .map((part) => (part.type === 'text' ? part.text : ''))
          .join('')
  expect(text).toContain('req-1')
  expect(text).toContain('pending')
  // The requester is told to yield and wait, and is told what this is not.
  expect(text).toContain('End your turn')
  expect(text).toContain('not an')
})

test('the specialist capability does not contain the requester tool', () => {
  const { value } = host({
    invoke: async (ordinal: number) => ({
      ordinal,
      state: 'succeeded',
      commandId: null,
      exitCode: 0,
      output: '',
      truncated: false,
      blocker: null,
    }),
  })
  expect(verificationTools(value).map((tool) => tool.def.name)).toEqual([
    'verification_request',
    'verification_check',
  ])
})
