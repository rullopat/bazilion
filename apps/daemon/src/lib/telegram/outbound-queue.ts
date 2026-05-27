// Per-supergroup outbound queue.
//
// Telegram caps outbound to ~20 msg/min per group (across all topics) and
// ~1 msg/sec to the same chat. With many agents in one supergroup, bursts
// of mirror sends + first-traffic `createForumTopic` calls all share that
// budget. The queue serializes outbound work per chat_id and enforces a
// minimum interval between sends so we don't trip the rate-limit.
//
// 429 responses are caught + retried once with the `retry_after` Telegram
// returns (defaulting to 1s when missing). After one retry the error
// bubbles to the caller — the mirror swallows it, the directory module
// logs it, etc.

const DEFAULT_MIN_INTERVAL_MS = Number(process.env.BAZILION_TELEGRAM_SEND_INTERVAL_MS ?? 200)

interface ChatQueue {
  /** The tail of the chain — `enqueue` appends to this. */
  tail: Promise<unknown>
  /** Epoch-ms of the last completed send for this chat. */
  lastSendAt: number
}

const _queues = new Map<number, ChatQueue>()

function getQueue(chatId: number): ChatQueue {
  let q = _queues.get(chatId)
  if (!q) {
    q = { tail: Promise.resolve(), lastSendAt: 0 }
    _queues.set(chatId, q)
  }
  return q
}

/**
 * Enqueue an outbound Telegram API call against a specific chat. Returns a
 * Promise that resolves with whatever `fn` returned. Errors propagate.
 *
 * Caller pattern:
 *
 *   await enqueueOutbound(chatId, () => bot.api.sendMessage(chatId, body, opts))
 *
 * The queue guarantees the function runs after all prior enqueues for the
 * same chat have completed, and that at least `minIntervalMs` has elapsed
 * since the previous send to this chat.
 */
export function enqueueOutbound<T>(
  chatId: number,
  fn: () => Promise<T>,
  opts: { minIntervalMs?: number } = {},
): Promise<T> {
  const minInterval = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  const q = getQueue(chatId)
  const next = q.tail.then(async () => {
    // Pace: wait until min-interval has elapsed since the last send.
    const elapsed = Date.now() - q.lastSendAt
    if (elapsed < minInterval) {
      await sleep(minInterval - elapsed)
    }
    try {
      return await runWith429Retry(fn)
    } finally {
      q.lastSendAt = Date.now()
    }
  })
  // Catch failures so the chain doesn't break — the caller still sees the
  // rejection via the returned promise (we return `next` below), but
  // subsequent enqueues should not inherit it.
  q.tail = next.catch(() => undefined)
  return next as Promise<T>
}

/**
 * One-shot retry on Telegram 429s. The Bot API returns a JSON body with a
 * `retry_after` field counted in seconds; grammY surfaces that as
 * `error.parameters?.retry_after` on the `GrammyError`. We sleep + retry
 * exactly once; further failures propagate.
 */
async function runWith429Retry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (e) {
    const retryAfter = extractRetryAfter(e)
    if (retryAfter === null) throw e
    console.warn(`telegram outbound: 429 — sleeping ${retryAfter}s then retrying once`)
    await sleep(retryAfter * 1000)
    return await fn()
  }
}

function extractRetryAfter(e: unknown): number | null {
  if (!e || typeof e !== 'object') return null
  // Generic shape (matches grammY's GrammyError).
  const shaped = e as {
    error_code?: number
    parameters?: { retry_after?: number }
    message?: string
  }
  if (shaped.error_code === 429) {
    return shaped.parameters?.retry_after ?? 1
  }
  // Fallback for plain-error shapes that include "Too Many Requests" in the
  // message — defensive against bot client variations.
  if (typeof shaped.message === 'string' && /too many requests/i.test(shaped.message)) {
    return 1
  }
  return null
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Test helper — drop every queue so test files start clean. */
export function _resetOutboundQueueForTest(): void {
  _queues.clear()
}
