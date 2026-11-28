// A stand-in worker for the daemon side of a turn's process (spawn.ts): what it does is named by
// the turn's message.

/** One more character than the daemon buffers for a single stdout line. */
const OVERSIZED_FRAME_CHARS = 40 * 1024 * 1024 + 1

const NATIVE_ABI_MISMATCH =
  "The module '/private/checkout/node_modules/better_sqlite3.node' was compiled " +
  'against a different Node.js version using NODE_MODULE_VERSION 141. ' +
  'This version of Node.js requires NODE_MODULE_VERSION 147.'

async function readMessage(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return (JSON.parse(Buffer.concat(chunks).toString('utf8')) as { message: string }).message
}

const hang = () => new Promise<void>(() => setInterval(() => undefined, 1_000))

async function main(): Promise<void> {
  const message = await readMessage()
  if (message === 'native-abi-mismatch') {
    await new Promise<void>((resolve, reject) => {
      process.stderr.write(`${NATIVE_ABI_MISMATCH} Please try re-compiling.\n`, (error) =>
        error ? reject(error) : resolve(),
      )
    })
    process.exitCode = 1
    return
  }
  if (message === 'native-abi-frame') {
    process.stdout.write(`${JSON.stringify({ kind: 'fatal', error: NATIVE_ABI_MISMATCH })}\n`)
    process.exitCode = 1
    return
  }
  if (message === 'oversized-frame') {
    process.stdout.write('x'.repeat(OVERSIZED_FRAME_CHARS))
    await hang()
  }
  process.stdout.write(`${JSON.stringify({ kind: 'done', messages: [] })}\n`)
  if (message === 'hang-after-frame') await hang()
}

main()
  .catch((error) => {
    process.stdout.write(
      `${JSON.stringify({ kind: 'fatal', error: error instanceof Error ? error.message : String(error) })}\n`,
    )
    process.exitCode = 1
  })
  .finally(() => {
    try {
      process.disconnect?.()
    } catch {}
  })
