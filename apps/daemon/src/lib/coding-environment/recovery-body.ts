/** No body-derived recovery authority. Own bounded EOF inspection and cancellation settlement.
 * A hanging cancellation keeps this request pending BEFORE any teardown starts.
 */
export async function emptyRecoveryBody(request: Request): Promise<boolean> {
  const length = request.headers.get('content-length')
  if (request.headers.has('transfer-encoding') || (length !== null && length !== '0')) return false
  if (!request.body) return true
  const reader = request.body.getReader()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('recovery_body_refused')), 1000)
  })
  try {
    for (let emptyChunks = 0; emptyChunks < 8; emptyChunks++) {
      const chunk = await Promise.race([reader.read(), timeout])
      if (chunk.done) return true
      if (chunk.value.byteLength !== 0) return false
    }
    return false
  } catch {
    return false
  } finally {
    if (timer) clearTimeout(timer)
    try {
      await reader.cancel()
    } catch {
      /* no teardown authority issued */
    }
    reader.releaseLock()
  }
}
