import { randomUUID } from 'node:crypto'
import type {
  AttentionItem,
  NotificationPreview,
  NotificationSettingsResponse,
} from '@bazilion/api-types'
import { ATTENTION_KINDS, projectAttention } from '../core/attention.ts'
import type { BazilionDb } from '../core/db/client.ts'
import * as receipts from '../core/repos/notifications.ts'
import { authorizeAttentionNotification } from './notification-authorization.ts'
import { notificationKinds, notificationSettingsInput } from './notification-input.ts'
import type { NotificationTransport } from './telegram/notification-transport.ts'

interface CapturedPreview {
  value: NotificationPreview
  keys: Set<string>
}
/** Enablement and explicit old-item inclusion never depend on client-supplied source identities. */
export class NotificationControl {
  #previews = new Map<string, CapturedPreview>()
  constructor(
    readonly db: BazilionDb,
    readonly transport: NotificationTransport,
    readonly now: () => number = Date.now,
  ) {}
  async read(): Promise<NotificationSettingsResponse> {
    const binding = this.transport.capture()
    const ready = binding !== null && (await this.transport.verify(binding))
    return {
      settings: receipts.settings(this.db),
      readiness: {
        ready,
        reason: ready ? null : 'notification_destination_unavailable',
        destination:
          ready && binding
            ? { id: binding.id, chatId: binding.chatId, topicId: binding.topicId }
            : null,
      },
    }
  }
  #sources(): AttentionItem[] {
    const projected = projectAttention(this.db, { state: 'open', limit: 100_001 })
    if (projected.degraded.length || projected.items.length > 100_000)
      throw new Error('notification_projection_unavailable')
    return projected.items
  }
  #includeable(item: AttentionItem, destinationId: string): boolean {
    if (!authorizeAttentionNotification(this.db, item).allowed) return false
    const receipt = this.db.raw
      .query<{ state: string; diagnostic: string | null }, [string, string, string]>(
        'SELECT state, diagnostic FROM notification_receipts WHERE source_kind=? AND source_id=? AND destination_id=?',
      )
      .get(item.kind, item.sourceId, destinationId)
    return (
      !receipt ||
      (receipt.state === 'suppressed' &&
        ['settings_changed', 'restore_paused', 'future_baseline', 'kind_disabled'].includes(
          receipt.diagnostic ?? '',
        ))
    )
  }
  async preview(rawKinds: unknown): Promise<NotificationPreview> {
    const kinds = notificationKinds(rawKinds)
    const revision = receipts.settings(this.db).revision
    const binding = this.transport.capture()
    if (!binding || !(await this.transport.verify(binding)))
      throw new Error('notification_destination_unavailable')
    if (receipts.settings(this.db).revision !== revision)
      throw new Error('notification_settings_conflict')
    for (const [id, preview] of this.#previews)
      if (preview.value.expiresAt <= this.now()) this.#previews.delete(id)
    if (this.#previews.size >= 5) throw new Error('notification_preview_capacity')
    const items = this.#sources().filter(
      (item) => kinds.includes(item.kind) && this.#includeable(item, binding.id),
    )
    const byKind = Object.fromEntries(
      ATTENTION_KINDS.map((kind) => [kind, 0]),
    ) as NotificationPreview['byKind']
    for (const item of items) byKind[item.kind]++
    const value: NotificationPreview = {
      id: randomUUID(),
      settingsRevision: revision,
      destinationId: binding.id,
      kinds,
      count: items.length,
      byKind,
      createdAt: this.now(),
      expiresAt: this.now() + 300_000,
      possibleDuplicates: receipts.hasRestoredHistory(this.db),
    }
    this.#previews.set(value.id, { value, keys: new Set(items.map((item) => item.key)) })
    return value
  }
  async configure(raw: unknown) {
    const input = notificationSettingsInput(raw)
    const binding = this.transport.capture()
    if (
      input.enabled &&
      (!binding || input.destinationId !== binding.id || !(await this.transport.verify(binding)))
    )
      throw new Error('notification_destination_unavailable')
    return this.db.raw.transaction(() => {
      const current = receipts.settings(this.db)
      if (current.revision !== input.expectedRevision)
        throw new Error('notification_settings_conflict')
      if (input.enabled && this.transport.capture()?.id !== binding?.id)
        throw new Error('notification_destination_changed')
      const preview = input.includeOpenPreview ? this.#previews.get(input.includeOpenPreview) : null
      if (
        input.includeOpenPreview &&
        (!preview ||
          preview.value.expiresAt <= this.now() ||
          preview.value.settingsRevision !== current.revision ||
          preview.value.destinationId !== binding?.id ||
          JSON.stringify(preview.value.kinds) !== JSON.stringify(input.kinds))
      )
        throw new Error('notification_preview_expired_or_changed')
      const fresh =
        input.enabled &&
        (!current.enabled || current.restorePaused || current.destination?.id !== binding?.id)
      const settings = receipts.saveSettings(
        this.db,
        current.revision,
        {
          enabled: input.enabled,
          restorePaused: input.enabled ? false : current.restorePaused,
          kinds: input.kinds,
          timezone: input.timezone,
          quietHours: input.quietHours,
          eligibleAfter: fresh ? this.now() : current.eligibleAfter,
        },
        input.enabled ? binding : receipts.destinationBinding(this.db),
        this.now(),
      )
      const addedKinds = input.enabled
        ? input.kinds.filter((kind) => fresh || !current.kinds.includes(kind))
        : []
      if (addedKinds.length && binding) {
        const cutoffs = receipts.eligibilityCutoffs(this.db)
        // Persist only the timestamp boundary: already-open items at this instant must not
        // replay, but a distinct source becoming eligible later in the same millisecond must.
        for (const item of this.#sources()) {
          if (!addedKinds.includes(item.kind) || item.updatedAt < (cutoffs[item.kind] ?? 0))
            continue
          const receipt = receipts.admit(this.db, item, binding, this.now())
          receipts.suppress(this.db, receipt.id, 'future_baseline', this.now())
        }
      }
      if (preview && binding) {
        for (const item of this.#sources()) {
          if (!preview.keys.has(item.key) || !this.#includeable(item, binding.id)) continue
          const receipt = receipts.admit(this.db, item, binding, this.now())
          // Only an explicit current preview can reconsider a pending item suppressed by
          // restore/settings changes. Confirmed/uncertain/failed receipts retain their owner.
          if (receipt.state === 'suppressed')
            this.db.raw.run(
              `UPDATE notification_receipts SET
            state='deferred', diagnostic='explicit_include', updated_at=MAX(updated_at+1, ?)
            WHERE id=? AND state='suppressed' AND diagnostic IN ('settings_changed','restore_paused','future_baseline','kind_disabled')`,
              [this.now(), receipt.id],
            )
        }
        this.#previews.delete(preview.value.id)
      }
      return settings
    })()
  }
  async retry(id: string, expectedUpdatedAt: number, acknowledgePossibleDuplicate: boolean) {
    const binding = receipts.receiptBinding(this.db, id)
    if (!binding || !(await this.transport.verify(binding)))
      throw new Error('notification_destination_unavailable')
    return this.db.raw.transaction(() => {
      const settings = receipts.settings(this.db)
      const receipt = receipts.get(this.db, id)
      if (
        !settings.enabled ||
        settings.restorePaused ||
        settings.destination?.id !== binding.id ||
        this.transport.capture()?.id !== binding.id
      )
        throw new Error('notification_retry_not_enabled')
      if (!receipt || !settings.kinds.includes(receipt.sourceKind))
        throw new Error('notification_retry_source_unavailable')
      const item = this.#sources().find(
        (source) => source.kind === receipt.sourceKind && source.sourceId === receipt.sourceId,
      )
      if (!item || !authorizeAttentionNotification(this.db, item, receipt).allowed)
        throw new Error('notification_retry_source_unavailable')
      return receipts.retry(
        this.db,
        id,
        expectedUpdatedAt,
        acknowledgePossibleDuplicate,
        this.now(),
      )
    })()
  }
}
