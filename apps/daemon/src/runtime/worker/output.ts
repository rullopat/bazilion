import type { Writable } from 'node:stream'

/** Below the daemon's 3s cancellation grace. A dead reader must not pin a worker. */
export const WORKER_OUTPUT_DRAIN_MS = 2_000

/**
 * Worker stdout is a protocol, not a console. Seal it and flush every queued
 * write before explicit process exit; a writable's backpressure flag is not
 * proof that the bytes reached the pipe. Failure/timeout must exit nonzero.
 */
export class WorkerOutput {
  private failed = false
  private sealed = false
  private finishing: Promise<boolean> | undefined
  private settle: ((ok: boolean) => void) | undefined
  private readonly stream: Writable

  constructor(stream: Writable) {
    this.stream = stream
    // Keep the listener through process exit: a late EPIPE after timeout must
    // not become an unhandled exception or leak a protocol payload to stderr.
    stream.on('error', () => {
      this.failed = true
      this.settle?.(false)
    })
  }

  write(line: string): void {
    if (this.sealed || this.failed) return
    try {
      this.stream.write(line)
    } catch {
      this.failed = true
    }
  }

  finish(timeoutMs = WORKER_OUTPUT_DRAIN_MS): Promise<boolean> {
    if (this.finishing) return this.finishing
    this.sealed = true
    this.finishing = new Promise<boolean>((resolve) => {
      let settled = false
      const timer = setTimeout(() => complete(false), timeoutMs)
      const complete = (ok: boolean) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.settle = undefined
        resolve(ok && !this.failed)
      }
      this.settle = complete
      if (this.failed || this.stream.destroyed || this.stream.writableEnded) {
        complete(false)
        return
      }
      try {
        // A FIFO callback barrier covers ALL preceding frames, not just the
        // terminal frame. Do not unref the deadline: pending output must keep
        // an otherwise idle process alive until flushed or explicitly failed.
        this.stream.write('', (error) => complete(!error))
      } catch {
        complete(false)
      }
    })
    return this.finishing
  }
}
