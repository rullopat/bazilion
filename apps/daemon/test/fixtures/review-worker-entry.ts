import { createIpcClient } from '../../src/runtime/worker/ipc-client.ts'

// A stand-in for the reviewer's turn in the dispatcher integration test. It performs exactly what the
// reviewer capability allows — read the packet, read a path's patch, record a finding, conclude — and
// nothing else, so the test observes the real path from claim to conclusion without a model in the loop.
//
// It also *tries* to exceed the capability, because a read-only guarantee that is only asserted when
// nobody attempts anything is not asserted at all.

const chunks: Buffer[] = []
for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
  review: { packetId: string; attemptId: string }
  message: string
}

const call = createIpcClient({
  send: process.send
    ? (message, done) => process.send?.(message, undefined, undefined, done)
    : undefined,
  onMessage: (listener) => process.on('message', listener),
  onDisconnect: (listener) => process.on('disconnect', listener),
})

const forbidden = [
  'coding',
  'verificationRead',
  'verificationRun',
  'verificationCapture',
  'publishResult',
  'browserInvoke',
  'mcpInvoke',
  'sendMessage',
] as const

try {
  const identity = input.review
  const brief = await call<{ changes: Array<{ path: string }>; contentAvailable: boolean }>(
    'reviewPacketRead',
    identity,
  )
  // Nothing a reviewer is not granted exists: each of these must be refused by the daemon rather than
  // silently answered.
  const refusals: string[] = []
  for (const method of forbidden) {
    try {
      await call(method as never, { ...identity })
      refusals.push(`${method}:ALLOWED`)
    } catch {
      refusals.push(`${method}:refused`)
    }
  }
  // A capability the daemon answers for a review turn is a breach, not a curiosity: fail the turn so the
  // test that observes the dispatch cannot pass while the reviewer had more than it should.
  const allowed = refusals.filter((entry) => entry.endsWith(':ALLOWED'))
  if (allowed.length > 0) {
    throw new Error(`review turn was granted capabilities it must not have: ${allowed.join(', ')}`)
  }
  const path = brief.changes[0]?.path
  if (path && brief.contentAvailable) await call('reviewPathRead', { ...identity, path })
  await call('reviewFindingAdd', {
    ...identity,
    finding: {
      path: path ?? 'unknown',
      severity: 'major',
      note: 'the new branch has no test',
      lineStart: 3,
      lineEnd: 3,
    },
  })
  await call('reviewConclusion', {
    ...identity,
    conclusion: { conclusion: 'changes_requested', note: 'one unresolved finding' },
  })
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [], refusals })}\n`)
} catch (error) {
  process.stdout.write(
    `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
  )
} finally {
  process.disconnect?.()
}
