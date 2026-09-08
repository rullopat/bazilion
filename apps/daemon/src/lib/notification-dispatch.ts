import type { AttentionItem } from '@bazilion/api-types'
import { projectAttention } from '../core/attention.ts'
import type { BazilionDb } from '../core/db/client.ts'
import * as receipts from '../core/repos/notifications.ts'
import { authorizeAttentionNotification } from './notification-authorization.ts'
import { attentionNotificationMessage } from './notification-message.ts'
import { isNotificationQuiet } from './notification-quiet-hours.ts'
import type { NotificationTransport } from './telegram/notification-transport.ts'
import { enqueueOutbound } from './telegram/outbound-queue.ts'

/** One daemon-owned pump. No Agent turns, approvals or source acknowledgements are created here. */
export class NotificationDispatcher {
  #running = false
  #shutdown = new AbortController()
  stop(): void {
    this.#shutdown.abort()
  }
  diagnostic: string | null = null
  constructor(
    readonly db: BazilionDb,
    readonly transport: NotificationTransport,
    readonly now: () => number = Date.now,
  ) {}
  #sources(): AttentionItem[] {
    const projection = projectAttention(this.db, { state: 'open', limit: 100_001 })
    if (projection.degraded.length) throw new Error('notification_projection_unavailable')
    if (projection.items.length > 100_000) throw new Error('notification_projection_capacity')
    return projection.items
  }
  #current(id: string): { item: AttentionItem; binding: receipts.NotificationBinding } | null {
    if (this.#shutdown.signal.aborted) return null
    const receipt = receipts.get(this.db, id)
    if (receipt?.state !== 'deferred') return null
    const settings = receipts.settings(this.db)
    const binding = receipts.receiptBinding(this.db, id)
    const live = this.transport.capture()
    const suppress = (reason: string) => {
      receipts.suppress(this.db, id, reason, this.now())
      return null
    }
    if (!settings.enabled || settings.restorePaused) return suppress('notifications_disabled')
    if (!binding || settings.destination?.id !== binding.id || live?.id !== binding.id)
      return suppress('destination_changed')
    if (!settings.kinds.includes(receipt.sourceKind)) return suppress('kind_disabled')
    const item = this.#sources().find(
      (item) => item.kind === receipt.sourceKind && item.sourceId === receipt.sourceId,
    )
    if (!item) return suppress('source_resolved')
    const authorization = authorizeAttentionNotification(this.db, item, receipt)
    if (!authorization.allowed) return suppress(authorization.reason)
    if (isNotificationQuiet(this.now(), settings.timezone, settings.quietHours)) return null
    return { item, binding }
  }
  async tick(): Promise<void> {
    if (this.#running || this.#shutdown.signal.aborted) return
    this.#running = true
    try {
      this.diagnostic = null
      const settings = receipts.settings(this.db)
      if (!settings.enabled || settings.restorePaused) return
      const binding = receipts.destinationBinding(this.db)
      if (!binding || this.transport.capture()?.id !== binding.id) {
        for (const item of receipts.list(this.db, { deferredOnly: true, limit: 100 }).receipts)
          receipts.suppress(this.db, item.id, 'destination_changed', this.now())
        this.diagnostic = 'notification_destination_unavailable'
        return
      }
      const known = new Set(
        this.db.raw
          .query<{ key: string }, [string]>(
            "SELECT source_kind || ':' || source_id key FROM notification_receipts WHERE destination_id=?",
          )
          .all(binding.id)
          .map((row) => row.key),
      )
      let admitted = 0
      const cutoffs = receipts.eligibilityCutoffs(this.db)
      for (const item of this.#sources()) {
        if (
          !settings.kinds.includes(item.kind) ||
          item.updatedAt < (cutoffs[item.kind] ?? settings.eligibleAfter ?? this.now()) ||
          known.has(item.key)
        )
          continue
        let receipt: ReturnType<typeof receipts.admit>
        try {
          receipt = receipts.admit(this.db, item, binding, this.now())
        } catch (error) {
          if (error instanceof Error && error.message === 'notification_capacity_reached') {
            this.diagnostic = 'notification_capacity_reached'
            break // Existing admitted notices can still make progress at capacity.
          }
          throw error
        }
        const authorization = authorizeAttentionNotification(this.db, item)
        if (!authorization.allowed)
          receipts.suppress(this.db, receipt.id, authorization.reason, this.now())
        if (++admitted >= 100) break
      }
      for (const receipt of receipts.list(this.db, { deferredOnly: true, limit: 10 }).receipts) {
        if (!this.#current(receipt.id)) continue
        let claimed: ReturnType<typeof receipts.claim> = null
        const owner = { attempt: null as number | null }
        let possibleSend = false
        try {
          // The existing queue owns pacing and one known 429 retry. Its callback revalidates
          // every time; only the API invocation below crosses the possible-send boundary.
          const sent = await enqueueOutbound(binding.chatId, async () => {
            if (this.#shutdown.signal.aborted) throw new Error('notification_stopped')
            // A known 429 has no accepted send. Return the claim to deferred before rechecking.
            if (claimed) {
              this.db.raw.run(
                "UPDATE notification_receipts SET state='deferred' WHERE id=? AND state='sending' AND attempts=?",
                [claimed.id, claimed.attempts],
              )
              claimed = null
            }
            const candidate = this.#current(receipt.id)
            if (!candidate) throw new Error('notification_no_longer_eligible')
            if (!(await this.transport.verify(candidate.binding)))
              throw new Error('notification_destination_unavailable')
            const current = this.#current(receipt.id)
            if (!current) throw new Error('notification_no_longer_eligible')
            claimed = receipts.claim(this.db, receipt.id, this.now())
            if (!claimed) throw new Error('notification_claim_unavailable')
            owner.attempt = claimed.attempts
            possibleSend = true
            try {
              return await this.transport.send(
                current.binding,
                attentionNotificationMessage(current.item),
                AbortSignal.any([this.#shutdown.signal, AbortSignal.timeout(10_000)]),
              )
            } catch (error) {
              if (isKnownRejection(error)) {
                possibleSend = false
                const failure = error as {
                  error_code: number
                  parameters?: { retry_after?: unknown }
                }
                const delay = failure.parameters?.retry_after ?? 1
                if (
                  failure.error_code === 429 &&
                  typeof delay === 'number' &&
                  Number.isFinite(delay) &&
                  delay >= 0 &&
                  delay <= 30
                )
                  throw { error_code: 429, parameters: { retry_after: delay } }
                // Do not let arbitrary Telegram descriptions trigger the queue's text fallback,
                // or let an unbounded server delay pin this notification pump indefinitely.
                throw new Error('notification_rejected')
              }
              throw new Error('notification_ambiguous_send')
            }
          })
          if (this.#shutdown.signal.aborted) return
          if (owner.attempt !== null)
            receipts.settle(
              this.db,
              receipt.id,
              owner.attempt,
              'delivered',
              null,
              sent.message_id,
              this.now(),
            )
        } catch {
          if (this.#shutdown.signal.aborted) return
          const current = receipts.get(this.db, receipt.id)
          if (current?.state === 'sending' && owner.attempt !== null) {
            receipts.settle(
              this.db,
              receipt.id,
              owner.attempt,
              possibleSend ? 'uncertain' : 'failed',
              possibleSend ? 'delivery_uncertain' : 'telegram_rejected',
              null,
              this.now(),
            )
          } else if (current?.state === 'deferred') {
            // Readiness failures before an API send remain deferred for a later safe check.
            this.diagnostic = 'notification_delivery_deferred'
          }
        }
      }
    } catch {
      this.diagnostic = 'notification_dispatch_unavailable'
    } finally {
      this.#running = false
    }
  }
}
function isKnownRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { error_code?: unknown }).error_code
  return typeof code === 'number' && code >= 400 && code < 500
}
