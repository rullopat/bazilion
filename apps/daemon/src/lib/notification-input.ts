import type { AttentionKind, NotificationSettingsInput } from '@bazilion/api-types'
import { ATTENTION_KINDS } from '../core/attention.ts'
import { notificationQuietHours, notificationTimezone } from './notification-quiet-hours.ts'

export function notificationKinds(value: unknown): AttentionKind[] {
  if (
    !Array.isArray(value) ||
    value.length < 1 ||
    value.length > ATTENTION_KINDS.length ||
    value.some((kind) => !ATTENTION_KINDS.includes(kind)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Select one or more distinct existing Attention kinds')
  return ATTENTION_KINDS.filter((kind) => value.includes(kind))
}
export function notificationSettingsInput(value: unknown): NotificationSettingsInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid notification settings')
  const record = value as Record<string, unknown>
  const fields = [
    'expectedRevision',
    'enabled',
    'kinds',
    'timezone',
    'quietHours',
    'destinationId',
    'includeOpenPreview',
  ]
  if (Object.keys(record).some((key) => !fields.includes(key)))
    throw new Error('Unknown notification setting')
  if (
    !Number.isSafeInteger(record.expectedRevision) ||
    Number(record.expectedRevision) < 0 ||
    typeof record.enabled !== 'boolean'
  )
    throw new Error('Settings require an expected revision and explicit enabled value')
  for (const key of ['destinationId', 'includeOpenPreview']) {
    if (
      record[key] !== undefined &&
      (typeof record[key] !== 'string' || !/^[a-f0-9-]{1,64}$/.test(record[key] as string))
    )
      throw new Error('Invalid notification destination or preview identity')
  }
  if (!record.enabled && record.includeOpenPreview !== undefined)
    throw new Error('Including open items requires enablement')
  return {
    expectedRevision: Number(record.expectedRevision),
    enabled: record.enabled,
    kinds: notificationKinds(record.kinds),
    timezone: notificationTimezone(record.timezone),
    quietHours: notificationQuietHours(record.quietHours),
    ...(typeof record.destinationId === 'string' ? { destinationId: record.destinationId } : {}),
    ...(typeof record.includeOpenPreview === 'string'
      ? { includeOpenPreview: record.includeOpenPreview }
      : {}),
  }
}
